import { describe, expect, it } from "vitest";
import {
  buildCatchUpBody,
  buildCheckinBody,
  buildDeliveredBody,
  buildDraftBody,
  buildInQcBody,
  buildJobCompletedBody,
  buildPartsArrivedBody,
  buildReadyBody,
  buildWaitingPartsBody,
  buildWorkStartedBody,
  extractNote,
  formatThaiDate,
  NOTE_MAX_LENGTH,
} from "@/lib/line-draft";

/**
 * M7.10 step 2: one Thai builder per system kind (ADR-007 — the wording is
 * the system's; the optional note is the only human text). These are pure
 * and the assertions are about what a CUSTOMER may read: never the internal
 * vocabulary, the customer's money only, no money at all on the thank-you,
 * the note last, the shop's name as the signature.
 */

const base = {
  shopName: "อู่สมชาย",
  customerName: "ประยุทธ์",
  plate: "กข1234",
  reference: "RC-1024",
};

const INTERNAL = /QC|WAITING|IN_PROGRESS|COMPLETED|DECLINED|CANCELLED|AUTHORIZED|PROPOSED/;

/** Every builder, with representative facts, so the shared rules run over all of them. */
const everyBuilder: Record<string, (note?: string) => string> = {
  CHECKIN: (note) => buildCheckinBody({ ...base, note }),
  WORK_STARTED: (note) => buildWorkStartedBody({ ...base, note }),
  WAITING_PARTS: (note) =>
    buildWaitingPartsBody({ ...base, etaDate: new Date("2026-09-30T00:00:00Z"), note }),
  WAITING_PARTS_NO_ETA: (note) => buildWaitingPartsBody({ ...base, etaDate: null, note }),
  PARTS_ARRIVED: (note) => buildPartsArrivedBody({ ...base, note }),
  JOB_COMPLETED: (note) => buildJobCompletedBody({ ...base, jobTitle: "ทำสีประตูซ้าย", note }),
  IN_QC: (note) => buildInQcBody({ ...base, note }),
  READY: (note) => buildReadyBody({ ...base, customerOwedSatang: 150_000, note }),
  READY_SETTLED: (note) => buildReadyBody({ ...base, customerOwedSatang: 0, note }),
  DELIVERED: (note) => buildDeliveredBody({ ...base, note }),
  CATCH_UP: (note) =>
    buildCatchUpBody({
      ...base,
      caseStatus: "CHECKED_IN",
      jobs: [
        { title: "ทำสีประตูซ้าย", status: "QC", waitingReason: null },
        { title: "เปลี่ยนผ้าเบรก", status: "WAITING", waitingReason: "PARTS" },
        { title: "งานที่ปฏิเสธ", status: "DECLINED", waitingReason: null },
      ],
      note,
    }),
};

describe("every system builder", () => {
  for (const [name, build] of Object.entries(everyBuilder)) {
    it(`${name}: contains no internal vocabulary`, () => {
      expect(build()).not.toMatch(INTERNAL);
    });
    it(`${name}: greets the customer and names the car`, () => {
      const body = build();
      expect(body).toContain(base.customerName);
      expect(body).toContain(base.plate);
      expect(body).toContain(base.reference);
    });
    it(`${name}: ends with the shop name`, () => {
      const lines = build().split("\n");
      expect(lines.at(-1)).toBe(base.shopName);
      expect(lines.at(-2)).toBe("");
    });
    it(`${name}: the note is the last paragraph before the signature`, () => {
      const body = build("  ล้างรถให้แล้วนะคะ  ");
      const paragraphs = body.split("\n\n");
      expect(paragraphs.at(-1)).toBe(base.shopName);
      expect(paragraphs.at(-2)).toBe("ล้างรถให้แล้วนะคะ");
    });
    it(`${name}: a blank note adds nothing`, () => {
      expect(build("   ")).toBe(build());
      expect(build(undefined)).toBe(build());
    });
  }
});

