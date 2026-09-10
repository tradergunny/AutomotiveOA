import {
  BOARD_GROUPS,
  isActiveJob,
  nextActionFor,
  stageFor,
  waitingBlockerFor,
  type BoardGroup,
  type NextMove,
} from "@/lib/case-flow";
import type {
  BodyType,
  JobStatus,
  PartOrderStatus,
  PayerType,
  RepairCaseStatus,
  WaitingReason,
} from "@/lib/generated/prisma/enums";
import { offerNeedsSending } from "@/lib/jobs";
import { caseBalance } from "@/lib/payments";

/**
 * The Case Board's row derivation (M7.9, D-26). One pure function turns a
 * case as the board queries it into a serializable row: its Stage, the one
 * pill that names the next step or the blocker, its age and tone, and the
 * ledger the pane shows. Everything stage-shaped comes from lib/case-flow
 * so the board can never disagree with the case page.
 */

const DAY_MS = 86_400_000;

export type BoardPill =
  | { kind: "INSPECT" }
  | { kind: "NO_WORK" }
  | { kind: "UNPRICED"; count: number }
  | { kind: "NOT_SENT"; amountSatang: number }
  | { kind: "UNANSWERED"; days: number }
  | { kind: "RESPONSE" }
  | { kind: "WAITING_PARTS"; arrived: number; total: number; eta: string | null }
  | { kind: "WAITING"; reason: WaitingReason }
  | { kind: "IN_PROGRESS"; count: number }
  | { kind: "QC"; count: number }
  | { kind: "NOT_COLLECTED"; days: number }
  | { kind: "COLLECT"; amountSatang: number }
  | { kind: "DELIVER" }
  | { kind: "OWED"; payer: PayerType; amountSatang: number };

export type PillTone = "ok" | "warn" | "bad" | "info" | "quiet";

export type AgeTone = "quiet" | "muted" | "warn" | "bad";

export type LedgerLine = {
  id: string;
  title: string;
  status: JobStatus;
  priceSatang: number | null;
  technician: string | null;
};

export type BoardCase = {
  id: string;
  reference: string;
  stage: BoardGroup;
  status: RepairCaseStatus;
  plate: string;
  make: string | null;
  model: string | null;
  bodyType: BodyType;
  contactName: string;
  contactPhone: string;
  /** First walkaround photo (D-28: the pane's face). */
  photoId: string | null;
  checkedInAt: string;
  readyAt: string | null;
  deliveredAt: string | null;
  /** Days since check-in — since delivery for Balance due (the debt's age). */
  ageDays: number;
  ageTone: AgeTone;
  pill: BoardPill;
  /** The advisor owns the next step (every stage but Waiting / In progress). */
  needsMe: boolean;
  next: NextMove;
  technicians: string[];
  offerTotalSatang: number;
  quoteSentAt: string | null;
  balance: { customerDueSatang: number; insurerDueSatang: number; totalDueSatang: number };
  ledger: { offer: LedgerLine[]; work: LedgerLine[]; done: LedgerLine[] };
  findingsCount: number;
};

export type BoardCaseInput = {
  id: string;
  reference: string;
  status: RepairCaseStatus;
  checkedInAt: Date;
  readyAt: Date | null;
  deliveredAt: Date | null;
  vehicle: { plate: string; make: string | null; model: string | null; bodyType: BodyType };
  contactCustomer: { name: string; phone: string };
  photos: { id: string }[];
  findings: { confirmedAt: Date | null }[];
  jobs: {
    id: string;
    title: string;
    status: JobStatus;
    waitingReason: WaitingReason | null;
    payerType: PayerType;
    insurerName: string | null;
    priceSatang: number | null;
    assignedStaff: { name: string } | null;
    partLines: { orderStatus: PartOrderStatus; etaDate: Date | null }[];
  }[];
  quotations: { lines: { jobId: string | null; priceSatang: number }[] }[];
  /** LINE Updates that carried a quotation — the send dates. */
  quotationSends: { sentAt: Date }[];
  payments: { payerType: PayerType; amountSatang: number; voidedAt: Date | null }[];
};

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** D-26: quiet under 3 days, amber to 13, red from 14. */
export function ageToneFor(days: number): AgeTone {
  if (days < 3) return "quiet";
  if (days < 7) return "muted";
  if (days < 14) return "warn";
  return "bad";
}

