import type {
  AuthorizationChannel,
  AuthorizationDecision,
  JobStatus,
  PartOrderStatus,
  PayerType,
  WaitingReason,
} from "@/lib/generated/prisma/enums";

/**
 * Job & Quotation domain helpers (M4 brief). DTO shapes are what server
 * actions return and the case page's Jobs panel holds as client state —
 * everything serializable across the RSC boundary (dates as ISO strings,
 * money as integer satang per lib/money.ts).
 */

/** Stable UI orderings. */
export const PAYER_TYPES = ["CUSTOMER", "INSURER"] as const satisfies readonly PayerType[];
export const AUTH_CHANNELS = ["LINE", "PHONE", "IN_PERSON", "OTHER"] as const satisfies
  readonly AuthorizationChannel[];
export const PART_ORDER_STATUSES = ["NOT_ORDERED", "ORDERED", "ARRIVED"] as const satisfies
  readonly PartOrderStatus[];

/** Statuses a Job can still be offered under — never Declined/Cancelled. */
export function isQuotable(status: JobStatus): boolean {
  return status !== "DECLINED" && status !== "CANCELLED";
}

/**
 * Quotation numbering (founder ruling): one lineage per case, derived from
 * the case reference — RC-1024 → Q-1024. Versions count up per issue.
 */
export function quotationNumberFor(caseReference: string): string {
  return `Q-${caseReference.replace(/^RC-?/, "")}`;
}

/** Display label: v1 shows bare (Q-1024), later versions Q-1024-v2 (CONTEXT.md). */
export function quotationLabel(number: string, version: number): string {
  return version === 1 ? number : `${number}-v${version}`;
}

export type PartLineDto = {
  id: string;
  name: string;
  quantity: number;
  unitCostSatang: number | null;
  supplier: string | null;
  orderStatus: PartOrderStatus;
  etaDate: string | null; // ISO date
  note: string | null;
};

export type AuthorizationDto = {
  id: string;
  decision: AuthorizationDecision;
  channel: AuthorizationChannel | null;
  quotationLabel: string | null;
  note: string | null;
  recordedAt: string;
  recordedByName: string;
};

/** What a Job card needs to render a fulfilled Finding as a chip. */
export type JobFindingRef = {
  id: string;
  source: "DAMAGE_MAP" | "CHECKLIST";
  zone: string | null;
  checklistItem: string | null;
};

export type JobDto = {
  id: string;
  title: string;
  status: JobStatus;
  /** Set while WAITING (lib/case-flow.ts), NULL otherwise. */
  waitingReason: WaitingReason | null;
  payerType: PayerType;
  insurerName: string | null;
  catalogItemId: string | null;
  catalogItemName: string | null;
  /** The catalog entry's CURRENT price — shown beside an override. */
  catalogPriceSatang: number | null;
  priceSatang: number | null;
  priceOverriddenByName: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  note: string | null;
  findings: JobFindingRef[];
  partLines: PartLineDto[];
  photos: { id: string }[];
  authorizations: AuthorizationDto[];
  /** The JOB_CANCELLED event, when one exists — D-7's one-line rendering. */
  cancelled: { note: string | null; at: string; byName: string } | null;
  createdAt: string;
};

export type QuotationLineDto = {
  jobId: string | null;
  title: string;
  priceSatang: number;
  payerType: PayerType;
  insurerName: string | null;
};

export type QuotationDto = {
  id: string;
  number: string;
  version: number;
  label: string;
  totalSatang: number;
  issuedAt: string;
  issuedByName: string;
  lines: QuotationLineDto[];
};

/**
 * Staleness of the LATEST quotation (M4 brief §6): true when the offer on
 * the table no longer matches the live Jobs — a line's Job was deleted or
 * re-priced, or a priced, still-quotable Job exists that the quotation
 * doesn't cover. Issuing stays a human act; this only nudges.
 */
/**
 * True while a priced PROPOSED Job is covered by no Quotation line at its
 * current price — the D-6 trigger for suggesting Issue quotation on an
 * Awaiting-authorization case. A suggestion only: a Quotation is the
 * professional path, never a gate (founder ruling 2026-08-27).
 */
export function hasUnquotedProposed(
  jobs: Pick<JobDto, "id" | "status" | "priceSatang">[],
  quotations: { lines: Pick<QuotationLineDto, "jobId" | "priceSatang">[] }[],
): boolean {
  return jobs.some(
    (job) =>
      job.status === "PROPOSED" &&
      job.priceSatang != null &&
      !quotations.some((quotation) =>
        quotation.lines.some(
          (line) => line.jobId === job.id && line.priceSatang === job.priceSatang,
        ),
      ),
  );
}

export function isQuotationStale(
  quotation: Pick<QuotationDto, "lines">,
  jobs: Pick<JobDto, "id" | "status" | "priceSatang">[],
): boolean {
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  for (const line of quotation.lines) {
    const job = line.jobId ? jobById.get(line.jobId) : undefined;
    if (!job) return true; // the offered Job no longer exists
    if (job.priceSatang !== line.priceSatang) return true;
  }
  const covered = new Set(quotation.lines.map((line) => line.jobId));
  return jobs.some(
    (job) => job.priceSatang != null && isQuotable(job.status) && !covered.has(job.id),
  );
}
