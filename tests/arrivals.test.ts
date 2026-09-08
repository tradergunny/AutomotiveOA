import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ARRIVAL_CAP,
  ArrivalConsumeError,
  arrivalQueue,
  arrivalStaleBefore,
  consumeArrival,
  createArrival,
  isArrivalStale,
  newArrivalToken,
  parseArrivalInput,
  recognizeVehicles,
  waitingArrivalWhere,
  type ArrivalRawInput,
} from "@/lib/arrivals";
import { prismaUnscoped } from "@/lib/db";
import { resolveArrivalShop } from "@/lib/line-public";
import { forShop } from "@/lib/tenant";

/**
 * Arrivals (M7.8 brief §11): the token resolve and rotation, the cap and the
 * 24-hour staleness, write-only submission, vehicles-only recognition,
 * consumption atomicity (a conflict or a bad Arrival writes nothing), the
 * link made during consumption and its replacement of a previous one, and
 * the rule that a body-supplied userId never reaches a row.
 */

const run = `arr-${Date.now()}`;
const LINKED_USER = "U00000000000000000000000000000a11";
const UNKNOWN_USER = "U00000000000000000000000000000b22";

let shopId: string;
let staffId: string;
let customerA: { id: string; name: string; phone: string };
let customerB: { id: string; name: string; phone: string };
let vehicleA: { id: string; plate: string };
let contactLinkedToA: { id: string };

const db = () => forShop(shopId);

const raw = (over: Partial<ArrivalRawInput> = {}): ArrivalRawInput => ({
  name: "สมหญิง ทดสอบ",
  phone: "081-000-2222",
  plate: "ทด 9999",
  bodyType: "PICKUP",
  note: "เบรกมีเสียง",
  odometer: "45,300",
  locale: "th",
  ...over,
});

/** The check-in transaction's shape, reduced to what consumption needs. */
async function checkinWith(input: {
  arrivalId: string;
  contact: { id: string; created: boolean };
  identityDecision: string | null;
}) {
  return db().$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirstOrThrow({ where: { id: vehicleA.id } });
    const repairCase = await tx.repairCase.create({
      data: {
        shopId,
        reference: `${run}-RC-${Math.random().toString(36).slice(2, 7)}`,
        vehicleId: vehicle.id,
        contactCustomerId: input.contact.id,
        openedByStaffId: staffId,
      },
      select: { id: true },
    });
    await consumeArrival(tx, {
      shopId,
      arrivalId: input.arrivalId,
      caseId: repairCase.id,
      contact: input.contact,
      staffId,
      identityDecision: input.identityDecision,
    });
    return repairCase.id;
  });
}

beforeAll(async () => {
  const shop = await prismaUnscoped.shop.create({ data: { name: `${run} Shop` } });
  shopId = shop.id;
  const staff = await prismaUnscoped.staff.create({ data: { shopId, name: `${run} Advisor` } });
  staffId = staff.id;
  customerA = await prismaUnscoped.customer.create({
    data: { shopId, name: `${run} Customer A`, phone: "0810001111" },
    select: { id: true, name: true, phone: true },
  });
  customerB = await prismaUnscoped.customer.create({
    data: { shopId, name: `${run} Customer B`, phone: "0810002222" },
    select: { id: true, name: true, phone: true },
  });
  vehicleA = await prismaUnscoped.vehicle.create({
    data: {
      shopId,
      plate: `${run}A`,
      bodyType: "SEDAN",
      make: "Toyota",
      model: "Vios",
      color: "ขาว",
      primaryCustomerId: customerA.id,
    },
    select: { id: true, plate: true },
  });
  contactLinkedToA = await prismaUnscoped.lineContact.create({
    data: {
      shopId,
      lineUserId: LINKED_USER,
      displayName: "Linked A",
      customerId: customerA.id,
      linkedByStaffId: staffId,
      linkedAt: new Date(),
    },
    select: { id: true },
  });
});

afterAll(async () => {
  await prismaUnscoped.caseEvent.deleteMany({ where: { shopId } });
  await prismaUnscoped.arrival.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId } });
  await prismaUnscoped.repairCase.deleteMany({ where: { shopId } });
  await prismaUnscoped.vehicle.deleteMany({ where: { shopId } });
  await prismaUnscoped.customer.deleteMany({ where: { shopId } });
  await prismaUnscoped.staff.deleteMany({ where: { shopId } });
  await prismaUnscoped.shop.deleteMany({ where: { id: shopId } });
  await prismaUnscoped.$disconnect();
});

