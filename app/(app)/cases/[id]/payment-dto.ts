import type { Prisma } from "@/lib/generated/prisma/client";
import type { PaymentDto } from "@/lib/payments";

/**
 * The one Payment query shape (M7): what the case page loads and what the
 * payment actions return, mapped to the serializable PaymentDto the client
 * panel holds. The job-dto.ts idiom — a plain helper outside "use server".
 */

export const PAYMENT_INCLUDE = {
  recordedBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
} as const satisfies Prisma.PaymentInclude;

export type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: typeof PAYMENT_INCLUDE;
}>;

export function toPaymentDto(row: PaymentWithRelations): PaymentDto {
  return {
    id: row.id,
    payerType: row.payerType,
    insurerName: row.insurerName,
    amountSatang: row.amountSatang,
    method: row.method,
    receivedAt: row.receivedAt.toISOString().slice(0, 10),
    note: row.note,
    recordedAt: row.recordedAt.toISOString(),
    recordedByName: row.recordedBy.name,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidedByName: row.voidedBy?.name ?? null,
    voidReason: row.voidReason,
  };
}
