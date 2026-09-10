import { readFile, rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M7.10 step 3: the system send seam (ADR-007). sendSystemUpdate is the ONE
 * function every Milestone message and Progress notice goes through; it
 * runs the gate, records a NOT_SENT row when blocked, otherwise builds the
 * kind's Thai body plus up to four evidence images and walks
 * deliverLineUpdate like the composer does. It never throws.
 *
 * DB-backed, fake transport writing to a temp outbox (the module picks its
 * path up at import, hence the hoisted env).
 */

const env = vi.hoisted(() => {
  // Static imports are not initialized yet when this runs — globals only.
  const dir = `${process.env.TMPDIR ?? "/tmp"}/line-updates-${Date.now()}`;
  process.env.LINE_TRANSPORT = "fake";
  process.env.LINE_OUTBOX_PATH = `${dir}/outbox.jsonl`;
  process.env.LINE_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
  return { dir };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "shop.test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { prismaUnscoped } = await import("@/lib/db");
const { forShop } = await import("@/lib/tenant");
const { sealCredential } = await import("@/lib/line-credentials");
const { LINE_OUTBOX_PATH } = await import("@/lib/line");
const { sendSystemUpdate } = await import("@/lib/line-updates");
const {
  buildCatchUpBody,
  buildCheckinBody,
  buildJobCompletedBody,
  buildReadyBody,
  buildWaitingPartsBody,
} = await import("@/lib/line-draft");

const run = `lu-${Date.now()}`;
const LINE_USER = "U00000000000000000000000000lu0001";
let shopId: string;
let staffId: string;
let customerId: string;
let vehicleId: string;
const caseIds: string[] = [];

type Outbox = { kind: string; payload: { to: string; messages: { type: string; text?: string; originalContentUrl?: string }[] } };

async function outbox(): Promise<Outbox[]> {
  try {
    const raw = await readFile(LINE_OUTBOX_PATH, "utf8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Outbox);
  } catch {
    return [];
  }
}

async function outboxCount(): Promise<number> {
  return (await outbox()).length;
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

async function addJob(
  caseId: string,
  title: string,
  status: "AUTHORIZED" | "WAITING" | "IN_PROGRESS" | "QC" | "COMPLETED" | "DECLINED",
  extra: { waitingReason?: "PARTS" | "TECHNICIAN"; priceSatang?: number; payerType?: "CUSTOMER" | "INSURER" } = {},
) {
  return prismaUnscoped.job.create({
    data: {
      shopId,
      caseId,
      title,
      status,
      waitingReason: extra.waitingReason ?? null,
      payerType: extra.payerType ?? "CUSTOMER",
      priceSatang: extra.priceSatang ?? 100_000,
      createdByStaffId: staffId,
    },
  });
}

async function addPhoto(caseId: string, jobId: string | null, contentType: string, capturedAt: Date) {
  return prismaUnscoped.photo.create({
    data: {
      shopId,
      caseId,
      jobId,
      storageKey: `${run}/${Math.random().toString(36).slice(2)}`,
      contentType,
      sizeBytes: 10,
      capturedAt,
      uploadedByStaffId: staffId,
    },
  });
}

async function linkContact(followState: "FOLLOWING" | "UNFOLLOWED" = "FOLLOWING") {
  return prismaUnscoped.lineContact.create({
    data: {
      shopId,
      lineUserId: LINE_USER,
      displayName: "LINE user",
      followState,
      customerId,
      linkedByStaffId: staffId,
      linkedAt: new Date(),
    },
  });
}

async function unlinkContact() {
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
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

const actor = () => ({ shopId, staffId });
const baseFacts = () => ({ shopName: `${run} Shop`, customerName: `${run} Customer` });

beforeAll(async () => {
  await rm(env.dir, { recursive: true, force: true });
  const shop = await prismaUnscoped.shop.create({ data: { name: `${run} Shop` } });
  shopId = shop.id;
  const staff = await prismaUnscoped.staff.create({
    data: { shopId, name: `${run} Advisor`, position: "advisor" },
  });
  staffId = staff.id;
  const customer = await prismaUnscoped.customer.create({
    data: { shopId, name: `${run} Customer`, phone: "0810000078" },
  });
  customerId = customer.id;
  const vehicle = await prismaUnscoped.vehicle.create({
    data: { shopId, plate: `${run}ค1`, bodyType: "SEDAN", primaryCustomerId: customerId },
  });
  vehicleId = vehicle.id;
  await setChannelToken("dev-token");
});

afterAll(async () => {
  await prismaUnscoped.caseEvent.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdatePhoto.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdate.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
  await prismaUnscoped.shopLineChannel.deleteMany({ where: { shopId } });
  await prismaUnscoped.payment.deleteMany({ where: { shopId } });
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
  await unlinkContact();
  await setChannelToken("dev-token");
});

describe("a blocked customer", () => {
  it("noIdentity → one NOT_SENT row with a null lineUserId, its event, nothing in the outbox", async () => {
    const caseId = await newCase();
    const before = await outboxCount();

    const result = await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "CHECKIN" });

    expect(result).toMatchObject({ outcome: "NOT_SENT", reason: "noIdentity" });
    const rows = await prismaUnscoped.lineUpdate.findMany({ where: { caseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "CHECKIN",
      deliveryStatus: "NOT_SENT",
      errorCode: "noIdentity",
      lineUserId: null,
      customerId,
      sentByStaffId: staffId,
    });
    // The body is what WOULD have been said, so the gap is readable later.
    expect(rows[0]!.bodyText).toBe(
      buildCheckinBody({ ...baseFacts(), plate: `${run}ค1`, reference: `${run}-RC-${caseIds.length}` }),
    );
    const events = await prismaUnscoped.caseEvent.findMany({ where: { caseId, type: "LINE_UPDATE_NOT_SENT" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.lineUpdateId).toBe(rows[0]!.id);
    expect(await outboxCount()).toBe(before);
  });

  it("unfollowed → NOT_SENT naming the reason, with the userId it would have pushed to", async () => {
    const caseId = await newCase();
    await linkContact("UNFOLLOWED");
    const result = await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "WORK_STARTED" });
    expect(result).toMatchObject({ outcome: "NOT_SENT", reason: "unfollowed" });
    const row = await prismaUnscoped.lineUpdate.findFirst({ where: { caseId } });
    expect(row?.lineUserId).toBe(LINE_USER);
    expect(row?.errorCode).toBe("unfollowed");
  });

  it("notConnected → NOT_SENT even with a linked contact", async () => {
    const caseId = await newCase();
    await linkContact();
    await prismaUnscoped.shopLineChannel.deleteMany({ where: { shopId } });
    const result = await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "IN_QC" });
    expect(result).toMatchObject({ outcome: "NOT_SENT", reason: "notConnected" });
  });

  it("publishes no photo tokens on a NOT_SENT row", async () => {
    const caseId = await newCase();
    const job = await addJob(caseId, "งาน", "COMPLETED");
    await addPhoto(caseId, job.id, "image/jpeg", new Date());
    await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "JOB_COMPLETED", jobId: job.id });
    const photos = await prismaUnscoped.lineUpdatePhoto.findMany({ where: { lineUpdate: { caseId } } });
    expect(photos).toHaveLength(0);
  });
});

describe("a linked customer", () => {
  it("CHECKIN → one SENT row and exactly one outbox line with the kind's text and no images", async () => {
    const caseId = await newCase();
    await linkContact();
    const before = await outboxCount();

    const result = await sendSystemUpdate(forShop(shopId), {
      actor: actor(),
      caseId,
      kind: "CHECKIN",
      note: "  ล้างรถให้ด้วยนะคะ  ",
    });

    expect(result.outcome).toBe("SENT");
    const rows = await prismaUnscoped.lineUpdate.findMany({ where: { caseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "CHECKIN", deliveryStatus: "SENT", lineUserId: LINE_USER });
    const lines = await outbox();
    expect(lines).toHaveLength(before + 1);
    const push = lines.at(-1)!;
    expect(push.kind).toBe("push");
    expect(push.payload.to).toBe(LINE_USER);
    expect(push.payload.messages).toHaveLength(1);
    expect(push.payload.messages[0]!.text).toBe(rows[0]!.bodyText);
    expect(push.payload.messages[0]!.text).toContain("ล้างรถให้ด้วยนะคะ");
    expect(push.payload.messages[0]!.text).toBe(
      buildCheckinBody({
        ...baseFacts(),
        plate: `${run}ค1`,
        reference: `${run}-RC-${caseIds.length}`,
        note: "ล้างรถให้ด้วยนะคะ",
      }),
    );
    const events = await prismaUnscoped.caseEvent.findMany({ where: { caseId, type: "LINE_UPDATE_SENT" } });
    expect(events).toHaveLength(1);
  });

  it("JOB_COMPLETED carries that Job's own photos, newest first, JPEG/PNG only, at most four", async () => {
    const caseId = await newCase();
    await linkContact();
    const job = await addJob(caseId, "ทำสีประตูซ้าย", "COMPLETED");
    const other = await addJob(caseId, "งานอื่น", "IN_PROGRESS");
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    const oldest = await addPhoto(caseId, job.id, "image/jpeg", at(50));
    const webp = await addPhoto(caseId, job.id, "image/webp", at(40));
    const p3 = await addPhoto(caseId, job.id, "image/png", at(30));
    const p2 = await addPhoto(caseId, job.id, "image/jpeg", at(20));
    const p1 = await addPhoto(caseId, job.id, "image/jpeg", at(10));
    const newest = await addPhoto(caseId, job.id, "image/jpeg", at(0));
    const otherJobs = await addPhoto(caseId, other.id, "image/jpeg", at(0));
    const walkaround = await addPhoto(caseId, null, "image/jpeg", at(0));

    const result = await sendSystemUpdate(forShop(shopId), {
      actor: actor(),
      caseId,
      kind: "JOB_COMPLETED",
      jobId: job.id,
    });

    expect(result.outcome).toBe("SENT");
    const row = await prismaUnscoped.lineUpdate.findFirst({
      where: { caseId },
      include: { photos: { orderBy: { sortOrder: "asc" } } },
    });
    expect(row?.jobId).toBe(job.id);
    expect(row?.bodyText).toBe(
      buildJobCompletedBody({
        ...baseFacts(),
        plate: `${run}ค1`,
        reference: `${run}-RC-${caseIds.length}`,
        jobTitle: "ทำสีประตูซ้าย",
      }),
    );
    expect(row?.photos.map((p) => p.photoId)).toEqual([newest.id, p1.id, p2.id, p3.id]);
    for (const photo of row!.photos) expect(photo.publicToken).toMatch(/^[0-9a-f]{32}$/);
    const skipped = [oldest.id, webp.id, otherJobs.id, walkaround.id];
    expect(row!.photos.some((p) => skipped.includes(p.photoId))).toBe(false);

    const push = (await outbox()).at(-1)!;
    expect(push.payload.messages).toHaveLength(5);
    expect(push.payload.messages[0]!.type).toBe("text");
    const images = push.payload.messages.slice(1);
    expect(images.every((m) => m.type === "image")).toBe(true);
    expect(images[0]!.originalContentUrl).toBe(
      `http://shop.test/api/line/photo/${row!.photos[0]!.publicToken}`,
    );
  });

  it("READY names the Customer-owed balance and carries the finished work's photos", async () => {
    const caseId = await newCase();
    await linkContact();
    const done = await addJob(caseId, "งานเสร็จ", "COMPLETED", { priceSatang: 300_000 });
    await addJob(caseId, "งานประกัน", "COMPLETED", { priceSatang: 4_500_000, payerType: "INSURER" });
    await addJob(caseId, "งานที่ปฏิเสธ", "DECLINED", { priceSatang: 999_900 });
    await prismaUnscoped.payment.create({
      data: {
        shopId,
        caseId,
        customerId,
        payerType: "CUSTOMER",
        amountSatang: 100_000,
        method: "CASH",
        recordedByStaffId: staffId,
      },
    });
    const photo = await addPhoto(caseId, done.id, "image/jpeg", new Date());
    await addPhoto(caseId, null, "image/jpeg", new Date()); // walkaround: evidence, never a greeting

    const result = await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "READY" });

    expect(result.outcome).toBe("SENT");
    const row = await prismaUnscoped.lineUpdate.findFirst({ where: { caseId }, include: { photos: true } });
    expect(row?.bodyText).toBe(
      buildReadyBody({
        ...baseFacts(),
        plate: `${run}ค1`,
        reference: `${run}-RC-${caseIds.length}`,
        customerOwedSatang: 200_000,
      }),
    );
    expect(row?.bodyText).toContain("฿2,000");
    expect(row?.bodyText).not.toContain("45,000");
    expect(row?.photos.map((p) => p.photoId)).toEqual([photo.id]);
  });

  it("WAITING_PARTS names the earliest ETA among the Parts waits", async () => {
    const caseId = await newCase();
    await linkContact();
    const waiting = await addJob(caseId, "รออะไหล่", "WAITING", { waitingReason: "PARTS" });
    const tech = await addJob(caseId, "รอช่าง", "WAITING", { waitingReason: "TECHNICIAN" });
    const eta = (iso: string) => new Date(iso);
    await prismaUnscoped.partLine.createMany({
      data: [
        { shopId, jobId: waiting.id, name: "กันชน", etaDate: eta("2026-10-05T00:00:00Z") },
        { shopId, jobId: waiting.id, name: "ไฟหน้า", etaDate: eta("2026-09-28T00:00:00Z") },
        { shopId, jobId: waiting.id, name: "ยังไม่รู้", etaDate: null },
        { shopId, jobId: tech.id, name: "ของงานอื่น", etaDate: eta("2026-09-01T00:00:00Z") },
      ],
    });

    const result = await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "WAITING_PARTS" });
    expect(result.outcome).toBe("SENT");
    const row = await prismaUnscoped.lineUpdate.findFirst({ where: { caseId } });
    expect(row?.bodyText).toBe(
      buildWaitingPartsBody({
        ...baseFacts(),
        plate: `${run}ค1`,
        reference: `${run}-RC-${caseIds.length}`,
        etaDate: eta("2026-09-28T00:00:00Z"),
      }),
    );
    expect(row?.bodyText).toContain("28 กันยายน 2569");
  });

  it("WAITING_PARTS with no ETA says soon", async () => {
    const caseId = await newCase();
    await linkContact();
    await addJob(caseId, "รออะไหล่", "WAITING", { waitingReason: "PARTS" });
    await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "WAITING_PARTS" });
    const row = await prismaUnscoped.lineUpdate.findFirst({ where: { caseId } });
    expect(row?.bodyText).toContain("เร็ว ๆ นี้");
  });

  it("CATCH_UP describes the case as it stands", async () => {
    const caseId = await newCase();
    await linkContact();
    await addJob(caseId, "ทำสี", "QC");
    await addJob(caseId, "ผ้าเบรก", "WAITING", { waitingReason: "PARTS" });
    await addJob(caseId, "ปฏิเสธ", "DECLINED");
    await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "CATCH_UP" });
    const row = await prismaUnscoped.lineUpdate.findFirst({ where: { caseId } });
    expect(row?.bodyText).toBe(
      buildCatchUpBody({
        ...baseFacts(),
        plate: `${run}ค1`,
        reference: `${run}-RC-${caseIds.length}`,
        caseStatus: "CHECKED_IN",
        jobs: [
          { title: "ทำสี", status: "QC", waitingReason: null },
          { title: "ผ้าเบรก", status: "WAITING", waitingReason: "PARTS" },
          { title: "ปฏิเสธ", status: "DECLINED", waitingReason: null },
        ],
      }),
    );
    expect(row?.bodyText).not.toContain("ปฏิเสธ");
  });

  it("explicit photoIds are kept in the given order, but only this case's JPEG/PNG ones", async () => {
    const caseId = await newCase();
    const otherCase = await newCase();
    await linkContact();
    const a = await addPhoto(caseId, null, "image/jpeg", new Date());
    const b = await addPhoto(caseId, null, "image/png", new Date());
    const gif = await addPhoto(caseId, null, "image/gif", new Date());
    const foreign = await addPhoto(otherCase, null, "image/jpeg", new Date());
    await sendSystemUpdate(forShop(shopId), {
      actor: actor(),
      caseId,
      kind: "DELIVERED",
      photoIds: [b.id, gif.id, foreign.id, a.id],
    });
    const row = await prismaUnscoped.lineUpdate.findFirst({
      where: { caseId },
      include: { photos: { orderBy: { sortOrder: "asc" } } },
    });
    expect(row?.photos.map((p) => p.photoId)).toEqual([b.id, a.id]);
  });
});