describe("the note", () => {
  it("is trimmed and capped at the maximum length", () => {
    const long = "ก".repeat(NOTE_MAX_LENGTH + 100);
    const body = buildDeliveredBody({ ...base, note: `\n${long}\n` });
    const paragraphs = body.split("\n\n");
    expect(paragraphs.at(-2)).toBe("ก".repeat(NOTE_MAX_LENGTH));
    expect(NOTE_MAX_LENGTH).toBe(300);
  });

  it("keeps its own line breaks inside the paragraph", () => {
    const body = buildReadyBody({ ...base, customerOwedSatang: 0, note: "บรรทัดหนึ่ง\nบรรทัดสอง" });
    expect(body).toContain("บรรทัดหนึ่ง\nบรรทัดสอง");
  });
});

describe("READY", () => {
  it("names the customer's amount and never the insurer's", () => {
    // The builder takes only the Customer-owed figure — an insurer's share
    // (say ฿45,000) has no way in.
    const body = buildReadyBody({ ...base, customerOwedSatang: 150_000 });
    expect(body).toContain("฿1,500");
    expect(body).not.toContain("45,000");
    expect(body).toContain("เข้ามารับ");
  });

  it("omits the money line entirely when nothing is owed", () => {
    const body = buildReadyBody({ ...base, customerOwedSatang: 0 });
    expect(body).not.toContain("฿");
    expect(body).toContain("เข้ามารับ");
  });
});

describe("DELIVERED", () => {
  it("is a thank-you with no baht at all", () => {
    const body = buildDeliveredBody({ ...base });
    expect(body).not.toContain("฿");
    expect(body).not.toMatch(/\d{1,3}(,\d{3})+/);
    expect(body).toContain("ขอบคุณ");
  });
});

describe("WAITING_PARTS", () => {
  it("renders the expected arrival as a Thai date", () => {
    const body = buildWaitingPartsBody({ ...base, etaDate: new Date("2026-09-30T00:00:00Z") });
    expect(body).toContain("30 กันยายน");
    expect(body).not.toContain("2026-09-30");
    expect(body).toContain("รออะไหล่");
  });

  it("copes with no ETA by saying soon", () => {
    const body = buildWaitingPartsBody({ ...base, etaDate: null });
    expect(body).toContain("เร็ว ๆ นี้");
    expect(body).not.toMatch(/\d{1,2} [ก-๙]+ \d{4}/);
  });

  it("formats a date-only value without shifting the day", () => {
    // A @db.Date column comes back as UTC midnight; it must read as that day.
    expect(formatThaiDate(new Date("2026-01-01T00:00:00Z"))).toBe("1 มกราคม 2569");
    expect(formatThaiDate(new Date("2026-12-31T00:00:00Z"))).toBe("31 ธันวาคม 2569");
  });
});

describe("JOB_COMPLETED", () => {
  it("names the finished Job and says its photos follow", () => {
    const body = buildJobCompletedBody({ ...base, jobTitle: "ทำสีประตูซ้าย" });
    expect(body).toContain("ทำสีประตูซ้าย");
    expect(body).toContain("รูป");
  });
});

describe("IN_QC / WORK_STARTED / PARTS_ARRIVED / CHECKIN", () => {
  it("IN_QC says final quality check in customer words", () => {
    expect(buildInQcBody({ ...base })).toContain("ตรวจสอบคุณภาพขั้นสุดท้าย");
  });
  it("WORK_STARTED says the work has begun", () => {
    expect(buildWorkStartedBody({ ...base })).toContain("เริ่ม");
  });
  it("PARTS_ARRIVED says the parts came and work resumed", () => {
    const body = buildPartsArrivedBody({ ...base });
    expect(body).toContain("อะไหล่");
    expect(body).toContain("ดำเนินการต่อ");
  });
  it("CHECKIN says the car is received and a quotation follows", () => {
    const body = buildCheckinBody({ ...base });
    expect(body).toContain("รับรถ");
    expect(body).toContain("ใบเสนอราคา");
  });
});

