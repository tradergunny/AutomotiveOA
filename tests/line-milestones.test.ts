import { readFile, rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M7.10 step 6: the Milestone messages carried by Staff acts — Check-in,
 * Delivered, and the catch-up on linking a LINE Contact — through the real
 * actions (performCheckin, markCaseDelivered, the Settings link/unlink)
 * against a real database and the fake transport on a temp outbox.
 */

const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/line-milestones-${Date.now()}`;
  process.env.LINE_TRANSPORT = "fake";
  process.env.LINE_OUTBOX_PATH = `${dir}/outbox.jsonl`;
  process.env.LINE_CREDENTIALS_KEY = Buffer.alloc(32, 11).toString("base64");
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
const { performCheckin } = await import("@/app/(app)/checkin/actions");
const { markCaseDelivered } = await import("@/app/(app)/cases/[id]/flow-actions");
const { linkLineContact, unlinkLineContact } = await import("@/app/(app)/settings/actions");

const run = `lm-${Date.now()}`;
const LINE_USER = "U00000000000000000000000000lm0001";
const OTHER_LINE_USER = "U00000000000000000000000000lm0002";
let shopId: string;
let staffId: string;
let customerId: string;
let otherCustomerId: string;
let vehicleId: string;

type Outbox = { kind: string; payload: { to: string; messages: { type: string; text?: string }[] } };

async function outbox(): Promise<Outbox[]> {
  try {
    const raw = await readFile(LINE_OUTBOX_PATH, "utf8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Outbox);
  } catch {
    return [];
  }
}

async function pushedTexts(since: number): Promise<string[]> {
  return (await outbox()).slice(since).map((push) => push.payload.messages[0]!.text ?? "");
}

async function recordedKinds(caseId: string) {
  const rows = await prismaUnscoped.lineUpdate.findMany({ where: { caseId }, orderBy: { sentAt: "asc" } });
  return rows.map((row) => `${row.kind}:${row.deliveryStatus}`);
}

async function newCase(status: "CHECKED_IN" | "READY" | "DELIVERED" = "CHECKED_IN", contact = customerId) {
  const repairCase = await prismaUnscoped.repairCase.create({
    data: {
      shopId,
      reference: `${run}-RC-${Math.random().toString(36).slice(2, 7)}`,
      vehicleId,
      contactCustomerId: contact,
      openedByStaffId: staffId,
      status,
    },
  });
  return repairCase.id;
}

async function checkin(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return performCheckin({}, form);
}

async function contactRow(lineUserId = LINE_USER) {
  return prismaUnscoped.lineContact.upsert({
    where: { shopId_lineUserId: { shopId, lineUserId } },
    create: { shopId, lineUserId, displayName: `LINE ${lineUserId.slice(-4)}` },
    update: {},
  });
}

async function clearContacts() {
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
}

beforeAll(async () => {
  await rm(env.dir, { recursive: true, force: true });
  const shop = await prismaUnscoped.shop.create({ data: { name: `${run} Shop` } });
  shopId = shop.id;
  const staff = await prismaUnscoped.staff.create({ data: { shopId, name: `${run} Manager`, position: "manager" } });
  staffId = staff.id;
  const customer = await prismaUnscoped.customer.create({ data: { shopId, name: `${run} Customer`, phone: "0810000080" } });
  customerId = customer.id;
  const other = await prismaUnscoped.customer.create({ data: { shopId, name: `${run} Other`, phone: "0810000081" } });
  otherCustomerId = other.id;
  const vehicle = await prismaUnscoped.vehicle.create({
    data: { shopId, plate: `${run}จ1`, bodyType: "SEDAN", primaryCustomerId: customerId },
  });
  vehicleId = vehicle.id;
  await prismaUnscoped.shopLineChannel.create({
    data: {
      shopId,
      channelSecretEnc: sealCredential(shopId, "channelSecret", "secret"),
      channelAccessTokenEnc: sealCredential(shopId, "channelAccessToken", "dev-token"),
      connectedByStaffId: staffId,
    },
  });
  current.session = { userId: "u", shopId, staffId, role: "MANAGER", name: "", email: "" };
});

afterAll(async () => {
  await prismaUnscoped.arrival.deleteMany({ where: { shopId } });
  await prismaUnscoped.caseEvent.deleteMany({ where: { shopId } });
  await prismaUnscoped.followUp.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdatePhoto.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdate.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
  await prismaUnscoped.shopLineChannel.deleteMany({ where: { shopId } });
  await prismaUnscoped.job.deleteMany({ where: { shopId } });
  await prismaUnscoped.repairCase.deleteMany({ where: { shopId } });
  await prismaUnscoped.vehicle.deleteMany({ where: { shopId } });
  await prismaUnscoped.customer.deleteMany({ where: { shopId } });
  await prismaUnscoped.staff.deleteMany({ where: { shopId } });
  await prismaUnscoped.shop.delete({ where: { id: shopId } });
  await rm(env.dir, { recursive: true, force: true });
});

/** Each test starts from no cases and no contacts, so catch-ups count exactly. */
beforeEach(async () => {
  await clearContacts();
  await prismaUnscoped.arrival.deleteMany({ where: { shopId } });
  await prismaUnscoped.caseEvent.deleteMany({ where: { shopId } });
  await prismaUnscoped.followUp.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdatePhoto.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdate.deleteMany({ where: { shopId } });
  await prismaUnscoped.job.deleteMany({ where: { shopId } });
  await prismaUnscoped.repairCase.deleteMany({ where: { shopId } });
});

describe("Check-in", () => {
  it("from a LINE Arrival → CHECKIN sent with the wizard's note, and no catch-up for the link made inside", async () => {
    const arrival = await prismaUnscoped.arrival.create({
      data: {
        shopId,
        name: `${run} Customer`,
        phone: "0810000080",
        plate: `${run}จ1`,
        note: "เบรกมีเสียง",
        locale: "th",
        lineUserId: LINE_USER,
        lineDisplayName: "LINE user",
      },
    });
    const since = (await outbox()).length;

    const state = await checkin({
      contactCustomerId: customerId,
      vehicleId,
      arrivalId: arrival.id,
      note: "เบรกมีเสียง",
      customerNote: "  รับรถแล้ว จะรีบตรวจให้นะคะ  ",
    });

    expect(state.error).toBeUndefined();
    expect(state.caseId).toBeDefined();
    const caseId = state.caseId!;
    expect(await recordedKinds(caseId)).toEqual(["CHECKIN:SENT"]);
    const texts = await pushedTexts(since);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("ได้รับรถ");
    expect(texts[0]).toContain("ใบเสนอราคา");
    expect(texts[0]!.split("\n\n").at(-2)).toBe("รับรถแล้ว จะรีบตรวจให้นะคะ");
    expect((await outbox()).at(-1)!.payload.to).toBe(LINE_USER);
    // The link itself happened (the contact is now the customer's)…
    const contact = await prismaUnscoped.lineContact.findFirstOrThrow({ where: { shopId, lineUserId: LINE_USER } });
    expect(contact.customerId).toBe(customerId);
    // …and the case's internal timeline has the link and the send, nothing else LINE-wise.
    const events = await prismaUnscoped.caseEvent.findMany({ where: { caseId }, select: { type: true } });
    expect(events.map((e) => e.type).sort()).toEqual(["LINE_CUSTOMER_LINKED", "LINE_UPDATE_SENT"]);
  });

  it("from nothing → CHECKIN recorded as not-sent, the case still opened", async () => {
    const since = (await outbox()).length;
    const state = await checkin({ contactCustomerId: customerId, vehicleId });
    expect(state.caseId).toBeDefined();
    expect(await recordedKinds(state.caseId!)).toEqual(["CHECKIN:NOT_SENT"]);
    const row = await prismaUnscoped.lineUpdate.findFirstOrThrow({ where: { caseId: state.caseId! } });
    expect(row.errorCode).toBe("noIdentity");
    expect(row.lineUserId).toBeNull();
    expect((await outbox()).length).toBe(since);
  });

  it("a refused check-in sends nothing", async () => {
    const since = (await outbox()).length;
    const state = await checkin({ contactCustomerId: customerId }); // no vehicle
    expect(state.error).toBe("plateRequired");
    expect((await outbox()).length).toBe(since);
  });
});

describe("linking a LINE Contact later", () => {
  it("sends one CATCH_UP per open case, none for delivered cases", async () => {
    const open1 = (await checkin({ contactCustomerId: customerId, vehicleId })).caseId!;
    const open2 = await newCase("CHECKED_IN");
    const delivered = await newCase("DELIVERED");
    await prismaUnscoped.job.create({
      data: { shopId, caseId: open1, title: "ทำสี", status: "WAITING", waitingReason: "PARTS", payerType: "CUSTOMER", priceSatang: 100_000, createdByStaffId: staffId },
    });
    const contact = await contactRow();
    const since = (await outbox()).length;

    const res = await linkLineContact(contact.id, customerId);

    expect(res.ok).toBe(true);
    const texts = await pushedTexts(since);
    expect(texts).toHaveLength(2);
    expect(texts.every((text) => text.includes("เชื่อมต่อ LINE"))).toBe(true);
    expect(texts.some((text) => text.includes("· ทำสี — รออะไหล่"))).toBe(true);
    expect(await recordedKinds(open1)).toEqual(["CHECKIN:NOT_SENT", "CATCH_UP:SENT"]);
    expect(await recordedKinds(open2)).toEqual(["CATCH_UP:SENT"]);
    expect(await recordedKinds(delivered)).toEqual([]);
  });

  it("a customer with no open case gets nothing", async () => {
    await newCase("DELIVERED");
    const contact = await contactRow();
    const since = (await outbox()).length;
    expect((await linkLineContact(contact.id, customerId)).ok).toBe(true);
    expect((await outbox()).length).toBe(since);
  });

  it("moving a contact to another customer catches up the new customer only — the one it left hears nothing", async () => {
    const mine = await newCase("CHECKED_IN", customerId);
    const theirs = await newCase("CHECKED_IN", otherCustomerId);
    const contact = await contactRow();
    expect((await linkLineContact(contact.id, otherCustomerId)).ok).toBe(true);
    expect(await recordedKinds(theirs)).toEqual(["CATCH_UP:SENT"]);
    const since = (await outbox()).length;

    expect((await linkLineContact(contact.id, customerId)).ok).toBe(true);

    expect(await recordedKinds(mine)).toEqual(["CATCH_UP:SENT"]);
    expect(await recordedKinds(theirs)).toEqual(["CATCH_UP:SENT"]); // no second row, no NOT_SENT junk
    expect((await outbox()).length).toBe(since + 1);
    expect((await outbox()).at(-1)!.payload.to).toBe(LINE_USER);
  });

  it("replacing a customer's contact with another catches up on the new identity", async () => {
    const caseId = await newCase("CHECKED_IN");
    const first = await contactRow(LINE_USER);
    expect((await linkLineContact(first.id, customerId)).ok).toBe(true);
    const second = await contactRow(OTHER_LINE_USER);
    const since = (await outbox()).length;
    expect((await linkLineContact(second.id, customerId)).ok).toBe(true);
    expect(await recordedKinds(caseId)).toEqual(["CATCH_UP:SENT", "CATCH_UP:SENT"]);
    expect((await outbox()).at(-1)!.payload.to).toBe(OTHER_LINE_USER);
    expect((await outbox()).length).toBe(since + 1);
  });

  it("the unlink path sends nothing", async () => {
    const caseId = await newCase("CHECKED_IN");
    const contact = await contactRow();
    expect((await linkLineContact(contact.id, customerId)).ok).toBe(true);
    const since = (await outbox()).length;
    expect((await unlinkLineContact(contact.id)).ok).toBe(true);
    expect((await outbox()).length).toBe(since);
    expect(await recordedKinds(caseId)).toEqual(["CATCH_UP:SENT"]);
  });
});

describe("Delivered", () => {
  it("sends DELIVERED with the dialog's note as the last paragraph and no money line", async () => {
    const caseId = await newCase("READY");
    await prismaUnscoped.job.create({
      data: { shopId, caseId, title: "งาน", status: "COMPLETED", payerType: "CUSTOMER", priceSatang: 250_000, createdByStaffId: staffId },
    });
    const contact = await contactRow();
    expect((await linkLineContact(contact.id, customerId)).ok).toBe(true);
    const since = (await outbox()).length;

    const res = await markCaseDelivered(caseId, { note: "  ขอบคุณที่รอนะคะ  " });

    expect(res).toEqual({ ok: true, value: { status: "DELIVERED" } });
    const texts = await pushedTexts(since);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("ขอบคุณ");
    expect(texts[0]).not.toContain("฿");
    expect(texts[0]!.split("\n\n").at(-2)).toBe("ขอบคุณที่รอนะคะ");
    expect(await recordedKinds(caseId)).toEqual(["CATCH_UP:SENT", "DELIVERED:SENT"]);
    expect((await prismaUnscoped.repairCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("DELIVERED");
  });

  it("delivery of an unreachable customer still delivers, recorded as not-sent", async () => {
    const caseId = await newCase("READY");
    const since = (await outbox()).length;
    expect((await markCaseDelivered(caseId)).ok).toBe(true);
    expect(await recordedKinds(caseId)).toEqual(["DELIVERED:NOT_SENT"]);
    expect((await outbox()).length).toBe(since);
  });

  it("a refused delivery (not Ready) sends nothing", async () => {
    const caseId = await newCase("CHECKED_IN");
    const since = (await outbox()).length;
    expect(await markCaseDelivered(caseId)).toEqual({ ok: false, error: "notReady" });
    expect((await outbox()).length).toBe(since);
    expect(await recordedKinds(caseId)).toEqual([]);
  });
});
