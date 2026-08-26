"use server";

import { revalidatePath } from "next/cache";
import { allocateCaseReference } from "@/lib/case-reference";
import { isUniqueViolation } from "@/lib/db-errors";
import type { BodyType } from "@/lib/generated/prisma/enums";
import { isValidPhone, normalizePhone, normalizePlate } from "@/lib/normalize";
import { tenantContext } from "@/lib/session";
import { newPhotoKey, photoStore } from "@/lib/storage";

// Check-in (M2 brief §4): phone lookup decides existing-vs-new for the person
// at the desk; vehicle by plate; ownership kept or re-linked; one atomic
// transaction opens the Repair Case. Lookups return only what the wizard
// renders — never raw rows.
//
// Walkaround photos upload AFTER the case commits, one request each via
// addCasePhoto (the M3 finding-photo pattern) — a whole walkaround in one
// multipart body blows Vercel's ~4.5 MB serverless request cap. The case
// itself stays atomic; photos are best-effort attachments the wizard
// retries before navigating.

const BODY_TYPES = ["SEDAN", "PICKUP"] as const;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTOS = 20;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type LookupCustomer = {
  id: string;
  name: string;
  phone: string;
  company: string | null;
};

export type LookupVehicle = {
  id: string;
  plate: string;
  province: string | null;
  bodyType: BodyType;
  make: string | null;
  model: string | null;
  color: string | null;
  primaryCustomer: LookupCustomer;
};

export async function lookupCheckinCustomer(
  phoneRaw: string,
): Promise<{ customer: LookupCustomer | null }> {
  const { db } = await tenantContext();
  const phone = normalizePhone(phoneRaw);
  if (!isValidPhone(phone)) return { customer: null };

  const customer = await db.customer.findFirst({
    where: { phone },
    select: { id: true, name: true, phone: true, company: true },
  });
  return { customer };
}

export async function lookupCheckinVehicle(
  plateRaw: string,
): Promise<{ vehicle: LookupVehicle | null }> {
  const { db } = await tenantContext();
  const plate = normalizePlate(plateRaw);
  if (!plate) return { vehicle: null };

  const vehicle = await db.vehicle.findFirst({
    where: { plate },
    select: {
      id: true,
      plate: true,
      province: true,
      bodyType: true,
      make: true,
      model: true,
      color: true,
      primaryCustomer: {
        select: { id: true, name: true, phone: true, company: true },
      },
    },
  });
  return { vehicle };
}

export type CheckinState = {
  /** Set on success — the wizard uploads photos to it, then navigates. */
  caseId?: string;
  error?:
    | "contactRequired"
    | "nameRequired"
    | "phoneInvalid"
    | "phoneTaken"
    | "vehicleRequired"
    | "plateRequired"
    | "plateTaken"
    | "bodyTypeRequired"
    | "photoInvalid"
    | "photoTooLarge"
    | "failed";
};

