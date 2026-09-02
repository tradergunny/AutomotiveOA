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
  /** The latest JOB_QC_PASSED event — the Completed receipt's provenance (D-23). */
  qcPassed: { at: string; byName: string } | null;
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
  /** The document link's token — set once the version was sent (D-25). */
  publicToken: string | null;
  /** When it last reached the customer over LINE, if it ever did. */
  sentAt: string | null;
  lines: QuotationLineDto[];
};

/* ------------------------------------------------------------------ */
/* The Offer (M7.7, CONTEXT.md): the payer parts a Quotation and a     */
/* Response are made against.                                          */
/* ------------------------------------------------------------------ */

/**
 * One payer's half of the Offer. Where a case mixes self-pay and
 * insurer-paid Jobs, each payer sees and answers only their own part, so a
 * Quotation snapshots one part and a Response answers one part.
 */
export type OfferPart = { payerType: PayerType; insurerName: string | null };

export function partKey(part: OfferPart): string {
  return part.payerType === "CUSTOMER" ? "CUSTOMER" : `INSURER:${part.insurerName ?? ""}`;
}

export function samePart(a: OfferPart, b: OfferPart): boolean {
  return partKey(a) === partKey(b);
}

/** A Job's part, with the insurer name dropped for self-pay Jobs. */
export function partOf(job: Pick<JobDto, "payerType" | "insurerName">): OfferPart {
  return {
    payerType: job.payerType,
    insurerName: job.payerType === "INSURER" ? job.insurerName : null,
  };
}

/**
 * The parts the Offer currently holds — Customer first, then insurers by
 * name — from its PROPOSED Jobs. A single-payer Offer is one part.
 */
export function offerParts(
  jobs: Pick<JobDto, "status" | "payerType" | "insurerName">[],
): OfferPart[] {
  const seen = new Map<string, OfferPart>();
  for (const job of jobs) {
    if (job.status !== "PROPOSED") continue;
    const part = partOf(job);
    if (!seen.has(partKey(part))) seen.set(partKey(part), part);
  }
  return [...seen.values()].sort((a, b) => {
    if (a.payerType !== b.payerType) return a.payerType === "CUSTOMER" ? -1 : 1;
    return (a.insurerName ?? "").localeCompare(b.insurerName ?? "");
  });
}

/** The lines a Quotation for this part would carry: priced and still on offer. */
export function pricedOfferLines<
  T extends Pick<JobDto, "status" | "priceSatang" | "payerType" | "insurerName">,
>(jobs: T[], part: OfferPart): T[] {
  return jobs.filter(
    (job) => job.status === "PROPOSED" && job.priceSatang != null && samePart(partOf(job), part),
  );
}

/**
 * The reuse rule (D-25): a Quotation covers a set of lines when its lines are
 * exactly those Jobs at exactly those prices. Sending an Offer that a version
 * already covers reuses it; anything else stamps a new version.
 */
export function quotationCovers(
  quotation: { lines: Pick<QuotationLineDto, "jobId" | "priceSatang">[] },
  jobs: Pick<JobDto, "id" | "priceSatang">[],
): boolean {
  if (jobs.length === 0 || quotation.lines.length !== jobs.length) return false;
  const wanted = new Map(jobs.map((job) => [job.id, job.priceSatang]));
  return quotation.lines.every(
    (line) => line.jobId != null && wanted.get(line.jobId) === line.priceSatang,
  );
}

/** The latest Quotation covering these lines (quotations newest first), or null. */
export function coveringQuotation<Q extends { lines: Pick<QuotationLineDto, "jobId" | "priceSatang">[] }>(
  quotations: Q[],
  jobs: Pick<JobDto, "id" | "priceSatang">[],
): Q | null {
  return quotations.find((quotation) => quotationCovers(quotation, jobs)) ?? null;
}

/** The latest Quotation issued for this payer part, whatever it covers now. */
export function latestQuotationForPart<
  Q extends { lines: Pick<QuotationLineDto, "payerType" | "insurerName">[] },
>(quotations: Q[], part: OfferPart): Q | null {
  return (
    quotations.find(
      (quotation) =>
        quotation.lines.length > 0 && quotation.lines.every((line) => samePart(line, part)),
    ) ?? null
  );
}

/**
 * The header's Send-quotation trigger (D-6 as amended): some part of the
 * Offer holds priced lines that no version covers at their current prices —
 * never sent, or changed since. A suggestion only: a Quotation is the
 * professional path, never a gate.
 */
export function offerNeedsSending(
  jobs: Pick<JobDto, "id" | "status" | "priceSatang" | "payerType" | "insurerName">[],
  quotations: { lines: Pick<QuotationLineDto, "jobId" | "priceSatang">[] }[],
): boolean {
  return offerParts(jobs).some((part) => {
    const lines = pricedOfferLines(jobs, part);
    return lines.length > 0 && coveringQuotation(quotations, lines) === null;
  });
}