export const PILL_TONE: Record<BoardPill["kind"], PillTone> = {
  INSPECT: "warn",
  NO_WORK: "quiet",
  UNPRICED: "warn",
  NOT_SENT: "warn",
  UNANSWERED: "bad",
  RESPONSE: "warn",
  WAITING_PARTS: "warn",
  WAITING: "warn",
  IN_PROGRESS: "info",
  QC: "info",
  NOT_COLLECTED: "bad",
  COLLECT: "ok",
  DELIVER: "quiet",
  OWED: "bad",
};

/** Stages whose next step belongs to the advisor — the Needs-me filter. */
export function stageNeedsMe(stage: BoardGroup): boolean {
  return stage !== "WAITING" && stage !== "IN_PROGRESS";
}

export function toBoardCase(input: BoardCaseInput, now: Date): BoardCase {
  const balance = caseBalance(input.jobs, input.payments);
  const stage = stageFor(input.status, input.jobs, balance.totalDueSatang);
  // A settled delivered case never reaches the board (the query filters it);
  // guard the type anyway so a caller passing one gets the closed reading.
  const group: BoardGroup = stage === "DELIVERED" ? "BALANCE_DUE" : stage;

  const proposed = input.jobs.filter((job) => job.status === "PROPOSED");
  const unpriced = proposed.filter((job) => job.priceSatang == null).length;
  const offerTotalSatang = proposed.reduce((sum, job) => sum + (job.priceSatang ?? 0), 0);
  const needsSending = offerNeedsSending(input.jobs, input.quotations);
  const lastSend = input.quotationSends
    .map((send) => send.sentAt)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const next = nextActionFor(group, {
    findingsCount: input.findings.length,
    unconfirmedFindingsCount: input.findings.filter((f) => f.confirmedAt == null).length,
    unpricedProposedCount: unpriced,
    offerNeedsSending: needsSending,
    totalDueSatang: balance.totalDueSatang,
  });

  const blocker = waitingBlockerFor(input.jobs);
  const inProgress = input.jobs.filter((job) => job.status === "IN_PROGRESS").length;
  const inQc = input.jobs.filter((job) => job.status === "QC").length;
  const ageFrom = group === "BALANCE_DUE" && input.deliveredAt ? input.deliveredAt : input.checkedInAt;
  const ageDays = daysBetween(ageFrom, now);

  const pill: BoardPill = (() => {
    switch (group) {
      case "IN_ASSESSMENT":
        // D-24: accepted Findings already made their lines, so a case here
        // with nothing to inspect has no work proposed at all.
        return next.primary === "OPEN_INSPECTION" ? { kind: "INSPECT" } : { kind: "NO_WORK" };
      case "AWAITING_AUTH":
        if (unpriced > 0) return { kind: "UNPRICED", count: unpriced };
        if (needsSending) return { kind: "NOT_SENT", amountSatang: offerTotalSatang };
        if (lastSend) return { kind: "UNANSWERED", days: daysBetween(lastSend, now) };
        return { kind: "RESPONSE" };
      case "WAITING": {
        if (blocker.reasons.includes("PARTS")) {
          const lines = input.jobs
            .filter((job) => job.status === "WAITING" && job.waitingReason === "PARTS")
            .flatMap((job) => job.partLines);
          return {
            kind: "WAITING_PARTS",
            arrived: lines.filter((line) => line.orderStatus === "ARRIVED").length,
            total: lines.length,
            eta: blocker.nextEta?.toISOString() ?? null,
          };
        }
        return { kind: "WAITING", reason: blocker.reasons[0] ?? "OTHER" };
      }
      case "IN_PROGRESS":
        return { kind: "IN_PROGRESS", count: inProgress };
      case "IN_QC":
        return { kind: "QC", count: inQc };
      case "READY": {
        if (balance.totalDueSatang > 0) return { kind: "COLLECT", amountSatang: balance.totalDueSatang };
        const readyDays = input.readyAt ? daysBetween(input.readyAt, now) : 0;
        return readyDays >= 3 ? { kind: "NOT_COLLECTED", days: readyDays } : { kind: "DELIVER" };
      }
      case "BALANCE_DUE": {
        const payer: PayerType =
          balance.insurer.dueSatang >= balance.customer.dueSatang ? "INSURER" : "CUSTOMER";
        return { kind: "OWED", payer, amountSatang: balance.totalDueSatang };
      }
    }
  })();

  const line = (job: BoardCaseInput["jobs"][number]): LedgerLine => ({
    id: job.id,
    title: job.title,
    status: job.status,
    priceSatang: job.priceSatang,
    technician: job.assignedStaff?.name ?? null,
  });

  return {
    id: input.id,
    reference: input.reference,
    stage: group,
    status: input.status,
    plate: input.vehicle.plate,
    make: input.vehicle.make,
    model: input.vehicle.model,
    bodyType: input.vehicle.bodyType,
    contactName: input.contactCustomer.name,
    contactPhone: input.contactCustomer.phone,
    photoId: input.photos[0]?.id ?? null,
    checkedInAt: input.checkedInAt.toISOString(),
    readyAt: input.readyAt?.toISOString() ?? null,
    deliveredAt: input.deliveredAt?.toISOString() ?? null,
    ageDays,
    ageTone: ageToneFor(ageDays),
    pill,
    needsMe: stageNeedsMe(group),
    next,
    technicians: [
      ...new Set(
        input.jobs
          .filter((job) => isActiveJob(job.status) && job.assignedStaff)
          .map((job) => job.assignedStaff!.name),
      ),
    ],
    offerTotalSatang,
    quoteSentAt: lastSend?.toISOString() ?? null,
    balance: {
      customerDueSatang: balance.customer.dueSatang,
      insurerDueSatang: balance.insurer.dueSatang,
      totalDueSatang: balance.totalDueSatang,
    },
    ledger: {
      offer: proposed.map(line),
      work: input.jobs.filter((job) => isActiveJob(job.status)).map(line),
      done: input.jobs
        .filter((job) => job.status === "COMPLETED" || job.status === "DECLINED" || job.status === "CANCELLED")
        .map(line),
    },
    findingsCount: input.findings.length,
  };
}

