"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUniqueViolation } from "@/lib/db-errors";
import type { BodyType } from "@/lib/generated/prisma/enums";
import { normalizePlate } from "@/lib/normalize";
import { tenantContext, tenantDb } from "@/lib/session";

const BODY_TYPES = ["SEDAN", "PICKUP"] as const;

export type VehicleFormValues = {
  plate: string;
  province: string;
  vin: string;
  bodyType: string;
  make: string;
  model: string;
  color: string;
  primaryCustomerId: string;
};

export type VehicleFormState = {
  error?: "plateRequired" | "plateTaken" | "bodyTypeRequired" | "customerMissing";
  values?: VehicleFormValues;
};

function readForm(formData: FormData): VehicleFormValues {
  return {
    plate: String(formData.get("plate") ?? "").trim(),
    province: String(formData.get("province") ?? "").trim(),
    vin: String(formData.get("vin") ?? "").trim(),
    bodyType: String(formData.get("bodyType") ?? ""),
    make: String(formData.get("make") ?? "").trim(),
    model: String(formData.get("model") ?? "").trim(),
    color: String(formData.get("color") ?? "").trim(),
    primaryCustomerId: String(formData.get("primaryCustomerId") ?? ""),
  };
}

function validate(values: VehicleFormValues): VehicleFormState | null {
  if (!normalizePlate(values.plate)) return { error: "plateRequired", values };
  if (!BODY_TYPES.includes(values.bodyType as BodyType)) {
    return { error: "bodyTypeRequired", values };
  }
  return null;
}

function toData(values: VehicleFormValues) {
  return {
    plate: normalizePlate(values.plate),
    province: values.province || null,
    vin: values.vin || null,
    bodyType: values.bodyType as BodyType,
    make: values.make || null,
    model: values.model || null,
    color: values.color || null,
  };
}

export async function createVehicle(
  customerId: string,
  _prev: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const { session, db } = await tenantContext();
  const values = readForm(formData);
  const invalid = validate(values);
  if (invalid) return invalid;

  // The tenant guard nulls another shop's customer — clean error, and the
  // composite FK would refuse the row anyway (defense in depth).
  const owner = await db.customer.findUnique({ where: { id: customerId } });
  if (!owner) return { error: "customerMissing", values };

  try {
    await db.vehicle.create({
      data: { ...toData(values), shopId: session.shopId, primaryCustomerId: owner.id },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "plateTaken", values };
    throw error;
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${owner.id}`);
  redirect(`/customers/${owner.id}`);
}

export async function updateVehicle(
  vehicleId: string,
  _prev: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const db = await tenantDb();
  const values = readForm(formData);
  const invalid = validate(values);
  if (invalid) return invalid;

  // Primary re-link (CONTEXT.md: ownership changes are re-linked by staff):
  // the new primary must be a customer of this shop.
  const owner = await db.customer.findUnique({ where: { id: values.primaryCustomerId } });
  if (!owner) return { error: "customerMissing", values };

  try {
    // Plate edits happen IN PLACE — same row, history stays (CONTEXT.md).
    await db.vehicle.update({
      where: { id: vehicleId },
      data: { ...toData(values), primaryCustomerId: owner.id },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "plateTaken", values };
    throw error;
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${owner.id}`);
  redirect(`/customers/${owner.id}`);
}
