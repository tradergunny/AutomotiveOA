import type {
  JobStatus,
  RepairCaseStatus,
  WaitingReason,
} from "@/lib/generated/prisma/enums";
import type { TenantDb } from "@/lib/tenant";

/**
 * Case & Job flow (M5 brief, founder rulings): the server-side transition
 * edge map, the derived READY rule (both directions), and the board's
 * single-group placement. Pure logic lives here so it is unit-testable;
 * server actions call into it inside their own transactions.
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

/** Display order — IN_ASSESSMENT leads (the catch-all); BALANCE_DUE is M7. */
export const BOARD_GROUPS = [
  "IN_ASSESSMENT",
  "AWAITING_AUTH",
  "WAITING",
  "IN_PROGRESS",
  "IN_QC",
  "READY",
] as const;

export type BoardGroup = (typeof BOARD_GROUPS)[number];

/**
 * First match in D-2's order (founder ruling): attention first, then READY,
 * else the leading catch-all. DELIVERED cases are off the board entirely —
 * callers exclude them before grouping.
 */
export function boardGroupFor(
  caseStatus: RepairCaseStatus,
  jobs: { status: JobStatus }[],
): BoardGroup {
  if (jobs.some((job) => job.status === "PROPOSED")) return "AWAITING_AUTH";
  if (jobs.some((job) => job.status === "WAITING")) return "WAITING";
  if (jobs.some((job) => job.status === "IN_PROGRESS")) return "IN_PROGRESS";
  if (jobs.some((job) => job.status === "QC")) return "IN_QC";
  if (caseStatus === "READY") return "READY";
  return "IN_ASSESSMENT";
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
