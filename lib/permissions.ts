import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * Permission checks (CONTEXT.md: the only special rules in MVP are the
 * Manager ones). The features arrive later — Service Catalog price override
 * in M4, QC sign-off in M5 — but every capability check goes through can()
 * from day one so they can't be forgotten at feature time.
 */
export const PERMISSIONS = {
  "catalog.priceOverride": ["MANAGER"],
  "qc.signOff": ["MANAGER"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}
