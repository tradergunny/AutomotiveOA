import type { Prisma } from "@/lib/generated/prisma/client";
import type { FindingCondition, FollowUpStatus } from "@/lib/generated/prisma/enums";

/**
 * The one FollowUp query shape (M7): what the worklist loads and what every
 * follow-up action returns, mapped to the serializable dto the client list
 * holds. The job-dto.ts idiom — a plain helper outside "use server".
 */

export const FOLLOW_UP_INCLUDE = {
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      lineContacts: { select: { followState: true } },
    },
  },
  repairCase: {
    select: {
      id: true,
      reference: true,
      deliveredAt: true,
      vehicle: { select: { plate: true } },
    },
  },
  lastActionBy: { select: { name: true } },
} as const satisfies Prisma.FollowUpInclude;

export type FollowUpWithRelations = Prisma.FollowUpGetPayload<{
  include: typeof FOLLOW_UP_INCLUDE;
}>;

/** Whether a LINE push could reach this customer right now (M6 states). */
export type FollowUpLineState = "linked" | "unfollowed" | "none";

export type FollowUpDto = {
  id: string;
  status: FollowUpStatus;
  snoozedUntil: string | null; // ISO date
  /** Job-sourced: the declined Job's snapshot. */
  jobTitle: string | null;
  quotedPriceSatang: number | null;
  /** Finding-sourced: canonical ids, rendered through i18n. */
  checklistItem: string | null;
  condition: FindingCondition | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  lineState: FollowUpLineState;
  caseId: string;
  caseReference: string;
  plate: string;
  deliveredAt: string | null;
  lastActionByName: string | null;
  lastActionAt: string | null;
  lastActionNote: string | null;
  createdAt: string;
};

export function toFollowUpDto(row: FollowUpWithRelations): FollowUpDto {
  const contact = row.customer.lineContacts[0];
  return {
    id: row.id,
    status: row.status,
    snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString().slice(0, 10) : null,
    jobTitle: row.jobTitle,
    quotedPriceSatang: row.quotedPriceSatang,
    checklistItem: row.checklistItem,
    condition: row.condition,
    customerId: row.customer.id,
    customerName: row.customer.name,
    customerPhone: row.customer.phone,
    lineState: !contact ? "none" : contact.followState === "UNFOLLOWED" ? "unfollowed" : "linked",
    caseId: row.repairCase.id,
    caseReference: row.repairCase.reference,
    plate: row.repairCase.vehicle.plate,
    deliveredAt: row.repairCase.deliveredAt ? row.repairCase.deliveredAt.toISOString() : null,
    lastActionByName: row.lastActionBy?.name ?? null,
    lastActionAt: row.lastActionAt ? row.lastActionAt.toISOString() : null,
    lastActionNote: row.lastActionNote,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Actionable = OPEN, or SNOOZED whose date has passed — derived on read
 * (nothing wakes up or pings on its own, ADR-003). `today` is an ISO date
 * so client and server compare the same way.
 */
export function isActionable(
  followUp: Pick<FollowUpDto, "status" | "snoozedUntil">,
  today: string,
): boolean {
  if (followUp.status === "OPEN") return true;
  if (followUp.status === "SNOOZED") {
    return followUp.snoozedUntil != null && followUp.snoozedUntil <= today;
  }
  return false;
}