describe("the form key", () => {
  it("is 22 characters of base64url and resolves to exactly one shop", async () => {
    const token = newArrivalToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newArrivalToken()).not.toBe(token);

    await prismaUnscoped.shop.update({ where: { id: shopId }, data: { arrivalToken: token } });
    const resolved = await resolveArrivalShop(token);
    expect(resolved?.shopId).toBe(shopId);
    expect(resolved?.shopName).toBe(`${run} Shop`);
    expect(resolved?.liffId).toBeNull();
  });

  it("dies on rotation: the old token 404s, the new one works", async () => {
    const before = (await prismaUnscoped.shop.findUniqueOrThrow({ where: { id: shopId } })).arrivalToken!;
    const after = newArrivalToken();
    await prismaUnscoped.shop.update({
      where: { id: shopId },
      data: { arrivalToken: after, arrivalTokenRotatedAt: new Date() },
    });
    expect(await resolveArrivalShop(before)).toBeNull();
    expect((await resolveArrivalShop(after))?.shopId).toBe(shopId);
  });

  it("refuses malformed tokens without touching the database", async () => {
    expect(await resolveArrivalShop("")).toBeNull();
    expect(await resolveArrivalShop("short")).toBeNull();
    expect(await resolveArrivalShop("x".repeat(23))).toBeNull();
    expect(await resolveArrivalShop("' OR 1=1 --xxxxxxxxxxxx")).toBeNull();
  });

  it("disabling nulls the token and both URLs 404", async () => {
    const token = (await prismaUnscoped.shop.findUniqueOrThrow({ where: { id: shopId } })).arrivalToken!;
    await prismaUnscoped.shop.update({ where: { id: shopId }, data: { arrivalToken: null } });
    expect(await resolveArrivalShop(token)).toBeNull();
  });
});

describe("what the customer typed", () => {
  it("normalizes the way check-in does and keeps exactly the first-time fields", () => {
    const parsed = parseArrivalInput(raw({ phone: "+66 81 000 2222", plate: "ทด-9999", odometer: "45,300" }));
    expect(parsed).toEqual({
      ok: true,
      value: {
        name: "สมหญิง ทดสอบ",
        phone: "0810002222",
        plate: "ทด9999",
        bodyType: "PICKUP",
        note: "เบรกมีเสียง",
        odometerKm: 45_300,
        locale: "th",
      },
    });
  });

  it("names the missing field", () => {
    expect(parseArrivalInput(raw({ name: " " }))).toEqual({ ok: false, error: "nameRequired" });
    expect(parseArrivalInput(raw({ phone: "12" }))).toEqual({ ok: false, error: "phoneInvalid" });
    expect(parseArrivalInput(raw({ plate: "" }))).toEqual({ ok: false, error: "plateRequired" });
    expect(parseArrivalInput(raw({ bodyType: "VAN" }))).toEqual({ ok: false, error: "bodyTypeRequired" });
    expect(parseArrivalInput(raw({ note: "" }))).toEqual({ ok: false, error: "noteRequired" });
    expect(parseArrivalInput(raw({ odometer: "" }))).toMatchObject({ ok: true, value: { odometerKm: null } });
  });
});

