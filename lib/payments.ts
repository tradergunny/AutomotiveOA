import type { JobStatus, PayerType, PaymentMethod } from "@/lib/generated/prisma/enums";

/**
 * Payment & balance domain helpers (M7 brief, decision 2 — ruled by the
 * founder). The balance is derived, per payer side, and NEVER re-derived ad
 * hoc: the case header, the board, and the money section all call
 * caseBalance(). Pure logic, unit-tested, serializable everywhere.
 *
 * owed(side) = Σ price of that side's currently-authorized-or-beyond Jobs
 *              − Σ that side's non-voided Payments.
 *
 * DECLINED never owes (never authorized); CANCELLED deliberately owes
 * nothing in MVP — billing partially-done stopped work is real-world messy
 * and sits on the interview checklist. Every counted Job has a price by
 * construction (M4: authorization requires one); a NULL price counts as 0
 * defensively. dueSatang can be negative — an overpaid side (e.g. a
 * deductible recorded as a customer Payment on an insurer Job) renders as
 * "overpaid", never a bare minus.
 */

/** Stable UI ordering (CONTEXT.md's fixed set — PromptPay is a transfer). */
export const PAYMENT_METHODS = ["CASH", "TRANSFER", "CARD"] as const satisfies
  readonly PaymentMethod[];

/** Authorized-or-beyond: the statuses whose price is owed. */
export const OWED_JOB_STATUSES = ["AUTHORIZED", "WAITING", "IN_PROGRESS", "QC", "COMPLETED"] as const satisfies
  readonly JobStatus[];

export function isOwedJob(status: JobStatus): boolean {
  return (OWED_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

export type BalanceJob = {
  status: JobStatus;
  payerType: PayerType;
  priceSatang: number | null;
};

export type BalancePayment = {
  payerType: PayerType;
  amountSatang: number;
  /** Any non-null value means voided — Date server-side, ISO string in DTOs. */
  voidedAt: Date | string | null;
};

export type SideBalance = {
  owedSatang: number;
  paidSatang: number;
  /** owed − paid; negative = overpaid. */
  dueSatang: number;
  /** Money ever moved or was owed on this side — whether the side renders. */
  present: boolean;
};

export type CaseBalance = {
  customer: SideBalance;
  insurer: SideBalance;
  /** Blended sum of both dues — drives Balance-due board membership. */
  totalDueSatang: number;
  /** Both sides present → the UI shows the split, never one blended number. */
  mixed: boolean;
};

function sideBalance(
  side: PayerType,
  jobs: readonly BalanceJob[],
  payments: readonly BalancePayment[],
): SideBalance {
  let owedSatang = 0;
  for (const job of jobs) {
    if (job.payerType === side && isOwedJob(job.status)) {
      owedSatang += job.priceSatang ?? 0;
    }
  }
  let paidSatang = 0;
  for (const payment of payments) {
    if (payment.payerType === side && payment.voidedAt == null) {
      paidSatang += payment.amountSatang;
    }
  }
  return {
    owedSatang,
    paidSatang,
    dueSatang: owedSatang - paidSatang,
    present: owedSatang !== 0 || paidSatang !== 0,
  };
}

export function caseBalance(
  jobs: readonly BalanceJob[],
  payments: readonly BalancePayment[],
): CaseBalance {
  const customer = sideBalance("CUSTOMER", jobs, payments);
  const insurer = sideBalance("INSURER", jobs, payments);
  return {
    customer,
    insurer,
    totalDueSatang: customer.dueSatang + insurer.dueSatang,
    mixed: customer.present && insurer.present,
  };
}

/** What the case page's payment list holds — serializable across the RSC boundary. */
export type PaymentDto = {
  id: string;
  payerType: PayerType;
  insurerName: string | null;
  amountSatang: number;
  method: PaymentMethod;
  receivedAt: string; // ISO date
  note: string | null;
  recordedAt: string;
  recordedByName: string;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
};
