import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { forShop } from "@/lib/tenant";

/** The logged-in user's session, or a redirect to /login. Cached per request. */
export const requireSession = cache(async () => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.shopId) redirect("/login");
  return {
    userId: user.id,
    shopId: user.shopId,
    role: user.role,
    name: user.name ?? "",
    email: user.email ?? "",
  };
});

/** Tenant-guarded database client for the logged-in user's Shop (ADR-001). */
export async function tenantDb() {
  const session = await requireSession();
  return forShop(session.shopId);
}

/**
 * Session + tenant client together — for server actions that also need
 * session facts (e.g. shopId on creates, which Prisma's input types require;
 * the guard verifies it matches the scope either way).
 */
export async function tenantContext() {
  const session = await requireSession();
  return { session, db: forShop(session.shopId) };
}
