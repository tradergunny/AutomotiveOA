import { prismaUnscoped } from "@/lib/db";
import { forShop, type TenantDb } from "@/lib/tenant";

/**
 * Tenant resolution for the app's unauthenticated routes: the LINE webhook
 * and the published-photo route (M6), the published-quotation page (M7.7),
 * and the public Arrival form (M7.8). All are reached by LINE's servers or
 * by a customer's phone, so there is no session to scope by.
 *
 * The rule they all follow, and the reason they are in one small file where
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

/**
 * The Shop behind a public Arrival form (M7.8, ADR-006), by its rotatable
 * form token — the published-quotation idiom applied to the app's second
 * public WRITE path. The token is minted from Settings, replaced by Rotate
 * (the old poster dies at once), nulled by Disable; an unknown or rotated
 * token is a plain 404, indistinguishable from a wrong guess. Nothing about
 * the Shop crosses beyond its name, which the form prints. The LINE door's
 * two plain values ride along so the page knows whether to load LIFF.
 */
export async function resolveArrivalShop(token: string): Promise<{
  shopId: string;
  shopName: string;
  liffId: string | null;
  loginChannelId: string | null;
  db: TenantDb;
} | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const shop = await prismaUnscoped.shop.findUnique({
    where: { arrivalToken: token },
    select: { id: true, name: true },
  });
  if (!shop) return null;

  const db = forShop(shop.id);
  const channel = await db.shopLineChannel.findUnique({
    where: { shopId: shop.id },
    select: { liffId: true, loginChannelId: true },
  });
  return {
    shopId: shop.id,
    shopName: shop.name,
    liffId: channel?.liffId ?? null,
    loginChannelId: channel?.loginChannelId ?? null,
    db,
  };
}
