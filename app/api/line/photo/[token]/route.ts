import { resolvePublishedPhoto } from "@/lib/line-public";
import { photoStore } from "@/lib/storage";

/**
 * Published-photo delivery (M6 brief §8, decision 3) — the app's second and
 * last public route, and the single deliberate exception to lib/storage.ts's
 * "bytes only leave through the authenticated route".
 *
 * It exists because LINE's own servers fetch image URLs; a session-protected
 * URL would hand them a 401 and the customer a broken message. The token IS
 * the authorization: 128 random bits, minted only when a human attached the
 * photo to an Update and pressed send, revocable by nulling the column. It
 * carries no case, customer, or shop identifier, and an unknown or revoked
 * token is indistinguishable from a wrong guess.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/line/photo/[token]">) {
  const { token } = await ctx.params;

  const photo = await resolvePublishedPhoto(token);
  if (!photo) {
    return new Response("Not found", { status: 404 });
  }

  const data = await photoStore.get(photo.storageKey);
  if (!data) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(data, {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(data.byteLength),
      // Bytes are immutable per key; LINE and the customer's phone may cache.
      "Cache-Control": "public, max-age=31536000, immutable",
      // Nothing here should be indexed or sniffed into something else.
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
