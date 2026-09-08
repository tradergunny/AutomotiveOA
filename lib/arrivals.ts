import { randomBytes } from "node:crypto";
import type { FlowTx } from "@/lib/case-flow";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { BodyType, Locale } from "@/lib/generated/prisma/enums";
import type { LineIdentity } from "@/lib/line";
import { linkLineContactToCustomer } from "@/lib/line-identity";
import { isValidPhone, normalizePhone, normalizePlate } from "@/lib/normalize";
import type { TenantDb } from "@/lib/tenant";

/**
 * Arrivals (M7.8, ADR-006): the customer's own notice of a visit, submitted
 * from their phone and CONSUMED by check-in. Everything about an Arrival's
 * lifecycle that is not a screen lives here so the public form, the queue,
 * the wizard's consumption, the Settings panel, the staging script and the
 * tests all speak one set of rules:
 *
 * - the form key is 128 random bits, base64url, rotatable (newArrivalToken);
 * - what the customer typed is normalized the way check-in normalizes it
 *   (parseArrivalInput), and a submission creates an Arrival row and
 *   NOTHING else — no Customer, Vehicle or case (createArrival);
 * - the queue is bounded: a Shop refuses new submissions at ARRIVAL_CAP
 *   waiting rows, and a row older than ARRIVAL_STALE_MS is stale — derived
 *   on read (waitingArrivalWhere), never stored, never swept (decision 3);
 * - a LINE identity reaches a row only as a server-verified LineIdentity
 *   (decision 1), and the recognized path reveals the linked Customer's
 *   vehicles and nothing else (recognizeVehicles);
 * - consumption flips the row and links the identity inside the check-in
 *   transaction (consumeArrival), through the same code path the contacts
 *   inbox uses (lib/line-identity.ts), with the one hard stop: an identity
 *   already linked to a different Customer than the advisor's contact.
 */

/** The Shop refuses new Arrivals once this many are waiting (decision 7). */
export const ARRIVAL_CAP = 50;
/** An untouched Arrival drops off the queue after this long (decision 7). */
export const ARRIVAL_STALE_MS = 24 * 60 * 60 * 1000;

export const ARRIVAL_NAME_MAX = 120;
export const ARRIVAL_PLATE_MAX = 20;
export const ARRIVAL_NOTE_MAX = 1000;

const BODY_TYPES = ["SEDAN", "PICKUP"] as const;
const LOCALES = ["th", "en"] as const;

/** 128 random bits, base64url — 22 characters, URL-safe, unguessable. */
export function newArrivalToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Rows submitted before this instant are stale. */
export function arrivalStaleBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - ARRIVAL_STALE_MS);
}

export function isArrivalStale(submittedAt: Date, now: Date = new Date()): boolean {
  return submittedAt.getTime() < arrivalStaleBefore(now).getTime();
}

