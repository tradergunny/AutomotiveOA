import type { Prisma } from "@/lib/generated/prisma/client";
import { quotationLabel, type JobDto, type QuotationDto } from "@/lib/jobs";

/**
 * The one Job query shape (M4): what the case page loads and what every job
 * action returns, mapped to the serializable JobDto the client panel holds.
 * Lives outside the "use server" module so it is a plain helper, not an
 * exposed action.
 */

export const JOB_INCLUDE = {
  catalogItem: { select: { name: true, priceSatang: true } },
  priceOverriddenBy: { select: { name: true } },
  assignedStaff: { select: { name: true } },
  findings: {
    select: { id: true, source: true, zone: true, checklistItem: true },
    orderBy: { recordedAt: "asc" },
  },
  partLines: { orderBy: { createdAt: "asc" } },
  photos: { select: { id: true }, orderBy: { capturedAt: "asc" } },
  authorizations: {
    include: {
      recordedBy: { select: { name: true } },
      quotation: { select: { number: true, version: true } },
    },
    orderBy: { recordedAt: "asc" },
  },
  // The one-line Cancelled rendering (D-7) needs the reason, which lives on
  // the JOB_CANCELLED event, not the Job row; the Completed receipt (D-23)
  // needs who passed QC and when, which lives on JOB_QC_PASSED.
  events: {
    where: { type: { in: ["JOB_CANCELLED", "JOB_QC_PASSED"] } },
    orderBy: { at: "desc" },
    select: { type: true, note: true, at: true, actorStaff: { select: { name: true } } },
  },
} as const satisfies Prisma.JobInclude;

export type JobWithRelations = Prisma.JobGetPayload<{ include: typeof JOB_INCLUDE }>;

export function toJobDto(row: JobWithRelations): JobDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    waitingReason: row.waitingReason,
    payerType: row.payerType,
    insurerName: row.insurerName,
    catalogItemId: row.catalogItemId,
    catalogItemName: row.catalogItem?.name ?? null,
    catalogPriceSatang: row.catalogItem?.priceSatang ?? null,
    priceSatang: row.priceSatang,
    priceOverriddenByName: row.priceOverriddenBy?.name ?? null,
    assignedStaffId: row.assignedStaffId,
    assignedStaffName: row.assignedStaff?.name ?? null,
    note: row.note,
    findings: row.findings,
    partLines: row.partLines.map((line) => ({
      id: line.id,
      name: line.name,
      quantity: line.quantity,
      unitCostSatang: line.unitCostSatang,
      supplier: line.supplier,
      orderStatus: line.orderStatus,
      etaDate: line.etaDate ? line.etaDate.toISOString().slice(0, 10) : null,
      note: line.note,
    })),
    photos: row.photos,
    authorizations: row.authorizations.map((auth) => ({
      id: auth.id,
      decision: auth.decision,
      channel: auth.channel,
      quotationLabel: auth.quotation
        ? quotationLabel(auth.quotation.number, auth.quotation.version)
        : null,
      note: auth.note,
      recordedAt: auth.recordedAt.toISOString(),
      recordedByName: auth.recordedBy.name,
    })),
    cancelled: (() => {
      const event = row.events.find((e) => e.type === "JOB_CANCELLED");
      return event
        ? { note: event.note, at: event.at.toISOString(), byName: event.actorStaff.name }
        : null;
    })(),
    qcPassed: (() => {
      const event = row.events.find((e) => e.type === "JOB_QC_PASSED");
      return event ? { at: event.at.toISOString(), byName: event.actorStaff.name } : null;
    })(),
    createdAt: row.createdAt.toISOString(),
  };
}

export const QUOTATION_INCLUDE = {
  lines: { orderBy: { sortOrder: "asc" } },
  issuedBy: { select: { name: true } },
  // The last time this version reached the customer (M7.7, D-25) — what the
  // Offer's foot reads as "sent Sep 2 via LINE".
  lineUpdates: {
    where: { deliveryStatus: "SENT" },
    orderBy: { sentAt: "desc" },
    take: 1,
    select: { sentAt: true },
  },
} as const satisfies Prisma.QuotationInclude;

export type QuotationWithRelations = Prisma.QuotationGetPayload<{
  include: typeof QUOTATION_INCLUDE;
}>;

export function toQuotationDto(row: QuotationWithRelations): QuotationDto {
  return {
    id: row.id,
    number: row.number,
    version: row.version,
    label: quotationLabel(row.number, row.version),
    totalSatang: row.totalSatang,
    issuedAt: row.issuedAt.toISOString(),
    issuedByName: row.issuedBy.name,
    publicToken: row.publicToken,
    sentAt: row.lineUpdates[0]?.sentAt.toISOString() ?? null,
    lines: row.lines.map((line) => ({
      jobId: line.jobId,
      title: line.title,
      priceSatang: line.priceSatang,
      payerType: line.payerType,
      insurerName: line.insurerName,
    })),
  };
}
