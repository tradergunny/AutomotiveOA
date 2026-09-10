import { readFile, rm } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "@/messages/en.json";

/**
 * M7.10 step 7: the case page's Customer Updates section (D-29) — the
 * free-form action still validates and now writes FREEFORM; the compact log
 * renders a not-sent entry with its reason; the Send-a-message form opens
 * pre-filled from the Follow-up deep link. The components are rendered to
 * static markup (no DOM) inside the real message catalogue, so the
 * assertions read the catalogue rather than hard-coding copy.
 */

const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/line-page-${Date.now()}`;
  process.env.LINE_TRANSPORT = "fake";
  process.env.LINE_OUTBOX_PATH = `${dir}/outbox.jsonl`;
  process.env.LINE_CREDENTIALS_KEY = Buffer.alloc(32, 13).toString("base64");
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
const { LINE_OUTBOX_PATH, LINE_MAX_TEXT_LENGTH } = await import("@/lib/line");
const { sendLineUpdate } = await import("@/app/(app)/cases/[id]/line-actions");
const { CustomerTimeline } = await import("@/app/(app)/cases/[id]/customer-timeline");
const { SendMessageForm } = await import("@/app/(app)/cases/[id]/send-message-dialog");
const { buildFollowUpDraftBody } = await import("@/lib/line-draft");

const run = `lp-${Date.now()}`;
const LINE_USER = "U00000000000000000000000000lp0001";
let shopId: string;
let staffId: string;
let customerId: string;
let vehicleId: string;
let caseId: string;

const tl = enMessages.customerTimeline;

async function outboxCount(): Promise<number> {
  try {
    return (await readFile(LINE_OUTBOX_PATH, "utf8")).trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

async function addPhoto(forCase: string, contentType = "image/jpeg") {
  return prismaUnscoped.photo.create({
    data: {
      shopId,
      caseId: forCase,
      storageKey: `${run}/${Math.random().toString(36).slice(2)}`,
      contentType,
      sizeBytes: 10,
      uploadedByStaffId: staffId,
    },
  });
}

async function linkContact() {
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineContact.create({
    data: { shopId, lineUserId: LINE_USER, displayName: "LINE user", customerId, linkedByStaffId: staffId, linkedAt: new Date() },
  });
}

beforeAll(async () => {
  await rm(env.dir, { recursive: true, force: true });
  const shop = await prismaUnscoped.shop.create({ data: { name: `${run} Shop` } });
  shopId = shop.id;
  const staff = await prismaUnscoped.staff.create({ data: { shopId, name: `${run} Advisor`, position: "advisor" } });
  staffId = staff.id;
  const customer = await prismaUnscoped.customer.create({ data: { shopId, name: `${run} Customer`, phone: "0810000082" } });
  customerId = customer.id;
  const vehicle = await prismaUnscoped.vehicle.create({
    data: { shopId, plate: `${run}ฉ1`, bodyType: "SEDAN", primaryCustomerId: customerId },
  });
  vehicleId = vehicle.id;
  const repairCase = await prismaUnscoped.repairCase.create({
    data: { shopId, reference: `${run}-RC-1`, vehicleId, contactCustomerId: customerId, openedByStaffId: staffId },
  });
  caseId = repairCase.id;
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
  await prismaUnscoped.caseEvent.deleteMany({ where: { shopId } });
  await prismaUnscoped.followUp.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdatePhoto.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdate.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
  await prismaUnscoped.shopLineChannel.deleteMany({ where: { shopId } });
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
});

describe("sendLineUpdate (the dialog's action)", () => {
  it("refuses an empty body", async () => {
    expect(await sendLineUpdate(caseId, form({ body: "   " }))).toEqual({ ok: false, error: "bodyRequired" });
  });

  it("refuses a body longer than LINE allows", async () => {
    expect(await sendLineUpdate(caseId, form({ body: "ก".repeat(LINE_MAX_TEXT_LENGTH + 1) }))).toEqual({
      ok: false,
      error: "bodyTooLong",
    });
  });

  it("refuses more than four photos", async () => {
    expect(
      await sendLineUpdate(caseId, form({ body: "x", photoId: ["a", "b", "c", "d", "e"] })),
    ).toEqual({ ok: false, error: "tooManyPhotos" });
  });

  it("refuses a photo that is not this case's, or not a format LINE fetches", async () => {
    const other = await prismaUnscoped.repairCase.create({
      data: { shopId, reference: `${run}-RC-2`, vehicleId, contactCustomerId: customerId, openedByStaffId: staffId },
    });
    const foreign = await addPhoto(other.id);
    const webp = await addPhoto(caseId, "image/webp");
    expect(await sendLineUpdate(caseId, form({ body: "x", photoId: [foreign.id] }))).toEqual({ ok: false, error: "photoInvalid" });
    expect(await sendLineUpdate(caseId, form({ body: "x", photoId: [webp.id] }))).toEqual({ ok: false, error: "photoInvalid" });
  });

  it("refuses a follow-up that belongs to another case", async () => {
    const other = await prismaUnscoped.repairCase.create({
      data: { shopId, reference: `${run}-RC-3`, vehicleId, contactCustomerId: customerId, openedByStaffId: staffId },
    });
    const followUp = await prismaUnscoped.followUp.create({
      data: { shopId, caseId: other.id, customerId, jobTitle: "กระจกหน้า", quotedPriceSatang: 1_800_000 },
    });
    expect(await sendLineUpdate(caseId, form({ body: "x", followUpId: followUp.id }))).toEqual({ ok: false, error: "followUpMissing" });
  });

  it("says why when the gate blocks, and records nothing (the dialog shows the reason instead)", async () => {
    await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
    const before = await prismaUnscoped.lineUpdate.count({ where: { caseId } });
    expect(await sendLineUpdate(caseId, form({ body: "x" }))).toEqual({ ok: false, error: "noIdentity" });
    expect(await prismaUnscoped.lineUpdate.count({ where: { caseId } })).toBe(before);
  });

  it("sends and writes a FREEFORM row with the photos in the chosen order", async () => {
    const a = await addPhoto(caseId);
    const b = await addPhoto(caseId, "image/png");
    const since = await outboxCount();
    const res = await sendLineUpdate(caseId, form({ body: "  ร้านปิดวันจันทร์นะคะ\r\nขออภัยค่ะ  ", photoId: [b.id, a.id] }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.kind).toBe("FREEFORM");
    expect(res.value.bodyText).toBe("ร้านปิดวันจันทร์นะคะ\nขออภัยค่ะ");
    expect(res.value.photoIds).toEqual([b.id, a.id]);
    const row = await prismaUnscoped.lineUpdate.findUniqueOrThrow({ where: { id: res.value.id } });
    expect(row.kind).toBe("FREEFORM");
    expect(row.deliveryStatus).toBe("SENT");
    expect(await outboxCount()).toBe(since + 1);
  });

  it("flips the Follow-up to contacted when sent from its deep link", async () => {
    const followUp = await prismaUnscoped.followUp.create({
      data: { shopId, caseId, customerId, jobTitle: "ผ้าเบรกหลัง", quotedPriceSatang: 250_000 },
    });
    const res = await sendLineUpdate(caseId, form({ body: "ติดตามเรื่องผ้าเบรกค่ะ", followUpId: followUp.id }));
    expect(res.ok).toBe(true);
    const row = await prismaUnscoped.followUp.findUniqueOrThrow({ where: { id: followUp.id } });
    expect(row.status).toBe("CONTACTED");
    const event = await prismaUnscoped.caseEvent.findFirst({ where: { caseId, type: "FOLLOW_UP_CONTACTED" } });
    expect(event?.followUpId).toBe(followUp.id);
  });
});

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** Static markup with the entities React escapes read back, so copy compares as written. */
function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Bangkok">
      {node}
    </NextIntlClientProvider>,
  )
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');
}

const update = (over: Partial<Parameters<typeof CustomerTimeline>[0]["initialUpdates"][number]> = {}) => ({
  id: "u1",
  bodyText: "สวัสดีค่ะ คุณทดสอบ\nทางอู่ได้รับรถทะเบียน กข1234 (RC-1) เรียบร้อยแล้วค่ะ\n\nอู่ทดสอบ",
  deliveryStatus: "SENT" as const,
  kind: "CHECKIN" as const,
  errorCode: null,
  recipientName: "คุณทดสอบ",
  sentByName: "Advisor",
  sentAt: "2026-09-10T07:02:00.000Z",
  photoIds: [],
  quotationLabel: null,
  ...over,
});

const timelineProps = (updates: ReturnType<typeof update>[]) => ({
  caseId: "c1",
  initialUpdates: updates,
  draftBody: "draft",
  photos: [],
  recipientName: "คุณทดสอบ",
  blockedReason: null,
  maxPhotos: 4,
  followUp: null,
});

describe("the compact log", () => {
  it("renders a not-sent entry with its reason", () => {
    const html = render(
      <CustomerTimeline
        {...timelineProps([update({ deliveryStatus: "NOT_SENT", errorCode: "noIdentity", kind: "CHECKIN" })])}
      />,
    );
    expect(html).toContain(tl.status.NOT_SENT);
    expect(html).toContain(tl.reason.noIdentity);
    expect(html).toContain(tl.kind.CHECKIN);
    expect(html).not.toContain(tl.status.SENT);
  });

  it("shows only the newest line when collapsed, with the kind, the photo count and the note", () => {
    const newest = update({
      id: "u2",
      kind: "READY",
      sentAt: "2026-09-11T03:00:00.000Z",
      photoIds: ["p1", "p2"],
      bodyText: "สวัสดีค่ะ คุณทดสอบ\nงานซ่อมรถทะเบียน กข1234 (RC-1) เสร็จเรียบร้อยแล้ว\n\nรถพร้อมให้เข้ามารับได้แล้วค่ะ\n\nล้างรถให้แล้วนะคะ\n\nอู่ทดสอบ",
    });
    const older = update({ id: "u1", kind: "WORK_STARTED" });
    const html = render(<CustomerTimeline {...timelineProps([newest, older])} />);
    expect(html).toContain(tl.kind.READY);
    expect(html).not.toContain(tl.kind.WORK_STARTED);
    expect(html).toContain("2 photos");
    expect(html).toContain(tl.withNote);
    // The Thai body stays behind the expand — the line is a line.
    expect(html).not.toContain("ล้างรถให้แล้วนะคะ");
  });

  it("names a failed entry and a staff-written one", () => {
    const html = render(
      <CustomerTimeline
        {...timelineProps([update({ deliveryStatus: "FAILED", errorCode: "network", kind: "FREEFORM" })])}
      />,
    );
    expect(html).toContain(tl.status.FAILED);
    expect(html).toContain(tl.kind.FREEFORM);
  });

  it("offers Send a message, and says why when the gate blocks", () => {
    const html = render(<CustomerTimeline {...timelineProps([])} blockedReason="unfollowed" />);
    expect(html).toContain(tl.sendMessage);
    expect(html).toContain(tl.empty);
  });
});

describe("the Send-a-message form", () => {
  const photos = [
    { id: "p1", contentType: "image/jpeg", origin: "case" as const },
    { id: "p2", contentType: "image/webp", origin: "job" as const },
  ];

  it("opens pre-filled from the follow-up link, naming the follow-up", () => {
    const draft = buildFollowUpDraftBody({
      shopName: "อู่ทดสอบ",
      customerName: "ทดสอบ",
      plate: "กข1234",
      source: { kind: "job", title: "กระจกหน้า", quotedPriceSatang: 1_800_000 },
    });
    const html = render(
      <SendMessageForm
        caseId="c1"
        recipientName="คุณทดสอบ"
        initialBody={draft}
        photos={photos}
        blockedReason={null}
        maxPhotos={4}
        followUp={{ id: "f1", label: "กระจกหน้า" }}
        onSent={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("กระจกหน้า");
    expect(html).toContain("฿18,000");
    expect(html).toContain(tl.dialog.followupContext.replace("{label}", "กระจกหน้า"));
    expect(html).toContain(tl.dialog.send);
    // One Send — no preview, no arm-then-confirm.
    expect(html).not.toContain(">Preview<");
    expect(html.match(new RegExp(`>${tl.dialog.send}<`, "g"))).toHaveLength(1);
    // Only LINE-fetchable photos are offered.
    expect(html).toContain("/api/photos/p1");
    expect(html).not.toContain("/api/photos/p2");
  });

  it("says why when the gate blocks, and disables Send", () => {
    const html = render(
      <SendMessageForm
        caseId="c1"
        recipientName="คุณทดสอบ"
        initialBody="draft"
        photos={[]}
        blockedReason="noIdentity"
        maxPhotos={4}
        followUp={null}
        onSent={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain(tl.blocked.noIdentity);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*<svg[\s\S]*?<\/svg>Send<\/button>/);
  });
});
