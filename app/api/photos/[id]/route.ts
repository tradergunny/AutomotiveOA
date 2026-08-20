import { auth } from "@/auth";
import { photoStore } from "@/lib/storage";
import { forShop } from "@/lib/tenant";

/**
 * The ONLY way photo bytes reach a browser (M2 brief §5): session required,
 * then the tenant guard resolves the Photo row — a photo id from another
 * Shop comes back null and 404s. Bytes are immutable per key, so browsers
 * may cache privately forever.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/photos/[id]">) {
  const session = await auth();
  if (!session?.user?.shopId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const photo = await forShop(session.user.shopId).photo.findUnique({ where: { id } });
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
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
