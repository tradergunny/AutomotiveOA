"use server";

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { prismaUnscoped } from "@/lib/db";
import { LOCALE_COOKIE } from "@/i18n/config";

export type LoginState = { error?: "invalid" };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return { error: "invalid" };
    throw error;
  }

  // Per-User locale: the UI comes up in the language this user saved.
  const user = await prismaUnscoped.user.findUnique({
    where: { email },
    select: { locale: true },
  });
  if (user) {
    const store = await cookies();
    store.set(LOCALE_COOKIE, user.locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  redirect("/");
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
