import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound LINE webhook: signature verification and identity extraction
 * (ADR-005).
 *
 * This is the security boundary of the app's first public write path, so it
 * is deliberately small, pure, and unit-tested: verify the HMAC over the RAW
 * body BEFORE anything parses it, then take only what identity requires.
 *
 * What we take: the sender's userId and a timestamp. What we never take:
 * message CONTENT. Replies live in the Shop's OA chat inbox and are handled
 * by staff there (CONTEXT.md); nothing about them enters this system.
 */

/** LINE signs the raw request body with the channel secret. */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** The only three things we care about — identity, never content. */
export type LineIdentitySignal = {
  lineUserId: string;
  kind: "follow" | "unfollow" | "message";
  at: Date;
};

type RawEvent = {
  type?: unknown;
  timestamp?: unknown;
  source?: { type?: unknown; userId?: unknown };
};

/**
 * Pull identity signals out of a verified webhook body. Events from groups or
 * rooms, event types we don't act on, and anything without a user id are
 * dropped silently — LINE expects a fast 200 either way, and an unknown event
 * type is not an error.
 */
export function extractIdentitySignals(body: unknown): LineIdentitySignal[] {
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];

  const signals: LineIdentitySignal[] = [];
  for (const event of events as RawEvent[]) {
    const kind = event?.type;
    if (kind !== "follow" && kind !== "unfollow" && kind !== "message") continue;
    const source = event?.source;
    if (source?.type !== "user") continue;
    const lineUserId = source?.userId;
    if (typeof lineUserId !== "string" || !lineUserId) continue;
    const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();
    signals.push({ lineUserId, kind, at: new Date(timestamp) });
  }
  return signals;
}

/** The bot's own userId, when LINE includes it. Diagnostics only. */
export function webhookDestination(body: unknown): string | null {
  const destination = (body as { destination?: unknown })?.destination;
  return typeof destination === "string" ? destination : null;
}
