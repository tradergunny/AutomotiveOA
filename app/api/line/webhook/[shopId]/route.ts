import { openCredential } from "@/lib/line-credentials";
import { lineTransport } from "@/lib/line";
import { resolveWebhookShop } from "@/lib/line-public";
import { extractIdentitySignals, verifyLineSignature } from "@/lib/line-webhook";

/**
 * The LINE webhook (M6 brief §3, ADR-005) — one of the app's two public
 * routes, and the ONLY way a customer's LINE userId can ever reach us.
 *
 * Order matters and is the whole security story: resolve the Shop from the
 * per-Shop path, decrypt that Shop's channel secret, verify the HMAC over the
 * RAW body — and only then parse. An unknown shop and a bad signature return
 * the same 401, so the endpoint never confirms which shops exist.
 *
 * We take identity and nothing else: userId, event kind, timestamp. Message
 * CONTENT is never read, stored, or displayed — replies belong to the Shop's
 * OA chat inbox (CONTEXT.md).
 */

/** LINE retries on non-2xx, so answer fast and treat unknowns as fine. */
const OK = new Response(null, { status: 200 });
const DENIED = new Response("Unauthorized", { status: 401 });

// Cheap per-shop throttle so unsigned junk can't spend our CPU on decrypt +
// HMAC forever. Per server instance and deliberately crude — the signature
// check is the real boundary, this only blunts a flood.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 600;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

export async function POST(req: Request, ctx: RouteContext<"/api/line/webhook/[shopId]">) {
  const { shopId } = await ctx.params;
  if (rateLimited(shopId)) return new Response("Too many requests", { status: 429 });

  const rawBody = await req.text();
  const channel = await resolveWebhookShop(shopId);
  if (!channel) return DENIED;

  let channelSecret: string;
  try {
    channelSecret = openCredential(shopId, "channelSecret", channel.channelSecretEnc);
  } catch (error) {
    console.error("[line-webhook] channel secret unreadable:", error);
    return DENIED;
  }

  if (!verifyLineSignature(rawBody, req.headers.get("x-line-signature"), channelSecret)) {
    return DENIED;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return OK; // signed but unparseable — nothing to do, and retrying won't help
  }

  const signals = extractIdentitySignals(body);
  if (signals.length === 0) return OK;

  // A profile lookup needs the access token; it is best-effort decoration, so
  // a failure here must never cost us the identity itself.
  let accessToken: string | null = null;
  try {
    accessToken = openCredential(shopId, "channelAccessToken", channel.channelAccessTokenEnc);
  } catch {
    accessToken = null;
  }

  for (const signal of signals) {
    try {
      let displayName: string | null = null;
      let pictureUrl: string | null = null;
      if (signal.kind === "follow" && accessToken) {
        const profile = await lineTransport.getProfile(accessToken, signal.lineUserId);
        if (profile.ok) {
          displayName = profile.value.displayName;
          pictureUrl = profile.value.pictureUrl;
        }
      }

      const followState =
        signal.kind === "follow"
          ? ("FOLLOWING" as const)
          : signal.kind === "unfollow"
            ? ("UNFOLLOWED" as const)
            : undefined;

      // Idempotent on redelivery: the same event twice is the same row.
      await channel.db.lineContact.upsert({
        where: { shopId_lineUserId: { shopId, lineUserId: signal.lineUserId } },
        create: {
          shopId,
          lineUserId: signal.lineUserId,
          displayName,
          pictureUrl,
          followState: followState ?? "FOLLOWING",
          firstSeenAt: signal.at,
          lastEventAt: signal.at,
        },
        update: {
          lastEventAt: signal.at,
          ...(followState ? { followState } : {}),
          ...(displayName ? { displayName } : {}),
          ...(pictureUrl ? { pictureUrl } : {}),
        },
      });
    } catch (error) {
      // One bad signal must not fail the batch; LINE would just redeliver.
      console.error("[line-webhook] could not record identity:", error);
    }
  }

  return OK;
}
