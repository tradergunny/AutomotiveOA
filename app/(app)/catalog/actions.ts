"use server";

import { revalidatePath } from "next/cache";
import { bahtToSatang } from "@/lib/money";
import { can } from "@/lib/permissions";
import { tenantContext } from "@/lib/session";

// Service Catalog maintenance (M4 brief §2) — Manager-only, server-enforced:
// CONTEXT.md has the catalog "maintained per Shop by its Manager". Entries
// deactivate, never delete (Jobs reference them). Names are shop-authored
// tenant data, not i18n copy.

export type CatalogItemDto = {
  id: string;
  name: string;
  priceSatang: number;
  active: boolean;
  note: string | null;
};

export type CatalogError = "forbidden" | "nameRequired" | "priceInvalid" | "missing" | "failed";

export type CatalogResult =
  | { ok: true; value: CatalogItemDto }
  | { ok: false; error: CatalogError };

const MAX_NAME_LENGTH = 200;
const MAX_NOTE_LENGTH = 1000;

type ItemInput = { name: string; priceSatang: number; note: string | null };

function parseItemInput(formData: FormData): ItemInput | { error: CatalogError } {
  const name = String(formData.get("name") ?? "").trim().slice(0, MAX_NAME_LENGTH);
  if (!name) return { error: "nameRequired" };
  const priceSatang = bahtToSatang(String(formData.get("price") ?? ""));
  if (priceSatang == null) return { error: "priceInvalid" };
  const note = String(formData.get("note") ?? "").trim().slice(0, MAX_NOTE_LENGTH);
  return { name, priceSatang, note: note || null };
}

function toDto(row: {
  id: string;
  name: string;
  priceSatang: number;
  active: boolean;
  note: string | null;
}): CatalogItemDto {
  return {
    id: row.id,
    name: row.name,
    priceSatang: row.priceSatang,
    active: row.active,
    note: row.note,
  };
}

export async function createCatalogItem(formData: FormData): Promise<CatalogResult> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "catalog.manage")) return { ok: false, error: "forbidden" };
    const input = parseItemInput(formData);
    if ("error" in input) return { ok: false, error: input.error };

    const item = await db.serviceCatalogItem.create({
      data: { shopId: session.shopId, ...input },
    });
    revalidatePath("/catalog");
    return { ok: true, value: toDto(item) };
  } catch (error) {
    console.error("[catalog] create failed:", error);
    return { ok: false, error: "failed" };
  }
}

export async function updateCatalogItem(
  itemId: string,
  formData: FormData,
): Promise<CatalogResult> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "catalog.manage")) return { ok: false, error: "forbidden" };
    const input = parseItemInput(formData);
    if ("error" in input) return { ok: false, error: input.error };

    const item = await db.serviceCatalogItem.update({
      where: { id: itemId },
      data: input,
    });
    revalidatePath("/catalog");
    return { ok: true, value: toDto(item) };
  } catch (error) {
    console.error("[catalog] update failed:", error);
    return { ok: false, error: "failed" };
  }
}

/** Deactivate / reactivate — never delete (Jobs reference entries). */
export async function setCatalogItemActive(
  itemId: string,
  active: boolean,
): Promise<CatalogResult> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "catalog.manage")) return { ok: false, error: "forbidden" };
    const item = await db.serviceCatalogItem.update({
      where: { id: itemId },
      data: { active },
    });
    revalidatePath("/catalog");
    return { ok: true, value: toDto(item) };
  } catch (error) {
    console.error("[catalog] toggle failed:", error);
    return { ok: false, error: "failed" };
  }
}
