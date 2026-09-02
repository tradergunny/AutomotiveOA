import type {
  JobStatus,
  PartOrderStatus,
  RepairCaseStatus,
  WaitingReason,
} from "@/lib/generated/prisma/enums";
import type { TenantDb } from "@/lib/tenant";

/**
 * Case & Job flow (M5 brief, founder rulings): the server-side transition
 * edge map, the derived READY rule (both directions), and the shared Stage
 * derivation (M7.5, CONTEXT.md) the board and case page both speak. Pure
 * logic lives here so it is unit-testable; server actions call into it
 * inside their own transactions.
 */

export const WAITING_REASONS = ["PARTS", "PAINT_BOOTH", "TECHNICIAN", "OTHER"] as const satisfies
  readonly WaitingReason[];

/**
 * Authorized work that is not finished — what blocks READY, and what revokes
 * it when it appears on a READY case. PROPOSED/DECLINED never held an
 * authorization; COMPLETED is done; CANCELLED was stopped.
 */
export const ACTIVE_JOB_STATUSES = ["AUTHORIZED", "WAITING", "IN_PROGRESS", "QC"] as const satisfies
  readonly JobStatus[];

export function isActiveJob(status: JobStatus): boolean {
  return (ACTIVE_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

export function hasActiveWork(jobs: { status: JobStatus }[]): boolean {
  return jobs.some((job) => isActiveJob(job.status));
}

/**
 * Auto-READY (founder ruling 4a): at least one authorization-bearing Job
 * exists and every such Job is COMPLETED — i.e. no active work remains and
 * something was actually completed. Cases whose work never materialized
 * (no Jobs, or everything Declined/Cancelled) never auto-flip; the explicit
 * Mark-ready action covers the customer-collects-anyway path.
 */
export function isAutoReadyEligible(jobs: { status: JobStatus }[]): boolean {
  return !hasActiveWork(jobs) && jobs.some((job) => job.status === "COMPLETED");
}

/* ------------------------------------------------------------------ */
/* Job working transitions (ruling 2): the fixed edge map.             */
/* ------------------------------------------------------------------ */

/**
 * The only working transitions that exist. Everything else is refused by the
 * server — there is no free status dropdown anywhere. SET_WAITING from
 * WAITING is the waiting-reason change; QC_PASS additionally requires the
 * qc.signOff permission and an actor who is not the assigned technician;
 * CANCEL is Manager-only. Authorization transitions (PROPOSED ↔
 * AUTHORIZED/DECLINED) are M4's recording flow, not this map.
 */
export const JOB_FLOW_ACTIONS = {
  START_WORK: { from: ["AUTHORIZED", "WAITING"], to: "IN_PROGRESS" },
  SET_WAITING: { from: ["AUTHORIZED", "IN_PROGRESS", "WAITING"], to: "WAITING" },
  SEND_TO_QC: { from: ["IN_PROGRESS"], to: "QC" },
  QC_PASS: { from: ["QC"], to: "COMPLETED" },
  QC_FAIL: { from: ["QC"], to: "IN_PROGRESS" },
  CANCEL: { from: ["AUTHORIZED", "WAITING", "IN_PROGRESS"], to: "CANCELLED" },
} as const satisfies Record<string, { from: readonly JobStatus[]; to: JobStatus }>;

export type JobFlowAction = keyof typeof JOB_FLOW_ACTIONS;

export function canFlow(action: JobFlowAction, from: JobStatus): boolean {
  return (JOB_FLOW_ACTIONS[action].from as readonly JobStatus[]).includes(from);
}

/**
 * Statuses the Manager-only single-step revert applies to (ruling 2): the
 * working flow only. PROPOSED/AUTHORIZED/DECLINED corrections are M4's
 * authorization revert.
 */
export const REVERTIBLE_STATUSES = ["WAITING", "IN_PROGRESS", "QC", "COMPLETED", "CANCELLED"] as const satisfies
  readonly JobStatus[];

/* ------------------------------------------------------------------ */
/* Board grouping (ruling 4c): one group per case, D-2 order.          */
/* ------------------------------------------------------------------ */

/**
 * Display order — IN_ASSESSMENT leads (the catch-all); BALANCE_DUE trails
 * (M7 ruling 1): delivered cases still owed money, the ONE exception to
 * open-cases-only — a delivered case leaves the board once nothing is owed,
 * and returns if a void resurrects the debt.
 */
export const BOARD_GROUPS = [
  "IN_ASSESSMENT",
  "AWAITING_AUTH",
  "WAITING",
  "IN_PROGRESS",
  "IN_QC",
  "READY",
  "BALANCE_DUE",
] as const;

export type BoardGroup = (typeof BOARD_GROUPS)[number];

/**
 * D-2 precedence for a case still open: attention first (an undecided
 * proposal needs a human before anything else), then the work states, then
 * READY, else the leading catch-all. One derivation, two views — stageFor
 * and boardGroupFor both read it, so board and case page can never disagree
 * (M7.5 brief §1).
 */
function openCaseStage(
  caseStatus: RepairCaseStatus,
  jobs: { status: JobStatus }[],
): Exclude<BoardGroup, "BALANCE_DUE"> {
  if (jobs.some((job) => job.status === "PROPOSED")) return "AWAITING_AUTH";
  if (jobs.some((job) => job.status === "WAITING")) return "WAITING";
  if (jobs.some((job) => job.status === "IN_PROGRESS")) return "IN_PROGRESS";
  if (jobs.some((job) => job.status === "QC")) return "IN_QC";
  if (caseStatus === "READY") return "READY";
  return "IN_ASSESSMENT";
}

/**
 * First match in D-2's order (founder ruling). OPEN cases only — a DELIVERED
 * case never files here; the board itself places delivered-with-balance rows
 * under BALANCE_DUE (M7 ruling 1), rendered for money, not work.
 */
export function boardGroupFor(
  caseStatus: RepairCaseStatus,
  jobs: { status: JobStatus }[],
): BoardGroup {
  return openCaseStage(caseStatus, jobs);
}

/* ------------------------------------------------------------------ */
/* Stage (M7.5, CONTEXT.md): the single answer to "what does this      */
/* Repair Case need from a human right now".                           */
/* ------------------------------------------------------------------ */

/**
 * The seven board groups plus the settled-Delivered flavor: a DELIVERED case
 * still owed money reads BALANCE_DUE until its balance clears, then plain
 * DELIVERED. Derived, never stored, exactly one per case.
 */
export type Stage = BoardGroup | "DELIVERED";

/**
 * The case's Stage. Delivered wins outright — the work record froze, so job
 * statuses stop mattering and only money can still need a human; open cases
 * take the shared attention-first precedence.
 */
export function stageFor(
  caseStatus: RepairCaseStatus,
  jobs: { status: JobStatus }[],
  totalDueSatang: number,
): Stage {
  if (caseStatus === "DELIVERED") {
    return totalDueSatang > 0 ? "BALANCE_DUE" : "DELIVERED";
  }
  return openCaseStage(caseStatus, jobs);
}

/**
 * The D-6 stage spine: the five header steps a case walks left to right.
 * Waiting / In progress / In QC all light WORK, with the specific state
 * written beneath; Balance due lights DELIVERED with the owed amount beside.
 */
export const SPINE_STEPS = [
  "ASSESSMENT",
  "AUTHORIZATION",
  "WORK",
  "READY",
  "DELIVERED",
] as const;

export type SpineStep = (typeof SPINE_STEPS)[number];

const STAGE_SPINE_STEP: Record<Stage, SpineStep> = {
  IN_ASSESSMENT: "ASSESSMENT",
  AWAITING_AUTH: "AUTHORIZATION",
  WAITING: "WORK",
  IN_PROGRESS: "WORK",
  IN_QC: "WORK",
  READY: "READY",
  BALANCE_DUE: "DELIVERED",
  DELIVERED: "DELIVERED",
};

export function spineStepFor(stage: Stage): SpineStep {
  return STAGE_SPINE_STEP[stage];
}

/* ------------------------------------------------------------------ */
/* Next action (D-6): at most one primary and one secondary — a        */
/* suggestion, never a wizard. Every action stays reachable where it   */
/* lives today.                                                        */
/* ------------------------------------------------------------------ */

export type StageAction =
  | "OPEN_INSPECTION"
  | "SET_PRICES"
  | "SEND_QUOTATION"
  | "RECORD_RESPONSE"
  | "RECORD_QC"
  | "RECORD_PAYMENT"
  | "MARK_DELIVERED";

export type NextActionFacts = {
  findingsCount: number;
  /** Findings the advisor has not accepted yet — the inspection is not done. */
  unconfirmedFindingsCount: number;
  /** PROPOSED Jobs with no price — an authorization needs one (M4). */
  unpricedProposedCount: number;
  /**
   * A payer part of the Offer holds priced lines that no Quotation covers at
   * their current prices — unsent, or stale since the last send
   * (lib/jobs.ts offerNeedsSending).
   */
  offerNeedsSending: boolean;
  /** Blended due across both payer sides — what READY leads with. */
  totalDueSatang: number;
};

export type NextMove = {
  primary: StageAction | null;
  secondary: StageAction | null;
};

/**
 * The cascade since D-24 retired the grouping step: no Findings or unaccepted
 * Findings → Open inspection, else nothing while In assessment (accepting a
 * Finding that proposes work already put its line in the Offer). The pricing
 * tail lives under AWAITING_AUTH because a Job's existence already files the
 * case there (D-2 precedence): unpriced lines → Set prices; unsent or stale →
 * Send quotation, with Record response beside it because the walk-in's
 * answer is recorded with no Quotation at all (founder ruling 2026-08-27);
 * otherwise Record response leads. WAITING returns no action: the header
 * renders the blocker itself instead of a button.
 */
export function nextActionFor(stage: Stage, facts: NextActionFacts): NextMove {
  switch (stage) {
    case "IN_ASSESSMENT":
      if (facts.findingsCount === 0 || facts.unconfirmedFindingsCount > 0) {
        return { primary: "OPEN_INSPECTION", secondary: null };
      }
      return { primary: null, secondary: null };
    case "AWAITING_AUTH":
      if (facts.unpricedProposedCount > 0) return { primary: "SET_PRICES", secondary: null };
      if (facts.offerNeedsSending) {
        return { primary: "SEND_QUOTATION", secondary: "RECORD_RESPONSE" };
      }
      return { primary: "RECORD_RESPONSE", secondary: null };
    case "WAITING":
    case "IN_PROGRESS":
    case "DELIVERED":
      return { primary: null, secondary: null };
    case "IN_QC":
      return { primary: "RECORD_QC", secondary: null };
    case "READY":
      return facts.totalDueSatang > 0
        ? { primary: "RECORD_PAYMENT", secondary: "MARK_DELIVERED" }
        : { primary: "MARK_DELIVERED", secondary: null };
    case "BALANCE_DUE":
      return { primary: "RECORD_PAYMENT", secondary: null };
  }
}

/** What a WAITING case is blocked on — the header line D-6 asks for. */
export type WaitingBlocker = {
  /** Distinct reasons across WAITING Jobs, in WAITING_REASONS order. */
  reasons: WaitingReason[];
  /** Part lines not yet ARRIVED across the Waiting(Parts) Jobs. */
  pendingParts: number;
  /** Nearest ETA among those pending lines. */
  nextEta: Date | null;
};

export function waitingBlockerFor(
  jobs: {
    status: JobStatus;
    waitingReason: WaitingReason | null;
    partLines: { orderStatus: PartOrderStatus; etaDate: Date | null }[];
  }[],
): WaitingBlocker {
  const waiting = jobs.filter((job) => job.status === "WAITING");
  const reasons = WAITING_REASONS.filter((reason) =>
    waiting.some((job) => (job.waitingReason ?? "OTHER") === reason),
  );
  const pendingLines = waiting
    .filter((job) => job.waitingReason === "PARTS")
    .flatMap((job) => job.partLines)
    .filter((line) => line.orderStatus !== "ARRIVED");
  const nextEta =
    pendingLines
      .map((line) => line.etaDate)
      .filter((eta): eta is Date => eta != null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return { reasons, pendingParts: pendingLines.length, nextEta };
}

/* ------------------------------------------------------------------ */
/* Status rollup ("2 In Progress · 1 Waiting Parts").                  */
/* ------------------------------------------------------------------ */

export type RollupEntry = {
  status: JobStatus;
  /** Set on WAITING entries — the rollup breaks Waiting out per reason. */
  waitingReason: WaitingReason | null;
  count: number;
};

const ROLLUP_ORDER: readonly JobStatus[] = [
  "PROPOSED",
  "AUTHORIZED",
  "WAITING",
  "IN_PROGRESS",
  "QC",
  "COMPLETED",
  "DECLINED",
  "CANCELLED",
];

/** Ordered status counts for a case's Jobs, Waiting split per reason. */
export function jobRollup(
  jobs: { status: JobStatus; waitingReason: WaitingReason | null }[],
): RollupEntry[] {
  const entries: RollupEntry[] = [];
  for (const status of ROLLUP_ORDER) {
    if (status === "WAITING") {
      for (const reason of [...WAITING_REASONS, null]) {
        const count = jobs.filter(
          (job) => job.status === "WAITING" && job.waitingReason === reason,
        ).length;
        if (count > 0) entries.push({ status, waitingReason: reason, count });
      }
      continue;
    }
    const count = jobs.filter((job) => job.status === status).length;
    if (count > 0) entries.push({ status, waitingReason: null, count });
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Derived READY — run inside the same transaction as any Job change.  */
/* ------------------------------------------------------------------ */

/**
 * The tenant-scoped interactive-transaction client — extracted from
 * TenantDb's own $transaction signature so the tenant guard's typing carries
 * through (the base Prisma.TransactionClient is not assignable from the
 * extended client).
 */
export type FlowTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/**
 * Re-derive the case's READY state after a Job status change (ruling 4a) —
 * MUST run inside the same transaction as that change. Flips CHECKED_IN →
 * READY when eligible, revokes READY → CHECKED_IN when active work appears,
 * writes the CASE_READY / CASE_READY_REVOKED event, and never touches a
 * DELIVERED case. Returns the new case status, or null if unchanged.
 */
export async function applyCaseReadiness(
  tx: FlowTx,
  shopId: string,
  caseId: string,
  actorStaffId: string,
): Promise<RepairCaseStatus | null> {
  const repairCase = await tx.repairCase.findUnique({
    where: { id: caseId },
    select: { status: true },
  });
  if (!repairCase || repairCase.status === "DELIVERED") return null;

  const jobs = await tx.job.findMany({ where: { caseId }, select: { status: true } });

  if (repairCase.status === "CHECKED_IN" && isAutoReadyEligible(jobs)) {
    await tx.repairCase.update({
      where: { id: caseId },
      data: { status: "READY", readyAt: new Date() },
    });
    await tx.caseEvent.create({
      data: { shopId, caseId, type: "CASE_READY", actorStaffId },
    });
    return "READY";
  }

  if (repairCase.status === "READY" && hasActiveWork(jobs)) {
    await tx.repairCase.update({
      where: { id: caseId },
      data: { status: "CHECKED_IN", readyAt: null },
    });
    await tx.caseEvent.create({
      data: { shopId, caseId, type: "CASE_READY_REVOKED", actorStaffId },
    });
    return "CHECKED_IN";
  }

  return null;
}