/** D-2 precedence, then oldest first — the list's one order. */
export function sortBoard(rows: BoardCase[]): BoardCase[] {
  const rank = new Map(BOARD_GROUPS.map((group, index) => [group, index]));
  return [...rows].sort(
    (a, b) => rank.get(a.stage)! - rank.get(b.stage)! || b.ageDays - a.ageDays,
  );
}

/* ------------------------------------------------------------------ */
/* The spine strip (D-26): five segments over the rows.                */
/* ------------------------------------------------------------------ */

export const SPINE_SEGMENTS = ["ASSESSMENT", "AUTHORIZATION", "WORK", "READY", "OWED"] as const;
export type SpineSegment = (typeof SPINE_SEGMENTS)[number];

export const SEGMENT_STAGES: Record<SpineSegment, readonly BoardGroup[]> = {
  ASSESSMENT: ["IN_ASSESSMENT"],
  AUTHORIZATION: ["AWAITING_AUTH"],
  WORK: ["WAITING", "IN_PROGRESS", "IN_QC"],
  READY: ["READY"],
  OWED: ["BALANCE_DUE"],
};

export type SpineSummary = {
  segment: SpineSegment;
  count: number;
  /** Lit when a case in it needs the advisor. */
  hot: boolean;
  oldestDays: number;
  amountSatang: number;
  /** WORK only: waiting / QC counts and who is on the floor. */
  waiting: number;
  inQc: number;
  technicians: string[];
  unpriced: number;
  uncollected: number;
};

export function spineSummary(rows: BoardCase[]): SpineSummary[] {
  return SPINE_SEGMENTS.map((segment) => {
    const stages = SEGMENT_STAGES[segment];
    const members = rows.filter((row) => stages.includes(row.stage));
    const amountSatang = members.reduce((sum, row) => {
      if (segment === "AUTHORIZATION") return sum + row.offerTotalSatang;
      if (segment === "READY" || segment === "OWED") return sum + row.balance.totalDueSatang;
      return sum;
    }, 0);
    return {
      segment,
      count: members.length,
      hot: members.some((row) => row.needsMe),
      oldestDays: members.reduce((max, row) => Math.max(max, row.ageDays), 0),
      amountSatang,
      waiting: members.filter((row) => row.stage === "WAITING").length,
      inQc: members.filter((row) => row.stage === "IN_QC").length,
      technicians: [...new Set(members.flatMap((row) => row.technicians))],
      unpriced: members.filter((row) => row.pill.kind === "UNPRICED").length,
      uncollected: members.filter((row) => row.pill.kind === "NOT_COLLECTED").length,
    };
  });
}

/** Plate / contact / reference / make-model search, diacritic-tolerant enough for Thai plates. */
export function matchesSearch(row: BoardCase, query: string): boolean {
  const q = query.trim().toLocaleLowerCase().replace(/[\s-]/g, "");
  if (!q) return true;
  const hay = [row.plate, row.reference, row.contactName, row.contactPhone, row.make, row.model]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .replace(/[\s-]/g, "");
  return hay.includes(q);
}