describe("submission is write-only and creates an Arrival and nothing else", () => {
  it("plain door: one Arrival row, no Customer, Vehicle, or case; the echo is what was typed", async () => {
    const [customers, vehicles, cases] = await Promise.all([
      prismaUnscoped.customer.count({ where: { shopId } }),
      prismaUnscoped.vehicle.count({ where: { shopId } }),
      prismaUnscoped.repairCase.count({ where: { shopId } }),
    ]);
    // The phone belongs to an existing Customer: the page must not react.
    const res = await createArrival(db(), shopId, {
      raw: raw({ phone: customerA.phone, name: "ชื่อที่พิมพ์" }),
      vehicleId: null,
      identity: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.echo).toEqual({
      name: "ชื่อที่พิมพ์",
      phone: customerA.phone,
      plate: "ทด9999",
      bodyType: "PICKUP",
      note: "เบรกมีเสียง",
      odometerKm: 45_300,
    });
    const row = await prismaUnscoped.arrival.findUniqueOrThrow({ where: { id: res.id } });
    expect(row.status).toBe("WAITING");
    expect(row.lineUserId).toBeNull();
    expect(row.vehicleId).toBeNull();
    expect(await prismaUnscoped.customer.count({ where: { shopId } })).toBe(customers);
    expect(await prismaUnscoped.vehicle.count({ where: { shopId } })).toBe(vehicles);
    expect(await prismaUnscoped.repairCase.count({ where: { shopId } })).toBe(cases);
  });

  it("a body-supplied userId has nowhere to land — identity comes only from verification", async () => {
    const smuggled = { ...raw(), lineUserId: UNKNOWN_USER, userId: UNKNOWN_USER } as ArrivalRawInput;
    const res = await createArrival(db(), shopId, { raw: smuggled, vehicleId: null, identity: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await prismaUnscoped.arrival.findUniqueOrThrow({ where: { id: res.id } });
    expect(row.lineUserId).toBeNull();
  });

  it("LINE door, linked identity: the person comes from the record, the car from the tap, and the echo shows neither name nor phone", async () => {
    const res = await createArrival(db(), shopId, {
      raw: raw({ name: "", phone: "", plate: "", bodyType: "" }),
      vehicleId: vehicleA.id,
      identity: { userId: LINKED_USER, displayName: "Linked A", pictureUrl: "https://p/x.jpg" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.echo.name).toBeNull();
    expect(res.echo.phone).toBeNull();
    expect(res.echo.plate).toBe(vehicleA.plate);
    const row = await prismaUnscoped.arrival.findUniqueOrThrow({ where: { id: res.id } });
    expect(row.name).toBe(customerA.name);
    expect(row.phone).toBe(customerA.phone);
    expect(row.vehicleId).toBe(vehicleA.id);
    expect(row.bodyType).toBe("SEDAN");
    expect(row.lineUserId).toBe(LINKED_USER);
    expect(row.linePictureUrl).toBe("https://p/x.jpg");
  });

  it("LINE door, linked identity, another car: refuses a car that is not theirs", async () => {
    const res = await createArrival(db(), shopId, {
      raw: raw(),
      vehicleId: "not-their-vehicle",
      identity: { userId: LINKED_USER, displayName: null, pictureUrl: null },
    });
    expect(res).toEqual({ ok: false, error: "vehicleRequired" });
  });

  it("LINE door, unknown identity: the plain form, with the identity stored", async () => {
    const res = await createArrival(db(), shopId, {
      raw: raw({ phone: "0810003333" }),
      vehicleId: null,
      identity: { userId: UNKNOWN_USER, displayName: "Stranger", pictureUrl: null },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await prismaUnscoped.arrival.findUniqueOrThrow({ where: { id: res.id } });
    expect(row.name).toBe("สมหญิง ทดสอบ");
    expect(row.lineUserId).toBe(UNKNOWN_USER);
  });
});

describe("recognition", () => {
  it("returns the linked Customer's vehicles only", async () => {
    const vehicles = await recognizeVehicles(db(), {
      userId: LINKED_USER,
      displayName: null,
      pictureUrl: null,
    });
    expect(vehicles).toEqual([
      { id: vehicleA.id, plate: vehicleA.plate, bodyType: "SEDAN", description: "Toyota Vios ขาว" },
    ]);
    // Nothing else about the Customer is in the shape.
    expect(Object.keys(vehicles![0]).sort()).toEqual(["bodyType", "description", "id", "plate"]);
  });

  it("returns null for an unlinked or unknown identity", async () => {
    await prismaUnscoped.lineContact.create({
      data: { shopId, lineUserId: "U00000000000000000000000000000c33" },
    });
    expect(
      await recognizeVehicles(db(), { userId: "U00000000000000000000000000000c33", displayName: null, pictureUrl: null }),
    ).toBeNull();
    expect(
      await recognizeVehicles(db(), { userId: "U00000000000000000000000000000d44", displayName: null, pictureUrl: null }),
    ).toBeNull();
  });
});

describe("the queue: cap and staleness", () => {
  it("a row older than 24 hours is stale — off the queue and out of the count, but still in place", async () => {
    const now = new Date();
    const stale = await prismaUnscoped.arrival.create({
      data: {
        shopId,
        name: "เก่า",
        phone: "0810009999",
        plate: "เก่า1",
        note: "x",
        locale: "th",
        submittedAt: new Date(now.getTime() - 25 * 3_600_000),
      },
    });
    expect(isArrivalStale(stale.submittedAt, now)).toBe(true);
    expect(isArrivalStale(new Date(now.getTime() - 23 * 3_600_000), now)).toBe(false);
    expect(arrivalStaleBefore(now).getTime()).toBe(now.getTime() - 24 * 3_600_000);

    const queue = await arrivalQueue(db(), now);
    expect(queue.map((r) => r.id)).not.toContain(stale.id);
    const count = await db().arrival.count({ where: waitingArrivalWhere(now) });
    expect(count).toBe(queue.length);
    expect((await prismaUnscoped.arrival.findUnique({ where: { id: stale.id } }))?.status).toBe("WAITING");
  });

  it("the queue is newest first and carries each identity's current link", async () => {
    const queue = await arrivalQueue(db());
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i - 1].submittedAt >= queue[i].submittedAt).toBe(true);
    }
    const linkedRow = queue.find((r) => r.line && r.linkedCustomer);
    expect(linkedRow?.linkedCustomer?.id).toBe(customerA.id);
    const unknownRow = queue.find((r) => r.line && !r.linkedCustomer);
    expect(unknownRow).toBeDefined();
  });

  it("refuses the 51st waiting Arrival politely", async () => {
    const now = new Date();
    const existing = await db().arrival.count({ where: waitingArrivalWhere(now) });
    const filler = Array.from({ length: ARRIVAL_CAP - existing }, (_, i) => ({
      shopId,
      name: `flood ${i}`,
      phone: `0819${String(i).padStart(6, "0")}`,
      plate: `FL${i}`,
      note: "x",
      locale: "en" as const,
      submittedAt: now,
    }));
    await prismaUnscoped.arrival.createMany({ data: filler });
    const res = await createArrival(db(), shopId, { raw: raw(), vehicleId: null, identity: null }, now);
    expect(res).toEqual({ ok: false, error: "queueFull" });
    await prismaUnscoped.arrival.deleteMany({ where: { shopId, name: { startsWith: "flood " } } });
  });
});

describe("consumption", () => {
  async function waitingArrival(identity: string | null, phone = "0810005555") {
    return prismaUnscoped.arrival.create({
      data: {
        shopId,
        name: "ผู้มา",
        phone,
        plate: "มา1",
        note: "x",
        locale: "th",
        lineUserId: identity,
        lineDisplayName: identity ? "From token" : null,
        linePictureUrl: identity ? "https://p/t.jpg" : null,
      },
    });
  }

  it("flips the row to CHECKED_IN pointing at the case, recording who and when", async () => {
    const arrival = await waitingArrival(null);
    const caseId = await checkinWith({
      arrivalId: arrival.id,
      contact: { id: customerB.id, created: false },
      identityDecision: null,
    });
    const row = await prismaUnscoped.arrival.findUniqueOrThrow({ where: { id: arrival.id } });
    expect(row.status).toBe("CHECKED_IN");
    expect(row.caseId).toBe(caseId);
    expect(row.handledByStaffId).toBe(staffId);
    expect(row.handledAt).not.toBeNull();
  });

  it("a CHECKED_IN or DISMISSED row refuses with arrivalGone — and the case is not created", async () => {
    const arrival = await waitingArrival(null);
    await checkinWith({ arrivalId: arrival.id, contact: { id: customerB.id, created: false }, identityDecision: null });
    const before = await prismaUnscoped.repairCase.count({ where: { shopId } });
    await expect(
      checkinWith({ arrivalId: arrival.id, contact: { id: customerB.id, created: false }, identityDecision: null }),
    ).rejects.toThrow(ArrivalConsumeError);
    expect(await prismaUnscoped.repairCase.count({ where: { shopId } })).toBe(before);

    const dismissed = await waitingArrival(null);
    await prismaUnscoped.arrival.update({ where: { id: dismissed.id }, data: { status: "DISMISSED" } });
    await expect(
      checkinWith({ arrivalId: dismissed.id, contact: { id: customerB.id, created: false }, identityDecision: null }),
    ).rejects.toMatchObject({ code: "arrivalGone" });
  });

  it("an unknown identity becomes a LineContact linked to the contact, with the event on the new case", async () => {
    const userId = "U00000000000000000000000000000e55";
    const arrival = await waitingArrival(userId);
    const caseId = await checkinWith({
      arrivalId: arrival.id,
      contact: { id: customerB.id, created: false },
      identityDecision: null,
    });
    const contact = await prismaUnscoped.lineContact.findUniqueOrThrow({
      where: { shopId_lineUserId: { shopId, lineUserId: userId } },
    });
    expect(contact.customerId).toBe(customerB.id);
    expect(contact.displayName).toBe("From token");
    expect(contact.pictureUrl).toBe("https://p/t.jpg");
    expect(contact.linkedByStaffId).toBe(staffId);
    const events = await prismaUnscoped.caseEvent.findMany({ where: { caseId } });
    expect(events.map((e) => e.type)).toEqual(["LINE_CUSTOMER_LINKED"]);
    expect(events[0].subjectName).toBe("From token");
    // Customer B is now linked; free the slot for the tests below.
    await prismaUnscoped.lineContact.update({ where: { id: contact.id }, data: { customerId: null } });
  });

  it("the hard stop: identity linked elsewhere and no choice → nothing is written", async () => {
    const arrival = await waitingArrival(LINKED_USER, customerB.phone);
    const [cases, events] = await Promise.all([
      prismaUnscoped.repairCase.count({ where: { shopId } }),
      prismaUnscoped.caseEvent.count({ where: { shopId } }),
    ]);
    await expect(
      checkinWith({ arrivalId: arrival.id, contact: { id: customerB.id, created: false }, identityDecision: null }),
    ).rejects.toMatchObject({ code: "lineIdentityConflict" });
    // A stale or mismatched decision is refused the same way.
    await expect(
      checkinWith({ arrivalId: arrival.id, contact: { id: customerB.id, created: false }, identityDecision: "new" }),
    ).rejects.toMatchObject({ code: "lineIdentityConflict" });

    expect(await prismaUnscoped.repairCase.count({ where: { shopId } })).toBe(cases);
    expect(await prismaUnscoped.caseEvent.count({ where: { shopId } })).toBe(events);
    const row = await prismaUnscoped.arrival.findUniqueOrThrow({ where: { id: arrival.id } });
    expect(row.status).toBe("WAITING");
    expect(row.caseId).toBeNull();
    const still = await prismaUnscoped.lineContact.findUniqueOrThrow({ where: { id: contactLinkedToA.id } });
    expect(still.customerId).toBe(customerA.id);
  });

  it("choosing the linked Customer as the contact is no conflict at all", async () => {
    const arrival = await waitingArrival(LINKED_USER, customerB.phone);
    const caseId = await checkinWith({
      arrivalId: arrival.id,
      contact: { id: customerA.id, created: false },
      identityDecision: null,
    });
    const still = await prismaUnscoped.lineContact.findUniqueOrThrow({ where: { id: contactLinkedToA.id } });
    expect(still.customerId).toBe(customerA.id);
    expect(await prismaUnscoped.caseEvent.count({ where: { caseId } })).toBe(0);
  });

  it("choosing the other person moves the link and says so on the timeline", async () => {
    const arrival = await waitingArrival(LINKED_USER, customerB.phone);
    const caseId = await checkinWith({
      arrivalId: arrival.id,
      contact: { id: customerB.id, created: false },
      identityDecision: customerB.id,
    });
    const moved = await prismaUnscoped.lineContact.findUniqueOrThrow({ where: { id: contactLinkedToA.id } });
    expect(moved.customerId).toBe(customerB.id);
    const events = await prismaUnscoped.caseEvent.findMany({ where: { caseId }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["LINE_CUSTOMER_LINKED"]);
    // Customer A's open cases say the LINE went away. (A has open cases from
    // the earlier consumptions in this suite, all with A as the contact.)
    const aCases = await prismaUnscoped.repairCase.findMany({
      where: { shopId, contactCustomerId: customerA.id, status: { not: "DELIVERED" } },
      select: { id: true },
    });
    expect(aCases.length).toBeGreaterThan(0);
    const unlinked = await prismaUnscoped.caseEvent.findMany({
      where: { shopId, type: "LINE_CUSTOMER_UNLINKED", caseId: { in: aCases.map((c) => c.id) } },
    });
    expect(unlinked.length).toBe(aCases.length);
    // The name is the one the token carried: consumption refreshes it first.
    expect(unlinked[0].subjectName).toBe("From token");
    // Put the fixture back.
    await prismaUnscoped.lineContact.update({
      where: { id: contactLinkedToA.id },
      data: { customerId: customerA.id },
    });
  });

  it("a stale Arrival may still be consumed from a direct link", async () => {
    const arrival = await prismaUnscoped.arrival.create({
      data: {
        shopId,
        name: "เก่ามาก",
        phone: "0810007777",
        plate: "เก่า2",
        note: "x",
        locale: "th",
        submittedAt: new Date(Date.now() - 48 * 3_600_000),
      },
    });
    await checkinWith({ arrivalId: arrival.id, contact: { id: customerB.id, created: false }, identityDecision: null });
    expect((await prismaUnscoped.arrival.findUniqueOrThrow({ where: { id: arrival.id } })).status).toBe("CHECKED_IN");
  });
});