/** The queue's definition of waiting: status WAITING and not yet stale. */
export function waitingArrivalWhere(now: Date = new Date()): Prisma.ArrivalWhereInput {
  return { status: "WAITING", submittedAt: { gte: arrivalStaleBefore(now) } };
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */

export type ArrivalInputError =
  | "nameRequired"
  | "phoneInvalid"
  | "plateRequired"
  | "bodyTypeRequired"
  | "noteRequired"
  | "vehicleRequired";

export type ArrivalSubmitError =
  | ArrivalInputError
  | "queueFull"
  | "identityRejected"
  | "rateLimited"
  | "failed";

/** Raw strings as the form posted them. */
export type ArrivalRawInput = {
  name: string;
  phone: string;
  plate: string;
  bodyType: string;
  note: string;
  odometer: string;
  locale: string;
};

export type ArrivalDraft = {
  name: string;
  phone: string;
  plate: string;
  bodyType: BodyType;
  note: string;
  odometerKm: number | null;
  locale: Locale;
};

const clean = (value: string, max: number) => value.trim().slice(0, max);

/**
 * The visit part every path shares: what's wrong (required), the odometer
 * (optional) and the form's language. Pure, unit-testable.
 */
function parseVisit(raw: ArrivalRawInput) {
  const note = clean(raw.note, ARRIVAL_NOTE_MAX);
  if (!note) return { ok: false as const, error: "noteRequired" as const };
  const odometerRaw = raw.odometer.replace(/\D/g, "");
  const odometerKm = /^\d{1,7}$/.test(odometerRaw) ? Number(odometerRaw) : null;
  const locale: Locale = (LOCALES as readonly string[]).includes(raw.locale)
    ? (raw.locale as Locale)
    : "th";
  return { ok: true as const, value: { note, odometerKm, locale } };
}

/**
 * The first-time form, exactly these fields (brief §2): name, phone, plate,
 * body type, what's wrong, odometer. Normalized with the check-in
 * normalizers so the wizard's lookups match what the customer meant.
 */
export function parseArrivalInput(
  raw: ArrivalRawInput,
): { ok: true; value: ArrivalDraft } | { ok: false; error: ArrivalInputError } {
  const name = clean(raw.name, ARRIVAL_NAME_MAX);
  if (!name) return { ok: false, error: "nameRequired" };
  const phone = normalizePhone(raw.phone);
  if (!isValidPhone(phone)) return { ok: false, error: "phoneInvalid" };
  const plate = normalizePlate(clean(raw.plate, ARRIVAL_PLATE_MAX));
  if (!plate) return { ok: false, error: "plateRequired" };
  if (!(BODY_TYPES as readonly string[]).includes(raw.bodyType)) {
    return { ok: false, error: "bodyTypeRequired" };
  }
  const visit = parseVisit(raw);
  if (!visit.ok) return visit;
  return {
    ok: true,
    value: { name, phone, plate, bodyType: raw.bodyType as BodyType, ...visit.value },
  };
}

/** What the confirmation screen may echo: only what the customer typed. */
export type ArrivalEcho = {
  name: string | null;
  phone: string | null;
  plate: string;
  bodyType: BodyType | null;
  note: string;
  odometerKm: number | null;
};

/**
 * The linked Customer behind a verified identity, or null — unlinked and
 * unknown userIds are the same answer (brief §3).
 */
async function linkedCustomerFor(db: TenantDb, identity: LineIdentity) {
  const contact = await db.lineContact.findFirst({
    where: { lineUserId: identity.userId, customerId: { not: null } },
    select: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          primaryVehicles: {
            select: { id: true, plate: true, bodyType: true, make: true, model: true, color: true },
            orderBy: { plate: "asc" },
          },
        },
      },
    },
  });
  return contact?.customer ?? null;
}

export type RecognizedVehicle = {
  id: string;
  plate: string;
  bodyType: BodyType;
  /** make · model · colour as one display line, never the raw columns. */
  description: string;
};

/**
 * The recognized LINE path (brief §3): the linked Customer's vehicles ONLY —
 * no name beyond what the ID token itself carries, no history, no cases, no
 * balances. `null` for an unlinked or unknown identity, which then gets the
 * write-only form exactly like the plain door.
 */
export async function recognizeVehicles(
  db: TenantDb,
  identity: LineIdentity,
): Promise<RecognizedVehicle[] | null> {
  const customer = await linkedCustomerFor(db, identity);
  if (!customer) return null;
  return customer.primaryVehicles.map((vehicle) => ({
    id: vehicle.id,
    plate: vehicle.plate,
    bodyType: vehicle.bodyType,
    description: [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" "),
  }));
}

/**
 * Create the Arrival — and nothing else. `identity` is the server-verified
 * LINE identity or null; `vehicleId` is the recognized path's tapped car.
 * When the identity is linked to a Customer, the person fields come from
 * that record (the customer was not asked for them) and the car from the
 * tapped Vehicle, or from the typed plate on "another car".
 */