export async function performCheckin(
  _prev: CheckinState,
  formData: FormData,
): Promise<CheckinState> {
  const { session, db } = await tenantContext();
  const text = (key: string) => String(formData.get(key) ?? "").trim();

  // Contact: an existing customer id from the lookup, or new-customer fields.
  const contactCustomerId = text("contactCustomerId");
  const newContact = {
    name: text("name"),
    phone: normalizePhone(text("phone")),
    company: text("company") || null,
  };
  if (!contactCustomerId) {
    if (!newContact.name) return { error: "nameRequired" };
    if (!isValidPhone(newContact.phone)) return { error: "phoneInvalid" };
  }

  // Vehicle: an existing vehicle id from the lookup, or new-vehicle fields.
  const vehicleId = text("vehicleId");
  const relink = text("ownership") === "relink";
  const newVehicle = {
    plate: normalizePlate(text("plate")),
    province: text("province") || null,
    vin: null,
    bodyType: text("bodyType"),
    make: text("make") || null,
    model: text("model") || null,
    color: text("color") || null,
  };
  if (!vehicleId) {
    if (!newVehicle.plate) return { error: "plateRequired" };
    if (!BODY_TYPES.includes(newVehicle.bodyType as BodyType)) {
      return { error: "bodyTypeRequired" };
    }
  }

  const note = text("note") || null;
  const odometerRaw = text("odometer").replace(/\D/g, "");
  const odometerKm = /^\d{1,7}$/.test(odometerRaw) ? Number(odometerRaw) : null;

  let caseId: string;
  try {
    // All-or-nothing: customer, vehicle, ownership, reference, and case
    // commit together — a failure saves nothing. Photos follow one-by-one
    // through addCasePhoto once the case exists.
    caseId = await db.$transaction(
      async (tx) => {
        let contactId = contactCustomerId;
        if (!contactId) {
          const created = await tx.customer.create({
            data: { shopId: session.shopId, ...newContact },
            select: { id: true },
          });
          contactId = created.id;
        } else {
          const existing = await tx.customer.findUnique({
            where: { id: contactId },
            select: { id: true },
          });
          if (!existing) throw new CheckinInputError("contactRequired");
        }

        let resolvedVehicleId = vehicleId;
        if (!resolvedVehicleId) {
          const created = await tx.vehicle.create({
            data: {
              shopId: session.shopId,
              ...newVehicle,
              bodyType: newVehicle.bodyType as BodyType,
              primaryCustomerId: contactId,
            },
            select: { id: true },
          });
          resolvedVehicleId = created.id;
        } else {
          const existing = await tx.vehicle.findUnique({
            where: { id: resolvedVehicleId },
            select: { id: true, primaryCustomerId: true },
          });
          if (!existing) throw new CheckinInputError("vehicleRequired");
          // CONTEXT.md: when a car changes hands, staff re-link the primary
          // Customer at check-in.
          if (relink && existing.primaryCustomerId !== contactId) {
            await tx.vehicle.update({
              where: { id: existing.id },
              data: { primaryCustomerId: contactId },
            });
          }
        }

        const reference = await allocateCaseReference(tx, session.shopId);
        const repairCase = await tx.repairCase.create({
          data: {
            shopId: session.shopId,
            reference,
            vehicleId: resolvedVehicleId,
            contactCustomerId: contactId,
            note,
            odometerKm,
            openedByStaffId: session.staffId,
          },
          select: { id: true },
        });

        return repairCase.id;
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (error instanceof CheckinInputError) return { error: error.code };
    // Advisor typed a phone/plate that exists instead of using the lookup.
    if (isUniqueViolation(error, "phone")) return { error: "phoneTaken" };
    if (isUniqueViolation(error, "plate")) return { error: "plateTaken" };
    console.error("[checkin] failed:", error);
    return { error: "failed" };
  }

  revalidatePath("/");
  revalidatePath("/customers");
  return { caseId };
}

/**
 * One walkaround photo (client-downscaled) onto an open case — the wizard
 * calls this once per shot after performCheckin returns the caseId.
 */
export async function addCasePhoto(
  caseId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: "photoInvalid" | "photoTooLarge" | "failed" }> {
  try {
    const { session, db } = await tenantContext();
    const repairCase = await db.repairCase.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        status: true,
        _count: { select: { photos: { where: { findingId: null } } } },
      },
    });
    if (!repairCase || repairCase.status === "DELIVERED") return { ok: false, error: "failed" };
    if (repairCase._count.photos >= MAX_PHOTOS) return { ok: false, error: "failed" };

    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0 || !PHOTO_TYPES.has(file.type)) {
      return { ok: false, error: "photoInvalid" };
    }
    if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "photoTooLarge" };
    const bytes = new Uint8Array(await file.arrayBuffer());

    const storageKey = newPhotoKey(session.shopId, caseId, file.type);
    await photoStore.put(storageKey, bytes, file.type);
    await db.photo.create({
      data: {
        shopId: session.shopId,
        caseId,
        storageKey,
        contentType: file.type,
        sizeBytes: bytes.byteLength,
        uploadedByStaffId: session.staffId,
      },
    });
    revalidatePath(`/cases/${caseId}`);
    return { ok: true };
  } catch (error) {
    console.error("[checkin] photo failed:", error);
    return { ok: false, error: "failed" };
  }
}

class CheckinInputError extends Error {
  constructor(readonly code: NonNullable<CheckinState["error"]>) {
    super(`checkin input: ${code}`);
  }
}
