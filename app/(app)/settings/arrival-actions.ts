"use server";

import { revalidatePath } from "next/cache";
import { newArrivalToken } from "@/lib/arrivals";
import { can } from "@/lib/permissions";
import { tenantContext } from "@/lib/session";

/**
 * The Arrivals panel's actions (M7.8 brief §8): the public form's rotatable
 * key on the Shop, and the LINE door's two plain values on the channel.
 * Manager-only to change, read-only for Advisors — the LINE panel's shape.
 * Enabling mints the token; Rotate mints a new one and the old URL dies at
 * once; Disable nulls it, and Arrivals already recorded stay.
 */

export type ArrivalSettingsError =
  | "forbidden"
  | "notConnected"
  | "notEnabled"
  | "liffIdInvalid"
  | "loginChannelIdInvalid"
  | "loginChannelRequired"
  | "failed";

export type ArrivalSettingsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ArrivalSettingsError };

export type ArrivalFormDto = {
  token: string | null;
  rotatedAt: string | null;
};

export type LiffDto = {
  liffId: string | null;
  loginChannelId: string | null;
};

/** LIFF ids look like 1234567890-AbCdEfGh; channel ids are plain digits. */
const LIFF_ID = /^\d{10}-[A-Za-z0-9]{8}$/;
const CHANNEL_ID = /^\d{6,20}$/;

async function manager() {
  const ctx = await tenantContext();
  if (!can(ctx.session.role, "line.manageChannel")) return null;
  return ctx;
}

export async function enableArrivalForm(): Promise<ArrivalSettingsResult<ArrivalFormDto>> {
  try {
    const ctx = await manager();
    if (!ctx) return { ok: false, error: "forbidden" };
    const shop = await ctx.db.shop.update({
      where: { id: ctx.session.shopId },
      data: { arrivalToken: newArrivalToken() },
      select: { arrivalToken: true, arrivalTokenRotatedAt: true },
    });
    revalidatePath("/settings");
    return {
      ok: true,
      value: { token: shop.arrivalToken, rotatedAt: shop.arrivalTokenRotatedAt?.toISOString() ?? null },
    };
  } catch (error) {
    console.error("[arrival-settings] enable failed:", error);
    return { ok: false, error: "failed" };
  }
}

export async function rotateArrivalLink(): Promise<ArrivalSettingsResult<ArrivalFormDto>> {
  try {
    const ctx = await manager();
    if (!ctx) return { ok: false, error: "forbidden" };
    const current = await ctx.db.shop.findUnique({
      where: { id: ctx.session.shopId },
      select: { arrivalToken: true },
    });
    if (!current?.arrivalToken) return { ok: false, error: "notEnabled" };
    const shop = await ctx.db.shop.update({
      where: { id: ctx.session.shopId },
      data: { arrivalToken: newArrivalToken(), arrivalTokenRotatedAt: new Date() },
      select: { arrivalToken: true, arrivalTokenRotatedAt: true },
    });
    revalidatePath("/settings");
    return {
      ok: true,
      value: { token: shop.arrivalToken, rotatedAt: shop.arrivalTokenRotatedAt?.toISOString() ?? null },
    };
  } catch (error) {
    console.error("[arrival-settings] rotate failed:", error);
    return { ok: false, error: "failed" };
  }
}

export async function disableArrivalForm(): Promise<ArrivalSettingsResult<ArrivalFormDto>> {
  try {
    const ctx = await manager();
    if (!ctx) return { ok: false, error: "forbidden" };
    await ctx.db.shop.update({
      where: { id: ctx.session.shopId },
      data: { arrivalToken: null },
    });
    revalidatePath("/settings");
    return { ok: true, value: { token: null, rotatedAt: null } };
  } catch (error) {
    console.error("[arrival-settings] disable failed:", error);
    return { ok: false, error: "failed" };
  }
}

/**
 * The LINE door's two plain values. Both or neither: a LIFF app whose ID
 * tokens cannot be verified would let the page load LIFF and then refuse
 * every submission, so a LIFF ID without a Login channel ID is rejected.
 * Empty fields clear both, which simply closes the LINE door.
 */
export async function saveLiffSettings(formData: FormData): Promise<ArrivalSettingsResult<LiffDto>> {
  try {
    const ctx = await manager();
    if (!ctx) return { ok: false, error: "forbidden" };

    const liffId = String(formData.get("liffId") ?? "").trim();
    const loginChannelId = String(formData.get("loginChannelId") ?? "").trim();
    if (liffId && !LIFF_ID.test(liffId)) return { ok: false, error: "liffIdInvalid" };
    if (loginChannelId && !CHANNEL_ID.test(loginChannelId)) {
      return { ok: false, error: "loginChannelIdInvalid" };
    }
    if (liffId && !loginChannelId) return { ok: false, error: "loginChannelRequired" };

    const channel = await ctx.db.shopLineChannel.findUnique({ where: { shopId: ctx.session.shopId } });
    if (!channel) return { ok: false, error: "notConnected" };

    const updated = await ctx.db.shopLineChannel.update({
      where: { shopId: ctx.session.shopId },
      data: { liffId: liffId || null, loginChannelId: loginChannelId || null },
      select: { liffId: true, loginChannelId: true },
    });
    revalidatePath("/settings");
    return { ok: true, value: updated };
  } catch (error) {
    console.error("[arrival-settings] liff save failed:", error);
    return { ok: false, error: "failed" };
  }
}