describe("failures", () => {
  it("a transport error → FAILED row with null tokens, nothing in the outbox", async () => {
    const caseId = await newCase();
    await linkContact();
    const job = await addJob(caseId, "งาน", "COMPLETED");
    await addPhoto(caseId, job.id, "image/jpeg", new Date());
    await setChannelToken("live-not-a-dev-token");
    const before = await outboxCount();

    const result = await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "JOB_COMPLETED", jobId: job.id });

    expect(result).toMatchObject({ outcome: "FAILED", code: "invalidToken" });
    const row = await prismaUnscoped.lineUpdate.findFirst({ where: { caseId }, include: { photos: true } });
    expect(row?.deliveryStatus).toBe("FAILED");
    expect(row?.photos).toHaveLength(1);
    expect(row?.photos[0]!.publicToken).toBeNull();
    expect(await outboxCount()).toBe(before);
    const events = await prismaUnscoped.caseEvent.findMany({ where: { caseId, type: "LINE_UPDATE_FAILED" } });
    expect(events).toHaveLength(1);
  });

  it("an unknown case is reported, not thrown", async () => {
    const result = await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId: "nope", kind: "READY" });
    expect(result).toEqual({ outcome: "ERROR", error: "caseMissing" });
  });

  it("a JOB_COMPLETED whose Job is not on the case is reported, not thrown", async () => {
    const caseId = await newCase();
    const otherCase = await newCase();
    await linkContact();
    const job = await addJob(otherCase, "งาน", "COMPLETED");
    const result = await sendSystemUpdate(forShop(shopId), { actor: actor(), caseId, kind: "JOB_COMPLETED", jobId: job.id });
    expect(result).toEqual({ outcome: "ERROR", error: "jobMissing" });
    expect(await prismaUnscoped.lineUpdate.count({ where: { caseId } })).toBe(0);
  });

  it("a thrown error inside is swallowed and reported, never propagated", async () => {
    const broken = {
      repairCase: {
        findUnique: async () => {
          throw new Error("boom");
        },
      },
    } as unknown as ReturnType<typeof forShop>;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      sendSystemUpdate(broken, { actor: actor(), caseId: "x", kind: "READY" }),
    ).resolves.toEqual({ outcome: "ERROR", error: "failed" });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
