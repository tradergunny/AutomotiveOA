import type { DefaultSession } from "next-auth";
import type { Locale, UserRole } from "@/lib/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      shopId: string;
      staffId: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    shopId: string;
    staffId: string;
    locale: Locale;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: UserRole;
    shopId?: string;
    staffId?: string;
  }
}
