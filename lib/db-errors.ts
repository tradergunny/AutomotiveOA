import { Prisma } from "@/lib/generated/prisma/client";

/** True when the error is a unique-constraint violation (Prisma P2002). */
export function isUniqueViolation(error: unknown, column?: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  if (!column) return true;
  // P2002 meta.target: violated columns (string[]) or constraint name.
  const target = error.meta?.target;
  const named = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return named.includes(column);
}