export async function createArrival(
  db: TenantDb,
  shopId: string,
  input: { raw: ArrivalRawInput; vehicleId: string | null; identity: LineIdentity | null },
  now: Date = new Date(),
): Promise<{ ok: true; id: string; echo: ArrivalEcho } | { ok: false; error: ArrivalSubmitError }> {
  const linked = input.identity ? await linkedCustomerFor(db, input.identity) : null;

  let draft: ArrivalDraft;
  let echo: ArrivalEcho;
  let vehicleId: string | null = null;

  if (linked) {
    const visit = parseVisit(input.raw);
    if (!visit.ok) return visit;
    const chosen = input.vehicleId
      ? linked.primaryVehicles.find((vehicle) => vehicle.id === input.vehicleId)
      : null;
    if (input.vehicleId && !chosen) return { ok: false, error: "vehicleRequired" };
    let plate: string;
    let bodyType: BodyType;
    if (chosen) {
      plate = chosen.plate;
      bodyType = chosen.bodyType;
      vehicleId = chosen.id;
    } else {
      // "Another car": the plate and body type are typed, the person is not.
      plate = normalizePlate(clean(input.raw.plate, ARRIVAL_PLATE_MAX));
      if (!plate) return { ok: false, error: "plateRequired" };
      if (!(BODY_TYPES as readonly string[]).includes(input.raw.bodyType)) {
        return { ok: false, error: "bodyTypeRequired" };
      }
      bodyType = input.raw.bodyType as BodyType;
    }
    draft = { name: linked.name, phone: linked.phone, plate, bodyType, ...visit.value };
    // Nothing about the Customer crosses back — the echo is the visit only.
    echo = {
      name: null,
      phone: null,
      plate,
      bodyType: chosen ? null : bodyType,
      note: draft.note,
      odometerKm: draft.odometerKm,
    };
  } else {
    const parsed = parseArrivalInput(input.raw);
    if (!parsed.ok) return parsed;
    draft = parsed.value;
    echo = {
      name: draft.name,
      phone: draft.phone,
      plate: draft.plate,
      bodyType: draft.bodyType,
      note: draft.note,
      odometerKm: draft.odometerKm,
    };
  }

  // The cap (decision 7): a flood is bounded. Counted at submit; the small
  // race between two simultaneous customers is accepted — it is a courtesy
  // limit, not a security boundary.
  const waiting = await db.arrival.count({ where: waitingArrivalWhere(now) });
  if (waiting >= ARRIVAL_CAP) return { ok: false, error: "queueFull" };

  const created = await db.arrival.create({
    data: {
      shopId,
      ...draft,
      vehicleId,
      lineUserId: input.identity?.userId ?? null,
      lineDisplayName: input.identity?.displayName ?? null,
      linePictureUrl: input.identity?.pictureUrl ?? null,
      submittedAt: now,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id, echo };
}

/* ------------------------------------------------------------------ */
/* The queue                                                           */
/* ------------------------------------------------------------------ */

/** One row of the check-in page's queue strip, and what the wizard pulls in. */
export type ArrivalQueueRow = {
  id: string;
  name: string;
  phone: string;
  plate: string;
  bodyType: BodyType | null;
  note: string;
  odometerKm: number | null;
  submittedAt: string;
  /** Identity came along (verified). */
  line: { displayName: string | null; pictureUrl: string | null } | null;
  /**
   * The Customer this identity is ALREADY linked to, when there is one — the
   * wizard compares it with the phone lookup to detect the hard stop.
   */
  linkedCustomer: { id: string; name: string; phone: string; company: string | null } | null;
};

/** The waiting queue, newest first, with each identity's current link. */
export async function arrivalQueue(db: TenantDb, now: Date = new Date()): Promise<ArrivalQueueRow[]> {
  const rows = await db.arrival.findMany({
    where: waitingArrivalWhere(now),
    orderBy: { submittedAt: "desc" },
    take: ARRIVAL_CAP,
  });
  const userIds = rows.map((row) => row.lineUserId).filter((id): id is string => id != null);
  const contacts =
    userIds.length > 0
      ? await db.lineContact.findMany({
          where: { lineUserId: { in: userIds }, customerId: { not: null } },
          select: {
            lineUserId: true,
            customer: { select: { id: true, name: true, phone: true, company: true } },
          },
        })
      : [];
  const linkedBy = new Map(contacts.map((c) => [c.lineUserId, c.customer]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    plate: row.plate,
    bodyType: row.bodyType,
    note: row.note,
    odometerKm: row.odometerKm,
    submittedAt: row.submittedAt.toISOString(),
    line: row.lineUserId
      ? { displayName: row.lineDisplayName, pictureUrl: row.linePictureUrl }
      : null,
    linkedCustomer: row.lineUserId ? (linkedBy.get(row.lineUserId) ?? null) : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Consumption                                                         */
/* ------------------------------------------------------------------ */

export type ArrivalConsumeErrorCode = "arrivalGone" | "lineIdentityConflict";

export class ArrivalConsumeError extends Error {
  constructor(readonly code: ArrivalConsumeErrorCode) {
    super(`arrival: ${code}`);
    this.name = "ArrivalConsumeError";
  }
}

/**
 * Consume an Arrival inside the check-in transaction (brief §6): flip it to
 * CHECKED_IN pointing at the new case, and when it carries a verified
 * identity, upsert the LineContact (name and picture refreshed from the
 * token) and link it to the contact Customer through the shared path.
 *
 * The hard stop: the identity is already linked to a Customer other than
 * `contact` — the advisor must have chosen, and the choice arrives as
 * `identityDecision`: the chosen Customer's id, or "new" when the choice was
 * the freshly created contact. A missing or mismatched decision throws
 * lineIdentityConflict and the transaction writes nothing.
 *
 * Staleness is not checked here: a stale row opened from a direct link may
 * still be consumed (decision 3). A CHECKED_IN or DISMISSED row refuses.
 */
export async function consumeArrival(
  tx: FlowTx,
  input: {
    shopId: string;
    arrivalId: string;
    caseId: string;
    contact: { id: string; created: boolean };
    staffId: string;
    identityDecision: string | null;
  },
  now: Date = new Date(),
): Promise<{ linkedCaseIds: string[] }> {
  const arrival = await tx.arrival.findUnique({
    where: { id: input.arrivalId },
    select: { id: true, status: true, lineUserId: true, lineDisplayName: true, linePictureUrl: true },
  });
  if (!arrival || arrival.status !== "WAITING") throw new ArrivalConsumeError("arrivalGone");

  await tx.arrival.update({
    where: { id: arrival.id },
    data: {
      status: "CHECKED_IN",
      caseId: input.caseId,
      handledByStaffId: input.staffId,
      handledAt: now,
    },
  });

  if (!arrival.lineUserId) return { linkedCaseIds: [] };

  const contact = await tx.lineContact.upsert({
    where: { shopId_lineUserId: { shopId: input.shopId, lineUserId: arrival.lineUserId } },
    create: {
      shopId: input.shopId,
      lineUserId: arrival.lineUserId,
      displayName: arrival.lineDisplayName,
      pictureUrl: arrival.linePictureUrl,
      firstSeenAt: now,
      lastEventAt: now,
    },
    update: {
      lastEventAt: now,
      ...(arrival.lineDisplayName ? { displayName: arrival.lineDisplayName } : {}),
      ...(arrival.linePictureUrl ? { pictureUrl: arrival.linePictureUrl } : {}),
    },
    select: { id: true, customerId: true },
  });

  if (contact.customerId === input.contact.id) return { linkedCaseIds: [] };

  if (contact.customerId != null) {
    // Linked elsewhere: only an explicit choice moves the link.
    const chosen = input.contact.created ? "new" : input.contact.id;
    if (input.identityDecision !== chosen) throw new ArrivalConsumeError("lineIdentityConflict");
  }

  const result = await linkLineContactToCustomer(tx, {
    shopId: input.shopId,
    contactId: contact.id,
    customerId: input.contact.id,
    actorStaffId: input.staffId,
  });
  return { linkedCaseIds: result.touchedCaseIds };
}
