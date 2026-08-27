"use server";

import { revalidatePath } from "next/cache";
import type { PayerType, PaymentMethod } from "@/lib/generated/prisma/enums";
import { PAYER_TYPES } from "@/lib/jobs";
import { bahtToSatang } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentDto } from "@/lib/payments";
import { can } from "@/lib/permissions";
import { tenantContext } from "@/lib/session";
import { PAYMENT_INCLUDE, toPaymentDto } from "./payment-dto";

/**
 * Payment actions (M7 brief §3, decision 3 — ruled by the founder). Payment
 * is append-only: recording creates a complete row and NO update path exists
 * for amount, method, payer, date, or note. The one mutable surface is the
 * one-way void — Manager-only, reason required, never cleared; a mistyped
 * payment is voided and re-entered. Both record and void write their
 * CaseEvent in the same transaction.
 *
 * Deliberately NO delivered-case guard (decision 5's re-scoped freeze):
 * insurers pay weeks late, so money must land on DELIVERED cases — that is
 * the entire reason the board's Balance-due group exists.
 */

export type PaymentError =
  | "caseMissing"
  | "amountInvalid"
  | "invalidInput"
  | "insurerRequired"
  | "dateInvalid"
  | "paymentMissing"
  | "alreadyVoided"
  | "reasonRequired"
  | "forbidden"
  | "failed";

export type PaymentActionResult =
  | { ok: true; value: PaymentDto }
  | { ok: false; error: PaymentError };

const MAX_TEXT_LENGTH = 300;
const MAX_NOTE_LENGTH = 2000;

class PaymentInputError extends Error {
  constructor(readonly code: PaymentError) {
    super(`payment input: ${code}`);
  }
}

function fail(error: unknown): { ok: false; error: PaymentError } {
  if (error instanceof PaymentInputError) return { ok: false, error: error.code };
  console.error("[payments] failed:", error);
  return { ok: false, error: "failed" };
}

function cleanText(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim().slice(0, max);
  return text || null;
}

function revalidateMoney(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/"); // balance drives Ready-row chips and the Balance-due group
}

export async function recordPayment(
  caseId: string,
  input: {
    amount: string;
    method: string;
    payerType: string;
    insurerName?: string;
    receivedAt: string; // yyyy-mm-dd
    note?: string;
  },
): Promise<PaymentActionResult> {
  try {
    const { session, db } = await tenantContext();

    // The case must exist in this shop — ANY status, including DELIVERED.
    const repairCase = await db.repairCase.findUnique({
      where: { id: caseId },
      select: { id: true, contactCustomerId: true },
    });
    if (!repairCase) throw new PaymentInputError("caseMissing");

    const amountSatang = bahtToSatang(input.amount);
    if (amountSatang == null || amountSatang <= 0) throw new PaymentInputError("amountInvalid");

    if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) {
      throw new PaymentInputError("invalidInput");
    }
    if (!(PAYER_TYPES as readonly string[]).includes(input.payerType)) {
      throw new PaymentInputError("invalidInput");
    }
    const payerType = input.payerType as PayerType;
    const insurerName = cleanText(input.insurerName, MAX_TEXT_LENGTH);
    if (payerType === "INSURER" && !insurerName) throw new PaymentInputError("insurerRequired");

    // Date-only, like PartLine.etaDate — money is often entered after it arrived.
    const receivedAt = new Date(`${input.receivedAt}T00:00:00Z`);
    if (!input.receivedAt || Number.isNaN(receivedAt.getTime())) {
      throw new PaymentInputError("dateInvalid");
    }

    const note = cleanText(input.note, MAX_NOTE_LENGTH);

    const payment = await db.$transaction(async (tx) => {
      const row = await tx.payment.create({
        data: {
          shopId: session.shopId,
          caseId,
          payerType,
          // The person credited with the spending (decision 6): the case's
          // contact Customer. MVP does not ask who physically handed over
          // the cash — interview checklist.
          customerId: payerType === "CUSTOMER" ? repairCase.contactCustomerId : null,
          insurerName: payerType === "INSURER" ? insurerName : null,
          amountSatang,
          method: input.method as PaymentMethod,
          receivedAt,
          note,
          recordedByStaffId: session.staffId,
        },
        include: PAYMENT_INCLUDE,
      });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId,
          type: "PAYMENT_RECORDED",
          paymentId: row.id,
          priceSatang: amountSatang,
          actorStaffId: session.staffId,
        },
      });
      return row;
    });

    revalidateMoney(caseId);
    return { ok: true, value: toPaymentDto(payment) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * The one-way void (decision 3): Manager-only, reason required, set once and
 * never cleared. Un-voiding is re-entering the payment.
 */
export async function voidPayment(
  paymentId: string,
  reason: string,
): Promise<PaymentActionResult> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "payment.void")) throw new PaymentInputError("forbidden");

    const voidReason = cleanText(reason, MAX_NOTE_LENGTH);
    if (!voidReason) throw new PaymentInputError("reasonRequired");

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, caseId: true, amountSatang: true, voidedAt: true },
    });
    if (!payment) throw new PaymentInputError("paymentMissing");
    if (payment.voidedAt) throw new PaymentInputError("alreadyVoided");

    const voided = await db.$transaction(async (tx) => {
      const row = await tx.payment.update({
        where: { id: paymentId },
        data: {
          voidedAt: new Date(),
          voidedByStaffId: session.staffId,
          voidReason,
        },
        include: PAYMENT_INCLUDE,
      });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId: payment.caseId,
          type: "PAYMENT_VOIDED",
          paymentId,
          priceSatang: payment.amountSatang,
          note: voidReason,
          actorStaffId: session.staffId,
        },
      });
      return row;
    });

    revalidateMoney(payment.caseId);
    return { ok: true, value: toPaymentDto(voided) };
  } catch (error) {
    return fail(error);
  }
}
