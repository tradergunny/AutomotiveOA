import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * The one CaseEvent query shape the internal timeline renders from. Lives
 * outside the client component (M7.5: the timeline collapses client-side)
 * so the server page can keep using it in its Prisma query.
 */
export const CASE_EVENT_INCLUDE = {
  actorStaff: { select: { name: true } },
  subjectStaff: { select: { name: true } },
  quotation: { select: { number: true, version: true } },
  lineUpdate: {
    select: {
      _count: { select: { photos: true } },
      quotation: { select: { number: true, version: true } },
    },
  },
  payment: { select: { method: true, payerType: true, insurerName: true } },
  followUp: { select: { checklistItem: true } },
} as const satisfies Prisma.CaseEventInclude;

export type CaseEventRow = Prisma.CaseEventGetPayload<{
  include: typeof CASE_EVENT_INCLUDE;
}>;
