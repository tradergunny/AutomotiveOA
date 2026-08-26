import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * Permission checks (CONTEXT.md: the only special rules in MVP are the
 * Manager ones). Live since M4: catalog maintenance, catalog price override,
 * and authorization revert. QC sign-off arrives with the M5 gate. Every
 * capability check goes through can() so none can be forgotten at feature
 * time.
 */
export const PERMISSIONS = {
  "catalog.manage": ["MANAGER"],
  "catalog.priceOverride": ["MANAGER"],
  "authorization.revert": ["MANAGER"],
  "qc.signOff": ["MANAGER"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}
