import { prismaUnscoped } from "@/lib/db";
import { forShop, type TenantDb } from "@/lib/tenant";

/**
 * Tenant resolution for the app's only two unauthenticated routes (M6): the
 * LINE webhook and the published-photo route. Both are reached by LINE's
 * servers or by a customer's phone, so there is no session to scope by.
 *
 * The rule these two follow, and the reason they are in one small file where
 * it can be read at a glance: perform exactly ONE unscoped read to establish
 * which Shop the request belongs to, then hand back a normal forShop() client
 * and do everything else through the guard (ADR-001).
 */

/**
 * The webhook's shop comes from its own per-Shop URL (ADR-005). The shopId is
 * not a secret and confers nothing on its own — the caller MUST verify the
 * request signature against the returned channel secret before acting, and a
 * missing channel is indistinguishable from an unknown shop to the caller.
 */
export async function resolveWebhookShop(shopId: string): Promise<{
  shopId: string;
  channelSecretEnc: string;
  channelAccessTokenEnc: string;
  db: TenantDb;
} | null> {
  const channel = await prismaUnscoped.shopLineChannel.findUnique({
    where: { shopId },
    select: { shopId: true, channelSecretEnc: true, channelAccessTokenEnc: true },
  });
  if (!channel) return null;
  return { ...channel, db: forShop(channel.shopId) };
}

/**
 * A published photo, by its capability token (M6 brief, decision 3). The
 * token is the whole authorization: 128 random bits minted only when a human
 * pressed send, revocable by nulling the column. Nothing else about the case,
 * customer, or shop is exposed by holding one.
 */
export async function resolvePublishedPhoto(token: string): Promise<{
  storageKey: string;
  contentType: string;
} | null> {
  const published = await prismaUnscoped.lineUpdatePhoto.findUnique({
    where: { publicToken: token },
    select: { shopId: true, photoId: true },
  });
  if (!published) return null;

  // Back through the guard for the actual row, scoped to the owning shop.
  const photo = await forShop(published.shopId).photo.findUnique({
    where: { id: published.photoId },
    select: { storageKey: true, contentType: true },
  });
  return photo ?? null;
}
