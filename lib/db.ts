import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

// Base Prisma client — module-private on purpose: application code must go
// through the tenant-guarded client (ADR-001). Direct, unscoped access is
// reserved for auth (login is by global email, pre-tenant) and seeds/tests.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

/** Unscoped client. Do not use for tenant-owned data — see forShop() in tenant.ts. */
export const prismaUnscoped = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prismaUnscoped;
}
