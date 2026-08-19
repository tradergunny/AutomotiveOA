import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prismaUnscoped } from "@/lib/db";
import type { UserRole } from "@/lib/generated/prisma/enums";

// Login is by globally-unique email and therefore pre-tenant: this is one of
// the two sanctioned uses of the unscoped client (see lib/db.ts). Everything
// after login carries shopId in the session and goes through forShop().

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const user = await prismaUnscoped.user.findUnique({
          where: { email },
          include: { staff: true },
        });
        if (!user || !user.active) return null;

        const passwordOk = await bcrypt.compare(password, user.passwordHash);
        if (!passwordOk) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.staff.name,
          role: user.role,
          shopId: user.shopId,
          locale: user.locale,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = user.role;
        token.shopId = user.shopId;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.role = token.role as UserRole;
      session.user.shopId = token.shopId as string;
      return session;
    },
  },
});
