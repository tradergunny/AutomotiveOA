import { readFile, rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M7.10 step 5: the Progress notices and Ready, wired into the real flow
 * actions (transitionJob, revertJobStep, markCaseReady) against a real
 * database and the fake transport on a temp outbox. The act commits first;
 * the message goes second; the message never fails the act.
 */

const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/line-flow-${Date.now()}`;
  process.env.LINE_TRANSPORT = "fake";
  process.env.LINE_OUTBOX_PATH = `${dir}/outbox.jsonl`;
  process.env.LINE_CREDENTIALS_KEY = Buffer.alloc(32, 9).toString("base64");
  return { dir };
});

const current = vi.hoisted(() => ({
  session: { userId: "", shopId: "", staffId: "", role: "MANAGER" as "MANAGER" | "ADVISOR", name: "", email: "" },
}));

vi.mock("@/lib/session", async () => {
  const { forShop } = await import("@/lib/tenant");
  return {
    requireSession: async () => current.session,
    tenantDb: async () => forShop(current.session.shopId),
    tenantContext: async () => ({ session: current.session, db: forShop(current.session.shopId) }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "shop.test" }) }));

const { prismaUnscoped } = await import("@/lib/db");
const { sealCredential } = await import("@/lib/line-credentials");
const { LINE_OUTBOX_PATH } = await import("@/lib/line");
const { transitionJob, revertJobStep, markCaseReady } = await import("@/app/(app)/cases/[id]/flow-actions");
const { buildReadyBody } = await import("@/lib/line-draft");

const run = `lf-${Date.now()}`;
const LINE_USER = "U00000000000000000000000000lf0001";
let shopId: string;
let staffId: string;
let customerId: string;
let vehicleId: string;
const caseIds: string[] = [];

type Outbox = { kind: string; payload: { to: string; messages: { type: string; text?: string }[] } };

async function outbox(): Promise<Outbox[]> {
  try {
    const raw = await readFile(LINE_OUTBOX_PATH, "utf8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Outbox);
  } catch {
    return [];
  }
}

/** The kinds pushed for a case, in outbox order, by matching each push's text to its row. */
async function pushedKinds(caseId: string, since: number): Promise<string[]> {
  const rows = await prismaUnscoped.lineUpdate.findMany({ where: { caseId } });
  const byText = new Map(rows.map((row) => [row.bodyText, row.kind]));
  return (await outbox()).slice(since).map((push) => byText.get(push.payload.messages[0]!.text ?? "") ?? "?");
}

async function recordedKinds(caseId: string) {
  const rows = await prismaUnscoped.lineUpdate.findMany({ where: { caseId }, orderBy: { sentAt: "asc" } });
  return rows.map((row) => `${row.kind}:${row.deliveryStatus}`);
}

async function newCase(): Promise<string> {
  const repairCase = await prismaUnscoped.repairCase.create({
    data: {
      shopId,
      reference: `${run}-RC-${caseIds.length + 1}`,
      vehicleId,
      contactCustomerId: customerId,
      openedByStaffId: staffId,
    },
  });
  caseIds.push(repairCase.id);
  return repairCase.id;
}

async function addJob(caseId: string, title: string, status: "AUTHORIZED" | "COMPLETED" = "AUTHORIZED") {
  return prismaUnscoped.job.create({
    data: { shopId, caseId, title, status, payerType: "CUSTOMER", priceSatang: 100_000, createdByStaffId: staffId },
  });
}

async function addPhoto(caseId: string, jobId: string) {
  return prismaUnscoped.photo.create({
    data: {
      shopId,
      caseId,
      jobId,
      storageKey: `${run}/${Math.random().toString(36).slice(2)}`,
      contentType: "image/jpeg",
      sizeBytes: 10,
      uploadedByStaffId: staffId,
    },
  });
}

async function linkContact() {
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineContact.create({
    data: {
      shopId,
      lineUserId: LINE_USER,
      displayName: "LINE user",
      customerId,
      linkedByStaffId: staffId,
      linkedAt: new Date(),
    },
  });
}

async function setChannelToken(token: string) {
  await prismaUnscoped.shopLineChannel.upsert({
    where: { shopId },
    create: {
      shopId,
      channelSecretEnc: sealCredential(shopId, "channelSecret", "secret"),
      channelAccessTokenEnc: sealCredential(shopId, "channelAccessToken", token),
      connectedByStaffId: staffId,
    },
    update: { channelAccessTokenEnc: sealCredential(shopId, "channelAccessToken", token) },
  });
}

async function go(jobId: string, action: string, extra: { waitingReason?: string; note?: string } = {}) {
  const res = await transitionJob(jobId, { action, ...extra });
  if (!res.ok) throw new Error(`${action}: ${res.error}`);
  return res.value;
}

beforeAll(async () => {
  await rm(env.dir, { recursive: true, force: true });
  const shop = await prismaUnscoped.shop.create({ data: { name: `${run} Shop` } });
  shopId = shop.id;
  const staff = await prismaUnscoped.staff.create({ data: { shopId, name: `${run} Manager`, position: "manager" } });
  staffId = staff.id;
  const customer = await prismaUnscoped.customer.create({ data: { shopId, name: `${run} Customer`, phone: "0810000079" } });
  customerId = customer.id;
  const vehicle = await prismaUnscoped.vehicle.create({
    data: { shopId, plate: `${run}ง1`, bodyType: "SEDAN", primaryCustomerId: customerId },
  });
  vehicleId = vehicle.id;
  current.session = { userId: "u", shopId, staffId, role: "MANAGER", name: "", email: "" };
});

afterAll(async () => {
  await prismaUnscoped.caseEvent.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdatePhoto.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdate.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
  await prismaUnscoped.shopLineChannel.deleteMany({ where: { shopId } });
  await prismaUnscoped.partLine.deleteMany({ where: { shopId } });
  await prismaUnscoped.photo.deleteMany({ where: { shopId } });
  await prismaUnscoped.job.deleteMany({ where: { shopId } });
  await prismaUnscoped.repairCase.deleteMany({ where: { shopId } });
  await prismaUnscoped.vehicle.deleteMany({ where: { shopId } });
  await prismaUnscoped.customer.deleteMany({ where: { shopId } });
  await prismaUnscoped.staff.deleteMany({ where: { shopId } });
  await prismaUnscoped.shop.delete({ where: { id: shopId } });
  await rm(env.dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await linkContact();
  await setChannelToken("dev-token");
});

describe("the two-Job walk", () => {
  it("pushes exactly WORK_STARTED, WAITING_PARTS, PARTS_ARRIVED, IN_QC, READY — the QC fail and the last completion add nothing", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "ทำสีประตูซ้าย");
    const b = await addJob(caseId, "เปลี่ยนกันชน");
    const photo = await addPhoto(caseId, a.id);
    const since = (await outbox()).length;

    await go(a.id, "START_WORK");
    await go(b.id, "START_WORK"); // a second Job merely starting
    await prismaUnscoped.partLine.create({
      data: { shopId, jobId: a.id, name: "สีรองพื้น", etaDate: new Date("2026-09-25T00:00:00Z") },
    });
    await go(a.id, "SET_WAITING", { waitingReason: "PARTS" });
    await go(a.id, "SET_WAITING", { waitingReason: "TECHNICIAN" }); // a reason change
    await go(a.id, "SET_WAITING", { waitingReason: "PARTS" }); // and back
    await go(a.id, "START_WORK"); // the Parts wait ends
    await go(a.id, "SEND_TO_QC"); // b still in progress
    await go(b.id, "SEND_TO_QC"); // everything in final check
    await go(a.id, "QC_FAIL", { note: "สีไม่เรียบ" });
    await go(a.id, "SEND_TO_QC"); // re-entry after the bounce
    await go(b.id, "QC_PASS"); // leaves a in final check
    const last = await go(a.id, "QC_PASS"); // makes the case Ready

    expect(last.status).toBe("COMPLETED");
    expect((await prismaUnscoped.repairCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("READY");
    expect(await pushedKinds(caseId, since)).toEqual([
      "WORK_STARTED",
      "WAITING_PARTS",
      "PARTS_ARRIVED",
      "IN_QC",
      "READY",
    ]);
    const pushes = (await outbox()).slice(since);
    expect(pushes[1]!.payload.messages[0]!.text).toContain("25 กันยายน 2569");
    // READY carries the finished work's photos.
    expect(pushes[4]!.payload.messages).toHaveLength(2);
    const ready = await prismaUnscoped.lineUpdate.findFirstOrThrow({
      where: { caseId, kind: "READY" },
      include: { photos: true },
    });
    expect(ready.photos.map((p) => p.photoId)).toEqual([photo.id]);
    expect(ready.sentByStaffId).toBe(staffId);
  });

  it("a Job finished while the other is still being worked sends JOB_COMPLETED with that Job's photos, then IN_QC, then READY", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน A");
    const b = await addJob(caseId, "งาน B");
    const pa = await addPhoto(caseId, a.id);
    await addPhoto(caseId, b.id);
    const since = (await outbox()).length;

    await go(a.id, "START_WORK");
    await go(b.id, "START_WORK");
    await go(a.id, "SEND_TO_QC");
    await go(a.id, "QC_PASS"); // b still in progress
    await go(b.id, "SEND_TO_QC");
    await go(b.id, "QC_PASS");

    expect(await pushedKinds(caseId, since)).toEqual(["WORK_STARTED", "JOB_COMPLETED", "IN_QC", "READY"]);
    const completed = await prismaUnscoped.lineUpdate.findFirstOrThrow({
      where: { caseId, kind: "JOB_COMPLETED" },
      include: { photos: true },
    });
    expect(completed.jobId).toBe(a.id);
    expect(completed.photos.map((p) => p.photoId)).toEqual([pa.id]);
    expect(completed.bodyText).toContain("งาน A");
    const pushes = (await outbox()).slice(since);
    expect(pushes[1]!.payload.messages).toHaveLength(2);
    expect(pushes[1]!.payload.messages[1]!.type).toBe("image");
  });

  it("a QC fail adds nothing, and neither does the cancellation of a Job", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน A");
    const b = await addJob(caseId, "งาน B");
    const since = (await outbox()).length;
    await go(a.id, "START_WORK");
    await go(a.id, "SEND_TO_QC"); // b authorized, not started: work remains, no "final check"
    await go(a.id, "QC_FAIL", { note: "ทำใหม่" });
    await go(b.id, "CANCEL", { note: "ลูกค้าขอยกเลิก" });
    expect(await pushedKinds(caseId, since)).toEqual(["WORK_STARTED"]);
    expect(await recordedKinds(caseId)).toEqual(["WORK_STARTED:SENT"]);
    // …and once b is gone, a's re-entry IS the final check.
    await go(a.id, "SEND_TO_QC");
    expect(await pushedKinds(caseId, since)).toEqual(["WORK_STARTED", "IN_QC"]);
  });
});

describe("the act never waits on LINE", () => {
  it("a transport failure leaves the Job transitioned and a FAILED row", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน");
    await setChannelToken("live-not-a-dev-token");
    const since = (await outbox()).length;

    const res = await transitionJob(a.id, { action: "START_WORK" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("IN_PROGRESS");
    expect(await recordedKinds(caseId)).toEqual(["WORK_STARTED:FAILED"]);
    expect((await outbox()).length).toBe(since);
  });

  it("a customer with no contact leaves the Job transitioned and NOT_SENT rows", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน");
    await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
    const since = (await outbox()).length;

    await go(a.id, "START_WORK");
    await go(a.id, "SEND_TO_QC");
    await go(a.id, "QC_PASS");

    expect(await recordedKinds(caseId)).toEqual(["WORK_STARTED:NOT_SENT", "IN_QC:NOT_SENT", "READY:NOT_SENT"]);
    const rows = await prismaUnscoped.lineUpdate.findMany({ where: { caseId } });
    expect(rows.every((row) => row.errorCode === "noIdentity" && row.lineUserId === null)).toBe(true);
    expect((await outbox()).length).toBe(since);
    expect((await prismaUnscoped.repairCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("READY");
  });

  it("the once-per-case rule survives an unreachable customer: linking later does not resend WORK_STARTED", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน A");
    const b = await addJob(caseId, "งาน B");
    await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
    await go(a.id, "START_WORK");
    await linkContact();
    const since = (await outbox()).length;
    await go(b.id, "START_WORK");
    expect(await pushedKinds(caseId, since)).toEqual([]);
  });
});

describe("revertJobStep", () => {
  it("runs clean and sends nothing when it reopens a Ready case", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน");
    await go(a.id, "START_WORK");
    await go(a.id, "SEND_TO_QC");
    await go(a.id, "QC_PASS");
    const since = (await outbox()).length;
    const before = await recordedKinds(caseId);

    const r1 = await revertJobStep(a.id); // COMPLETED → QC, revokes Ready
    expect(r1.ok && r1.value.status).toBe("QC");

    expect((await outbox()).length).toBe(since);
    expect(await recordedKinds(caseId)).toEqual(before);
    expect((await prismaUnscoped.repairCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("CHECKED_IN");
  });

  it("runs clean and sends nothing when it lands on a Parts wait", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน");
    await go(a.id, "SET_WAITING", { waitingReason: "PARTS" });
    await go(a.id, "START_WORK");
    const since = (await outbox()).length;
    const before = await recordedKinds(caseId);

    const r = await revertJobStep(a.id); // IN_PROGRESS → WAITING (Parts)
    expect(r.ok && r.value.status).toBe("WAITING");
    expect(r.ok && r.value.waitingReason).toBe("PARTS");

    expect((await outbox()).length).toBe(since);
    expect(await recordedKinds(caseId)).toEqual(before);
  });

  it("a Ready re-reached after a revert sends READY again", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน");
    await go(a.id, "START_WORK");
    await go(a.id, "SEND_TO_QC");
    await go(a.id, "QC_PASS");
    await revertJobStep(a.id);
    const since = (await outbox()).length;
    await go(a.id, "QC_PASS");
    expect(await pushedKinds(caseId, since)).toEqual(["READY"]);
  });
});

describe("markCaseReady", () => {
  it("sends READY with the dialog's note as the last paragraph", async () => {
    const caseId = await newCase();
    const since = (await outbox()).length;
    const res = await markCaseReady(caseId, { note: "  ล้างรถให้แล้วนะคะ  " });
    expect(res.ok).toBe(true);
    expect(await pushedKinds(caseId, since)).toEqual(["READY"]);
    const text = (await outbox()).at(-1)!.payload.messages[0]!.text!;
    const paragraphs = text.split("\n\n");
    expect(paragraphs.at(-2)).toBe("ล้างรถให้แล้วนะคะ");
    expect(paragraphs.at(-1)).toBe(`${run} Shop`);
    expect(text).not.toContain("฿"); // nothing owed on a case with no work
  });

  it("without a note the body is the system's alone, and names what the customer owes", async () => {
    const caseId = await newCase();
    await addJob(caseId, "งานเสร็จ", "COMPLETED");
    const since = (await outbox()).length;
    const res = await markCaseReady(caseId);
    expect(res.ok).toBe(true);
    expect(await pushedKinds(caseId, since)).toEqual(["READY"]);
    const text = (await outbox()).at(-1)!.payload.messages[0]!.text!;
    expect(text).toBe(
      buildReadyBody({
        shopName: `${run} Shop`,
        customerName: `${run} Customer`,
        plate: `${run}ง1`,
        reference: `${run}-RC-${caseIds.length}`,
        customerOwedSatang: 100_000,
      }),
    );
    expect(text).toContain("฿1,000");
  });

  it("a refused Mark ready (active work) sends nothing", async () => {
    const caseId = await newCase();
    const a = await addJob(caseId, "งาน");
    await go(a.id, "START_WORK");
    const since = (await outbox()).length;
    expect(await markCaseReady(caseId)).toEqual({ ok: false, error: "activeWork" });
    expect(await pushedKinds(caseId, since)).toEqual([]);
  });
});
