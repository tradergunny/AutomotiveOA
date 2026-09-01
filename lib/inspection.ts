import type {
  BodyType,
  DamageType,
  FindingCondition,
  ProposedAction,
} from "@/lib/generated/prisma/enums";

/**
 * Canonical inspection registries (M3 brief, founder-approved taxonomy).
 *
 * Zone ids are the single source of truth shared by the Damage Map artwork,
 * server-side validation, and i18n label keys (`inspection.zones.<id>`).
 * They are stored as strings, not a DB enum — a third body type later is
 * code + copy, not a migration. Ids are identical across body types where
 * the panel exists.
 */

const SHARED_ZONES = [
  "front-bumper",
  "grille",
  "hood",
  "windshield",
  "roof",
  "rear-glass",
  "rear-bumper",
  "headlight-l",
  "headlight-r",
  "taillight-l",
  "taillight-r",
  "fender-fl",
  "fender-fr",
  "door-fl",
  "door-fr",
  "door-rl",
  "door-rr",
  "sill-l",
  "sill-r",
  "mirror-l",
  "mirror-r",
  "wheel-fl",
  "wheel-fr",
  "wheel-rl",
  "wheel-rr",
] as const;

const SEDAN_ONLY_ZONES = ["trunk", "quarter-l", "quarter-r"] as const;
const PICKUP_ONLY_ZONES = ["bed", "tailgate", "bedside-l", "bedside-r"] as const;

export const ALL_ZONES = [
  ...SHARED_ZONES,
  ...SEDAN_ONLY_ZONES,
  ...PICKUP_ONLY_ZONES,
] as const;

export type ZoneId = (typeof ALL_ZONES)[number];

const ZONES_BY_BODY_TYPE: Record<BodyType, readonly ZoneId[]> = {
  SEDAN: [...SHARED_ZONES, ...SEDAN_ONLY_ZONES],
  PICKUP: [...SHARED_ZONES, ...PICKUP_ONLY_ZONES],
};

export function zonesFor(bodyType: BodyType): readonly ZoneId[] {
  return ZONES_BY_BODY_TYPE[bodyType];
}

export function isZoneForBodyType(zone: string, bodyType: BodyType): zone is ZoneId {
  return (ZONES_BY_BODY_TYPE[bodyType] as readonly string[]).includes(zone);
}

/**
 * Service Checklist items — fixed in-code list for MVP (founder ruling).
 * Ids double as i18n label keys (`inspection.checklist.<id>`). OK is never
 * persisted: only Due soon / Needs work exist as Findings.
 */
export const CHECKLIST_ITEMS = [
  "engine-oil",
  "transmission",
  "brakes",
  "tires-suspension",
  "battery",
  "lights",
  "aircon",
  "fluids",
] as const;

export type ChecklistItemId = (typeof CHECKLIST_ITEMS)[number];

export function isChecklistItem(item: string): item is ChecklistItemId {
  return (CHECKLIST_ITEMS as readonly string[]).includes(item);
}

/** Stable UI orderings (chips render in this order). */
export const DAMAGE_TYPES = ["SCRATCH", "DENT", "CRACK", "BROKEN"] as const satisfies
  readonly DamageType[];
export const PROPOSED_ACTIONS = ["REPAIR", "REPAINT", "REPLACE", "SERVICE"] as const satisfies
  readonly ProposedAction[];

/**
 * Severity is DERIVED, never stored (DESIGN.md D-3): crack/broken ⇒ severe
 * (red hatch), anything else ⇒ minor (amber). Checklist findings map
 * NEEDS_WORK ⇒ severe, DUE_SOON ⇒ minor so both surfaces tint alike.
 */
export type Severity = "MINOR" | "SEVERE";

export function damageSeverity(damageTypes: readonly DamageType[]): Severity {
  return damageTypes.includes("CRACK") || damageTypes.includes("BROKEN")
    ? "SEVERE"
    : "MINOR";
}

export function conditionSeverity(condition: FindingCondition): Severity {
  return condition === "NEEDS_WORK" ? "SEVERE" : "MINOR";
}

/**
 * The Finding shape the inspection screen works with — what server actions
 * return and the client holds as state. Photos are id-only: bytes always
 * come through /api/photos/[id].
 */
export type FindingDto = {
  id: string;
  source: "DAMAGE_MAP" | "CHECKLIST";
  zone: string | null;
  checklistItem: string | null;
  damageTypes: DamageType[];
  condition: FindingCondition | null;
  proposedActions: ProposedAction[];
  note: string | null;
  /** The Job fulfilling this Finding (M4) — null while ungrouped. */
  jobId: string | null;
  recordedAt: string; // ISO — serializable across the RSC boundary
  recordedByName: string;
  /** When the advisor accepted it as final — null while still being captured. */
  confirmedAt: string | null;
  photos: { id: string }[];
};

/**
 * What accepting a Finding requires: a proposed action. That is the whole
 * point of the gate — "confirm" means "this is work we intend to register",
 * and a Finding with nothing proposed registers nothing. Damage types are
 * never empty (the screen keeps at least one), so they need no check.
 */
export function canConfirm(
  f: Pick<FindingDto, "source" | "damageTypes" | "proposedActions">,
): boolean {
  if (f.proposedActions.length === 0) return false;
  // A map Finding also has to name what is wrong. Accepting means "this is work
  // we intend to register", and a repaint with no damage behind it registers a
  // price with no reason for it. Checklist Findings carry a condition instead,
  // which the tri-state already required before the Finding existed.
  return f.source !== "DAMAGE_MAP" || f.damageTypes.length > 0;
}

export function findingSeverity(f: Pick<FindingDto, "damageTypes" | "condition">): Severity {
  if (f.condition) return conditionSeverity(f.condition);
  return damageSeverity(f.damageTypes);
}
