import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFakeLineTransport,
  isLineImageContentType,
  LINE_MAX_PHOTOS_PER_UPDATE,
  type LineTransport,
} from "@/lib/line";
import { buildDraftBody, customerStatusTh } from "@/lib/line-draft";

/**
 * The fake transport is what makes M6 verifiable on a fresh clone with no
 * Official Account and no message fees, so it gets tested like the real seam
 * it is: it must record the LITERAL wire payload, and it must refuse a bad
 * token the way LINE does.
 */

let dir: string;
let transport: LineTransport;
let outbox: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "line-outbox-"));
  outbox = path.join(dir, "outbox.jsonl");
  transport = createFakeLineTransport(outbox);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fake LINE transport", () => {
  it("refuses a token that is not a dev token, like LINE refuses a bad one", async () => {
    const res = await transport.getBotInfo("live-looking-token");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalidToken");
  });

  it("connects with a dev token and reports a stand-in OA", async () => {
    const res = await transport.getBotInfo("dev-token");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.displayName).toContain("DEV OA");
  });

  it("writes the exact payload it would have posted", async () => {
    const res = await transport.push("dev-token", "U123", [
      { type: "text", text: "อัปเดตงานซ่อม" },
      {
        type: "image",
        originalContentUrl: "https://example.test/api/line/photo/abc",
        previewImageUrl: "https://example.test/api/line/photo/abc",
      },
    ]);
    expect(res.ok).toBe(true);

    const lines = (await readFile(outbox, "utf8")).trim().split("\n");
    const last = JSON.parse(lines.at(-1)!);
    expect(last.kind).toBe("push");
    expect(last.payload.to).toBe("U123");
    expect(last.payload.messages).toHaveLength(2);
    expect(last.payload.messages[0].text).toBe("อัปเดตงานซ่อม");
    expect(last.payload.messages[1].originalContentUrl).toContain("/api/line/photo/");
  });

  it("records nothing when the token is refused", async () => {
    const before = (await readFile(outbox, "utf8")).length;
    await transport.push("nope", "U123", [{ type: "text", text: "x" }]);
    expect((await readFile(outbox, "utf8")).length).toBe(before);
  });
});

describe("LINE message limits", () => {
  it("leaves room for four photos beside the text", () => {
    expect(LINE_MAX_PHOTOS_PER_UPDATE).toBe(4);
  });

  it("accepts only the formats LINE fetches", () => {
    expect(isLineImageContentType("image/jpeg")).toBe(true);
    expect(isLineImageContentType("image/png")).toBe(true);
    expect(isLineImageContentType("image/webp")).toBe(false);
    expect(isLineImageContentType("image/heic")).toBe(false);
  });
});

describe("the pre-filled draft (ADR-003)", () => {
  const base = {
    shopName: "อู่สมชาย",
    reference: "RC-1024",
    plate: "กข1234",
    customerName: "ประยุทธ์",
    caseStatus: "CHECKED_IN" as const,
  };

  it("says what a customer can safely read, never the internal wording", () => {
    const body = buildDraftBody({
      ...base,
      jobs: [
        { title: "ทำสีซ้าย", status: "QC", waitingReason: null },
        { title: "เปลี่ยนผ้าเบรก", status: "WAITING", waitingReason: "PARTS" },
      ],
    });
    expect(body).toContain("ทำสีซ้าย");
    expect(body).toContain("ตรวจสอบคุณภาพขั้นสุดท้าย");
    expect(body).toContain("รออะไหล่");
    expect(body).not.toMatch(/QC|WAITING|IN_PROGRESS/);
  });

  it("leaves declined and cancelled work out entirely", () => {
    const body = buildDraftBody({
      ...base,
      jobs: [
        { title: "งานที่ปฏิเสธ", status: "DECLINED", waitingReason: null },
        { title: "งานที่ยกเลิก", status: "CANCELLED", waitingReason: null },
      ],
    });
    expect(body).not.toContain("งานที่ปฏิเสธ");
    expect(body).not.toContain("งานที่ยกเลิก");
    expect(customerStatusTh({ title: "x", status: "DECLINED", waitingReason: null })).toBeNull();
  });

  it("adds the pickup line only once the case is Ready", () => {
    const jobs = [{ title: "งาน", status: "COMPLETED" as const, waitingReason: null }];
    expect(buildDraftBody({ ...base, jobs })).not.toContain("เข้ามารับ");
    expect(buildDraftBody({ ...base, jobs, caseStatus: "READY" })).toContain("เข้ามารับ");
  });
});
