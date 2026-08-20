"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUniqueViolation } from "@/lib/db-errors";
import { isValidPhone, normalizePhone } from "@/lib/normalize";
import { tenantContext, tenantDb } from "@/lib/session";

export type CustomerFormValues = {
  name: string;
  phone: string;
  company: string;
  note: string;
};

export type CustomerFormState = {
  error?: "nameRequired" | "phoneInvalid" | "phoneTaken";
  values?: CustomerFormValues;
};

function readForm(formData: FormData): CustomerFormValues {
  return {
    name: String(formData.get("name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    company: String(formData.get("company") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim(),
  };
}

function validate(values: CustomerFormValues): CustomerFormState | null {
  if (!values.name) return { error: "nameRequired", values };
  if (!isValidPhone(normalizePhone(values.phone))) {
    return { error: "phoneInvalid", values };
  }
  return null;
}

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const { session, db } = await tenantContext();
  const values = readForm(formData);
  const invalid = validate(values);
  if (invalid) return invalid;

  let id: string;
  try {
    const customer = await db.customer.create({
      data: {
        shopId: session.shopId,
        name: values.name,
        phone: normalizePhone(values.phone),
        company: values.company || null,
        note: values.note || null,
      },
    });
    id = customer.id;
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "phoneTaken", values };
    throw error;
  }

  revalidatePath("/customers");
  redirect(`/customers/${id}`);
}

export async function updateCustomer(
  customerId: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const db = await tenantDb();
  const values = readForm(formData);
  const invalid = validate(values);
  if (invalid) return invalid;

  try {
    // The tenant guard pre-checks ownership: another shop's id throws.
    await db.customer.update({
      where: { id: customerId },
      data: {
        name: values.name,
        phone: normalizePhone(values.phone),
        company: values.company || null,
        note: values.note || null,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "phoneTaken", values };
    throw error;
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}
