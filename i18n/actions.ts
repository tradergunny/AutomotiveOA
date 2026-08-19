"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { forShop } from "@/lib/tenant";
import { isLocale, LOCALE_COOKIE } from "./config";

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  // Per-User locale (DESIGN.md): a logged-in user's choice sticks to their account.
  const session = await auth();
  if (session?.user?.id && session.user.shopId) {
    await forShop(session.user.shopId).user.update({
      where: { id: session.user.id },
      data: { locale },
    });
  }

  revalidatePath("/", "layout");
}
