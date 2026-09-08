"use server";

import { headers } from "next/headers";
import {
  createArrival,
  recognizeVehicles,
  type ArrivalEcho,
  type ArrivalRawInput,
  type ArrivalSubmitError,
  type RecognizedVehicle,
} from "@/lib/arrivals";
import { lineTransport, type LineIdentity } from "@/lib/line";
import { resolveArrivalShop } from "@/lib/line-public";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * The public Arrival form's two server calls (M7.8 brief §2–§3). Both start
 * the same way: resolve the Shop from the form token (one unscoped read,
 * lib/line-public.ts), then work through the guard. Both are WRITE-ONLY
 * toward the customer: nothing about the Shop's customers crosses back,
 * except — on the LINE door, for a verified identity already linked to a
 * Customer — that Customer's vehicles.
 *
 * Identity (decision 1): the client sends the LIFF ID token, never a userId.
 * The server verifies the token against the Shop's Login channel and takes
 * `sub`. A body-supplied userId has no field to land in and is ignored.
 *
 * A per-source rate limit (the webhook's map idiom) sits in front of both:
 * keyed by token plus client address, a few per minute. It blunts a flood;
 * the token, the cap and the write-only rule are the boundary.
 */

const submitLimited = createRateLimiter({ windowMs: 60_000, max: 6 });
const recognizeLimited = createRateLimiter({ windowMs: 60_000, max: 20 });
const MAX_ID_TOKEN_LENGTH = 4000;

async function clientKey(token: string): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "local";
  return `${token}:${address}`;
}

/**
 * Verify an ID token for this Shop. In the live driver the Shop must have a
 * Login channel id (the token's audience); the fake driver takes `dev:U…`
 * without one (decision 4). A token that does not verify is refused rather
 * than silently downgraded — the customer expected their LINE to come along.
 */
async function verifyIdentity(
  idToken: string,
  loginChannelId: string | null,
): Promise<LineIdentity | null> {
  if (idToken.length > MAX_ID_TOKEN_LENGTH) return null;
  if (lineTransport.mode === "live" && !loginChannelId) return null;
  const verified = await lineTransport.verifyIdToken(idToken, loginChannelId ?? "");
  return verified.ok ? verified.value : null;
}

export type SubmitArrivalResult =
  | { ok: true; echo: ArrivalEcho }
  | { ok: false; error: ArrivalSubmitError | "notFound" };

export async function submitArrival(token: string, formData: FormData): Promise<SubmitArrivalResult> {
  try {
    if (submitLimited(await clientKey(token))) return { ok: false, error: "rateLimited" };
    const shop = await resolveArrivalShop(token);
    if (!shop) return { ok: false, error: "notFound" };

    const text = (key: string) => String(formData.get(key) ?? "");
    const raw: ArrivalRawInput = {
      name: text("name"),
      phone: text("phone"),
      plate: text("plate"),
      bodyType: text("bodyType"),
      note: text("note"),
      odometer: text("odometer"),
      locale: text("locale"),
    };

    const idToken = text("idToken").trim();
    let identity: LineIdentity | null = null;
    if (idToken) {
      identity = await verifyIdentity(idToken, shop.loginChannelId);
      if (!identity) return { ok: false, error: "identityRejected" };
    }

    const result = await createArrival(shop.db, shop.shopId, {
      raw,
      vehicleId: text("vehicleId").trim() || null,
      identity,
    });
    if (!result.ok) return result;
    return { ok: true, echo: result.echo };
  } catch (error) {
    console.error("[arrival] submit failed:", error);
    return { ok: false, error: "failed" };
  }
}

export type RecognizeArrivalResult =
  | { ok: true; vehicles: RecognizedVehicle[] | null }
  | { ok: false; error: "identityRejected" | "rateLimited" | "notFound" | "failed" };

/**
 * The LINE door's recognition (brief §3): the linked Customer's vehicles
 * only, or null for an unlinked or unknown identity — which then gets the
 * write-only form exactly like the plain door.
 */
export async function recognizeArrival(token: string, idToken: string): Promise<RecognizeArrivalResult> {
  try {
    if (recognizeLimited(await clientKey(token))) return { ok: false, error: "rateLimited" };
    const shop = await resolveArrivalShop(token);
    if (!shop) return { ok: false, error: "notFound" };

    const identity = await verifyIdentity(idToken.trim(), shop.loginChannelId);
    if (!identity) return { ok: false, error: "identityRejected" };

    return { ok: true, vehicles: await recognizeVehicles(shop.db, identity) };
  } catch (error) {
    console.error("[arrival] recognize failed:", error);
    return { ok: false, error: "failed" };
  }
}
