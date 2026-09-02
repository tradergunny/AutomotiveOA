import { describe, expect, it } from "vitest";
import {
  coveringQuotation,
  latestQuotationForPart,
  offerNeedsSending,
  offerParts,
  pricedOfferLines,
  quotationCovers,
} from "@/lib/jobs";
import { buildQuotationBody } from "@/lib/line-draft";
import { deriveLineTitle, isLineFrozen, mergeSurvivor, mergedPrice } from "@/lib/offer";
import type { JobStatus, PayerType } from "@/lib/generated/prisma/enums";

/**
 * The Offer's pure rules (M7.7; D-24, D-25): where a Finding freezes, what a
 * merged line is priced at, which version a send reuses, and what the header
 * reads as "unsent or stale". The database half lives in jobs-flow.test.ts.
 */

const job = (
  id: string,
  priceSatang: number | null,
  status: JobStatus = "PROPOSED",
  payerType: PayerType = "CUSTOMER",
  insurerName: string | null = null,
) => ({ id, status, priceSatang, payerType, insurerName });

const quote = (lines: { jobId: string | null; priceSatang: number; payerType?: PayerType; insurerName?: string | null }[]) => ({
  lines: lines.map((line) => ({
    payerType: "CUSTOMER" as PayerType,
    insurerName: null,
    ...line,
  })),
});

describe("isLineFrozen: the freeze point moves to priced-or-sent (D-24)", () => {
  it("leaves a Proposed, unpriced, unsent line editable", () => {
    expect(isLineFrozen({ status: "PROPOSED", priceSatang: null, quotationLineCount: 0 })).toBe(false);
  });
  it("freezes on a price", () => {
    expect(isLineFrozen({ status: "PROPOSED", priceSatang: 100, quotationLineCount: 0 })).toBe(true);
  });
  it("freezes on a quotation line, even unpriced now", () => {
    expect(isLineFrozen({ status: "PROPOSED", priceSatang: null, quotationLineCount: 1 })).toBe(true);
  });
  it("freezes once the line has left the Offer", () => {
    for (const status of ["AUTHORIZED", "DECLINED", "IN_PROGRESS", "COMPLETED"] as const) {
      expect(isLineFrozen({ status, priceSatang: null, quotationLineCount: 0 }), status).toBe(true);
    }
  });
});

describe("deriveLineTitle: the place and the action words", () => {
  it("joins the label and the mid-sentence action words", () => {
    expect(deriveLineTitle("Hood", ["Repaint"])).toBe("Hood — repaint");
    expect(deriveLineTitle("Front left door", ["Repair", "Repaint"])).toBe(
      "Front left door — repair + repaint",
    );
  });
  it("passes Thai through untouched", () => {
    expect(deriveLineTitle("ฝากระโปรงหน้า", ["ทำสี"])).toBe("ฝากระโปรงหน้า — ทำสี");
  });
  it("is the bare label when nothing is proposed", () => {
    expect(deriveLineTitle("Brakes", [])).toBe("Brakes");
  });
});

describe("mergedPrice: kept only if exactly one part had one", () => {
  it("keeps the single price", () => {
    expect(mergedPrice([null, 1_200_000, null])).toBe(1_200_000);
  });
  it("re-prices when two parts were priced — a repaint is not their sum", () => {
    expect(mergedPrice([500_000, 700_000])).toBeNull();
  });
  it("is unpriced when nothing was", () => {
    expect(mergedPrice([null, null])).toBeNull();
  });
});

describe("mergeSurvivor: the oldest line survives", () => {
  it("picks the earliest createdAt, breaking ties on id", () => {
    const a = { id: "b", createdAt: new Date("2026-09-02T10:00:00Z") };
    const b = { id: "a", createdAt: new Date("2026-09-02T10:00:00Z") };
    const c = { id: "c", createdAt: new Date("2026-09-02T09:00:00Z") };
    expect(mergeSurvivor([a, b, c]).id).toBe("c");
    expect(mergeSurvivor([a, b]).id).toBe("a");
  });
});

describe("offerParts / pricedOfferLines: one part per payer", () => {
  const jobs = [
    job("a", 100, "PROPOSED", "INSURER", "Viriyah"),
    job("b", 200),
    job("c", null),
    job("d", 300, "AUTHORIZED"),
    job("e", 50, "PROPOSED", "INSURER", "Viriyah"),
  ];
  it("lists Customer first, then insurers by name, from Proposed lines only", () => {
    expect(offerParts(jobs)).toEqual([
      { payerType: "CUSTOMER", insurerName: null },
      { payerType: "INSURER", insurerName: "Viriyah" },
    ]);
  });
  it("takes only the priced, still-proposed lines of a part", () => {
    expect(pricedOfferLines(jobs, { payerType: "CUSTOMER", insurerName: null }).map((j) => j.id)).toEqual(["b"]);
    expect(pricedOfferLines(jobs, { payerType: "INSURER", insurerName: "Viriyah" }).map((j) => j.id)).toEqual(["a", "e"]);
  });
});

