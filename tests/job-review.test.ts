import { describe, expect, it } from "vitest";
import { jobEvidence, reviewForPayer } from "@/lib/job-review";
import type { JobDto, QuotationDto } from "@/lib/jobs";

const customer = { payerType: "CUSTOMER", insurerName: null } as const;
const insurer = { payerType: "INSURER", insurerName: "Insurer" } as const;
function job(id: string, overrides: Partial<JobDto> = {}): JobDto {
  return { id, title: id, status: "PROPOSED", waitingReason: null, ...customer,
    catalogItemId: null, catalogItemName: null, catalogPriceSatang: null,
    priceSatang: 10000, priceOverriddenByName: null, assignedStaffId: null,
    assignedStaffName: null, note: null, findings: [], photos: [], partLines: [],
    authorizations: [], cancelled: null, qcPassed: null, createdAt: "2026-09-17", ...overrides };
}
function quote(jobs: JobDto[], overrides: Partial<QuotationDto> = {}): QuotationDto {
  return { id: "q1", number: "Q-1", version: 1, label: "Q-1", totalSatang: 20000,
    issuedAt: "2026-09-17", issuedByName: "Advisor", publicToken: null, sentAt: "2026-09-17",
    lines: jobs.map((job) => ({ jobId: job.id, title: job.title, priceSatang: job.priceSatang!, payerType: job.payerType, insurerName: job.insurerName })), ...overrides };
}

describe("payer quotation review", () => {
  it("keeps a partially answered quotation current for the remaining job", () => {
    const jobs = [job("a"), job("b")];
    const sent = quote(jobs);
    jobs[0].status = "AUTHORIZED";
    jobs[0].authorizations = [{ id: "auth", decision: "AUTHORIZED", quotationLabel: sent.label,
      channel: "LINE", recordedAt: "2026-09-17", recordedByName: "Advisor", note: null }];
    expect(reviewForPayer(jobs, [sent], customer)).toMatchObject({ changed: false, readyForResponse: true, approved: 1, totalSatang: 20000 });
  });
  it("flags changed, deleted and newly proposed quoted lines", () => {
    const jobs = [job("a"), job("b")], sent = quote(jobs);
    expect(reviewForPayer([job("a", { priceSatang: 12000 }), jobs[1]], [sent], customer).changed).toBe(true);
    expect(reviewForPayer([jobs[0]], [sent], customer).changed).toBe(true);
    expect(reviewForPayer([...jobs, job("c")], [sent], customer).changed).toBe(true);
  });
  it("does not claim successful delivery for an issued but unsent customer quotation", () => {
    const jobs = [job("a")];
    expect(reviewForPayer(jobs, [quote(jobs, { sentAt: null })], customer).readyForResponse).toBe(false);
  });
  it("allows response recording for an insurer's prepared document and isolates payers", () => {
    const customerJob = job("customer"), insurerJob = job("insurer", insurer);
    const review = reviewForPayer([customerJob, insurerJob], [quote([insurerJob], { sentAt: null })], insurer);
    expect(review.readyForResponse).toBe(true);
    expect(review.pending.map((job) => job.id)).toEqual(["insurer"]);
  });
  it("keeps unpriced excluded lines visible without invalidating the sent priced lines", () => {
    const priced = job("a"), unpriced = job("b", { priceSatang: null });
    expect(reviewForPayer([priced, unpriced], [quote([priced])], customer)).toMatchObject({ changed: false, unpriced: 1, readyForResponse: true });
  });
  it("retains quotation and declined outcomes after all jobs leave the offer", () => {
    const proposed = job("a"), sent = quote([proposed]);
    const declined = job("a", { status: "DECLINED", authorizations: [{ id: "decision", decision: "DECLINED", quotationLabel: sent.label, channel: "PHONE", recordedAt: "2026-09-17", recordedByName: "Advisor", note: null }] });
    expect(reviewForPayer([declined], [sent], customer)).toMatchObject({ pending: [], quotation: sent, declined: 1, readyForResponse: false });
  });
});

describe("repair evidence", () => {
  it("includes inspection evidence before job uploads without duplicates", () => {
    const repair = job("a", { photos: [{ id: "shared" }, { id: "work" }], findings: [{ id: "finding", source: "DAMAGE_MAP", zone: "HOOD", checklistItem: null, photos: [{ id: "damage" }, { id: "shared" }] }] });
    expect(jobEvidence(repair).map((photo) => photo.id)).toEqual(["damage", "shared", "work"]);
  });
});