describe("CATCH_UP", () => {
  const jobs = [
    { title: "ทำสีประตูซ้าย", status: "QC" as const, waitingReason: null },
    { title: "เปลี่ยนผ้าเบรก", status: "WAITING" as const, waitingReason: "PARTS" as const },
    { title: "งานที่ปฏิเสธ", status: "DECLINED" as const, waitingReason: null },
  ];

  it("describes the case as it stands, reusing the draft's status lines", () => {
    const body = buildCatchUpBody({ ...base, caseStatus: "CHECKED_IN", jobs });
    const draft = buildDraftBody({ ...base, caseStatus: "CHECKED_IN", jobs });
    expect(body).toContain("· ทำสีประตูซ้าย — ตรวจสอบคุณภาพขั้นสุดท้าย");
    expect(body).toContain("· เปลี่ยนผ้าเบรก — รออะไหล่");
    expect(draft).toContain("· เปลี่ยนผ้าเบรก — รออะไหล่");
    expect(body).not.toContain("งานที่ปฏิเสธ");
  });

  it("says it is a catch-up, not a replay", () => {
    const body = buildCatchUpBody({ ...base, caseStatus: "CHECKED_IN", jobs });
    expect(body).toContain("ขณะนี้");
  });

  it("carries the pickup line when the case is already Ready", () => {
    const done = [{ title: "งาน", status: "COMPLETED" as const, waitingReason: null }];
    expect(buildCatchUpBody({ ...base, caseStatus: "READY", jobs: done })).toContain("เข้ามารับ");
    expect(buildCatchUpBody({ ...base, caseStatus: "CHECKED_IN", jobs: done })).not.toContain(
      "เข้ามารับ",
    );
  });

  it("still reads as in assessment when no Job has taken shape", () => {
    expect(buildCatchUpBody({ ...base, caseStatus: "CHECKED_IN", jobs: [] })).toContain(
      "ตรวจสอบสภาพรถ",
    );
  });
});

describe("the untouched builders", () => {
  it("buildDraftBody keeps its shape as the FREEFORM seed", () => {
    const body = buildDraftBody({
      ...base,
      caseStatus: "CHECKED_IN",
      jobs: [{ title: "งาน", status: "IN_PROGRESS", waitingReason: null }],
    });
    expect(body.split("\n")[0]).toBe("สวัสดีค่ะ คุณประยุทธ์");
    expect(body).toContain("· งาน — กำลังดำเนินการ");
    expect(body.split("\n").at(-1)).toBe(base.shopName);
  });
});

describe("extractNote — what the log shows as 'with a note'", () => {
  const facts = { ...base, note: "ล้างรถให้แล้วนะคะ" };
  it.each([
    ["CHECKIN", buildCheckinBody(facts), buildCheckinBody(base)],
    ["READY", buildReadyBody({ ...facts, customerOwedSatang: 150_000 }), buildReadyBody({ ...base, customerOwedSatang: 150_000 })],
    ["READY", buildReadyBody({ ...facts, customerOwedSatang: 0 }), buildReadyBody({ ...base, customerOwedSatang: 0 })],
    ["DELIVERED", buildDeliveredBody(facts), buildDeliveredBody(base)],
    ["WORK_STARTED", buildWorkStartedBody(facts), buildWorkStartedBody(base)],
    ["WAITING_PARTS", buildWaitingPartsBody({ ...facts, etaDate: null }), buildWaitingPartsBody({ ...base, etaDate: null })],
    ["PARTS_ARRIVED", buildPartsArrivedBody(facts), buildPartsArrivedBody(base)],
    ["JOB_COMPLETED", buildJobCompletedBody({ ...facts, jobTitle: "งาน" }), buildJobCompletedBody({ ...base, jobTitle: "งาน" })],
    ["IN_QC", buildInQcBody(facts), buildInQcBody(base)],
    ["CATCH_UP", buildCatchUpBody({ ...facts, jobs: [], caseStatus: "READY" }), buildCatchUpBody({ ...base, jobs: [], caseStatus: "CHECKED_IN" })],
  ] as const)("%s: finds the note when present and nothing when absent", (kind, withNote, without) => {
    expect(extractNote(kind, withNote)).toBe("ล้างรถให้แล้วนะคะ");
    expect(extractNote(kind, without)).toBeNull();
  });

  it("never reads a note out of a human-written or quotation message", () => {
    expect(extractNote("FREEFORM", "สวัสดี\n\nข้อความ\n\nอู่")).toBeNull();
    expect(extractNote("QUOTATION", "สวัสดี\n\nข้อความ\n\nอู่")).toBeNull();
  });
});