describe("quotationCovers / coveringQuotation: the reuse rule (D-25)", () => {
  const lines = [job("a", 100), job("b", 200)];
  it("covers exactly these jobs at exactly these prices", () => {
    expect(quotationCovers(quote([{ jobId: "a", priceSatang: 100 }, { jobId: "b", priceSatang: 200 }]), lines)).toBe(true);
  });
  it("does not cover a changed price, a missing line, or an extra line", () => {
    expect(quotationCovers(quote([{ jobId: "a", priceSatang: 100 }, { jobId: "b", priceSatang: 250 }]), lines)).toBe(false);
    expect(quotationCovers(quote([{ jobId: "a", priceSatang: 100 }]), lines)).toBe(false);
    expect(
      quotationCovers(
        quote([{ jobId: "a", priceSatang: 100 }, { jobId: "b", priceSatang: 200 }, { jobId: "c", priceSatang: 1 }]),
        lines,
      ),
    ).toBe(false);
  });
  it("never covers an empty set, and a deleted job's line covers nothing", () => {
    expect(quotationCovers(quote([]), [])).toBe(false);
    expect(quotationCovers(quote([{ jobId: null, priceSatang: 100 }]), [job("a", 100)])).toBe(false);
  });
  it("finds the latest covering version, newest first", () => {
    const v2 = quote([{ jobId: "a", priceSatang: 100 }, { jobId: "b", priceSatang: 200 }]);
    const v1 = quote([{ jobId: "a", priceSatang: 90 }, { jobId: "b", priceSatang: 200 }]);
    expect(coveringQuotation([v2, v1], lines)).toBe(v2);
    expect(coveringQuotation([v1], lines)).toBeNull();
  });
});

describe("latestQuotationForPart: the last send line's version", () => {
  it("returns the newest version whose lines all belong to the part", () => {
    const insurer = quote([{ jobId: "x", priceSatang: 1, payerType: "INSURER", insurerName: "Viriyah" }]);
    const customer = quote([{ jobId: "a", priceSatang: 1 }]);
    expect(latestQuotationForPart([insurer, customer], { payerType: "CUSTOMER", insurerName: null })).toBe(customer);
    expect(latestQuotationForPart([insurer, customer], { payerType: "INSURER", insurerName: "Viriyah" })).toBe(insurer);
    expect(latestQuotationForPart([customer], { payerType: "INSURER", insurerName: "Other" })).toBeNull();
  });
});

describe("offerNeedsSending: the header's Send-quotation trigger", () => {
  it("true while a part's priced lines have no covering version", () => {
    expect(offerNeedsSending([job("a", 100)], [])).toBe(true);
    expect(offerNeedsSending([job("a", 100)], [quote([{ jobId: "a", priceSatang: 90 }])])).toBe(true);
  });
  it("false once every part with priced lines is covered", () => {
    expect(offerNeedsSending([job("a", 100)], [quote([{ jobId: "a", priceSatang: 100 }])])).toBe(false);
  });
  it("ignores unpriced lines and lines that left the Offer", () => {
    expect(offerNeedsSending([job("a", null)], [])).toBe(false);
    expect(offerNeedsSending([job("a", 100, "AUTHORIZED")], [])).toBe(false);
  });
  it("judges each payer part on its own", () => {
    const jobs = [job("a", 100), job("b", 50, "PROPOSED", "INSURER", "Viriyah")];
    const customerOnly = [quote([{ jobId: "a", priceSatang: 100 }])];
    expect(offerNeedsSending(jobs, customerOnly)).toBe(true);
    const both = [
      quote([{ jobId: "b", priceSatang: 50, payerType: "INSURER", insurerName: "Viriyah" }]),
      ...customerOnly,
    ];
    expect(offerNeedsSending(jobs, both)).toBe(false);
  });
});

describe("buildQuotationBody: the Thai message with the document link", () => {
  it("carries the greeting, the number, every line with its price, the total and the link", () => {
    const body = buildQuotationBody({
      shopName: "อู่สมชาย",
      customerName: "ประยุทธ์",
      plate: "กข1234",
      reference: "RC-1024",
      label: "Q-1024-v2",
      lines: [
        { title: "ทำสีฝากระโปรงหน้า", priceSatang: 450_000 },
        { title: "เปลี่ยนผ้าเบรกหน้า", priceSatang: 280_000 },
      ],
      totalSatang: 730_000,
      documentUrl: "https://example.test/q/abc",
    });
    expect(body).toContain("คุณประยุทธ์");
    expect(body).toContain("Q-1024-v2");
    expect(body).toContain("ทำสีฝากระโปรงหน้า — ฿4,500");
    expect(body).toContain("รวม ฿7,300");
    expect(body).toContain("https://example.test/q/abc");
    expect(body.trim().endsWith("อู่สมชาย")).toBe(true);
    expect(body).not.toMatch(/PROPOSED|undefined/);
  });
});
