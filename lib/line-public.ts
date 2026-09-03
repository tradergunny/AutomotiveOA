import { prismaUnscoped } from "@/lib/db";
import { forShop, type TenantDb } from "@/lib/tenant";

/**
 * Tenant resolution for the app's unauthenticated routes: the LINE webhook
 * and the published-photo route (M6), and the published-quotation page
 * (M7.7). All are reached by LINE's servers or by a customer's phone, so
 * there is no session to scope by.
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

/**
 * A published Quotation, by its document token (M7.7, D-25) — the
 * published-photo idiom applied to the document. The token is minted the
 * first time the version is sent, so holding one proves a human pressed
 * send; it is revocable by nulling the column, and an unknown or revoked
 * token is indistinguishable from a wrong guess. Everything the always-light
 * document renders comes back here, read through the guard.
 */
export async function resolvePublishedQuotation(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const published = await prismaUnscoped.quotation.findUnique({
    where: { publicToken: token },
    select: { shopId: true, id: true },
  });
  if (!published) return null;

  return forShop(published.shopId).quotation.findUnique({
    where: { id: published.id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      issuedBy: { select: { name: true } },
      repairCase: {
        include: {
          vehicle: true,
          contactCustomer: true,
          shop: { select: { name: true } },
        },
      },
    },
  });
}
