import { describe, expect, it } from "vitest";
import { caseBalance, isOwedJob, type BalanceJob, type BalancePayment } from "@/lib/payments";
import type { JobStatus } from "@/lib/generated/prisma/enums";

/**
 * The M7 balance ruling (decision 2), pinned: owed = authorized-or-beyond
 * minus non-voided payments, per payer side; DECLINED and CANCELLED owe
 * nothing; voids restore the debt; sides can go negative (overpaid).
 */

const job = (
  status: JobStatus,
  priceSatang: number | null,
  payerType: "CUSTOMER" | "INSURER" = "CUSTOMER",
): BalanceJob => ({ status, payerType, priceSatang });

const pay = (
  amountSatang: number,
  payerType: "CUSTOMER" | "INSURER" = "CUSTOMER",
  voidedAt: string | null = null,
): BalancePayment => ({ payerType, amountSatang, voidedAt });

describe("isOwedJob", () => {
  it("owes for authorized-or-beyond, never for the rest", () => {
    const owed: JobStatus[] = ["AUTHORIZED", "WAITING", "IN_PROGRESS", "QC", "COMPLETED"];
    const notOwed: JobStatus[] = ["PROPOSED", "DECLINED", "CANCELLED"];
    for (const status of owed) expect(isOwedJob(status), status).toBe(true);
    for (const status of notOwed) expect(isOwedJob(status), status).toBe(false);
  });
});

describe("caseBalance", () => {
  it("sums each payer side independently", () => {
    const balance = caseBalance(
      [
        job("COMPLETED", 500_000, "CUSTOMER"),
        job("IN_PROGRESS", 1_800_000, "INSURER"),
        job("AUTHORIZED", 280_000, "CUSTOMER"),
      ],
      [pay(300_000, "CUSTOMER")],
    );
    expect(balance.customer).toEqual({
      owedSatang: 780_000,
      paidSatang: 300_000,
      dueSatang: 480_000,
      present: true,
    });
    expect(balance.insurer.dueSatang).toBe(1_800_000);
    expect(balance.totalDueSatang).toBe(2_280_000);
    expect(balance.mixed).toBe(true);
  });

  it("DECLINED and CANCELLED owe nothing; PROPOSED not yet", () => {
    const balance = caseBalance(
      [
        job("DECLINED", 1_800_000),
        job("CANCELLED", 900_000),
        job("PROPOSED", 400_000),
      ],
      [],
    );
    expect(balance.customer.owedSatang).toBe(0);
    expect(balance.customer.present).toBe(false);
    expect(balance.totalDueSatang).toBe(0);
  });

  it("voided payments do not count — a void resurrects the debt", () => {
    const jobs = [job("COMPLETED", 500_000)];
    const settled = caseBalance(jobs, [pay(500_000)]);
    expect(settled.customer.dueSatang).toBe(0);
    const voided = caseBalance(jobs, [pay(500_000, "CUSTOMER", "2026-08-27T00:00:00Z")]);
    expect(voided.customer.dueSatang).toBe(500_000);
  });

  it("a side can be overpaid (negative due) while the blended total stays honest", () => {
    // The deductible shape (decision 2's stated cost): customer pays the
    // first slice of an insurer job. Blended total stays correct; the split
    // shows the skew.
    const jobs = [job("COMPLETED", 1_000_000, "INSURER")];
    const balance = caseBalance(jobs, [
      pay(200_000, "CUSTOMER"), // ค่าเสียหายส่วนแรก
      pay(800_000, "INSURER"),
    ]);
    expect(balance.customer.dueSatang).toBe(-200_000);
    expect(balance.customer.present).toBe(true);
    expect(balance.insurer.dueSatang).toBe(200_000);
    expect(balance.totalDueSatang).toBe(0);
  });

  it("an unpriced job counts as zero, defensively", () => {
    const balance = caseBalance([job("AUTHORIZED", null)], []);
    expect(balance.customer.owedSatang).toBe(0);
  });

  it("single-payer cases are not mixed", () => {
    const balance = caseBalance([job("COMPLETED", 100_000)], [pay(100_000)]);
    expect(balance.mixed).toBe(false);
    expect(balance.customer.present).toBe(true);
    expect(balance.insurer.present).toBe(false);
  });
});
