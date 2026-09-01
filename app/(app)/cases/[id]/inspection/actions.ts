"use server";

import { revalidatePath } from "next/cache";
import type {
  DamageType,
  FindingCondition,
  ProposedAction,
} from "@/lib/generated/prisma/enums";
import {
  DAMAGE_TYPES,
  PROPOSED_ACTIONS,
  canConfirm,
  isChecklistItem,
  isZoneForBodyType,
  type FindingDto,
} from "@/lib/inspection";
import { tenantContext } from "@/lib/session";
import type { TenantDb } from "@/lib/tenant";
import { newPhotoKey, photoStore } from "@/lib/storage";

// Inspection actions (M3 brief §3–5). Incremental by design: every capture
// persists immediately — a mid-inspection tab close loses nothing. Each
// action re-checks case ownership through the tenant guard and refuses
// DELIVERED cases (CONTEXT.md: findings arrive any time BEFORE delivery).

export type InspectionError =
  | "invalidZone"
  | "invalidItem"
  | "caseDelivered"
  | "findingMissing"
  | "noAction"
  | "noDamage"
  | "findingAccepted"
  | "findingGrouped"
  | "photoInvalid"
  | "photoTooLarge"
  | "failed";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: InspectionError };

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_NOTE_LENGTH = 2000;

class InspectionInputError extends Error {
  constructor(readonly code: InspectionError) {
    super(`inspection input: ${code}`);
  }
}

const FINDING_INCLUDE = {
  recordedBy: { select: { name: true } },
  photos: { select: { id: true }, orderBy: { capturedAt: "asc" } },
} as const;

type FindingRow = {
  id: string;
  source: "DAMAGE_MAP" | "CHECKLIST";
  zone: string | null;
  checklistItem: string | null;
  damageTypes: DamageType[];
  condition: FindingCondition | null;
  proposedActions: ProposedAction[];
  note: string | null;
  jobId: string | null;
  recordedAt: Date;
  recordedBy: { name: string };
  confirmedAt: Date | null;
  photos: { id: string }[];
};

function toDto(row: FindingRow): FindingDto {
  return {
    id: row.id,
    source: row.source,
    zone: row.zone,
    checklistItem: row.checklistItem,
    damageTypes: row.damageTypes,
    condition: row.condition,
    proposedActions: row.proposedActions,
    note: row.note,
    jobId: row.jobId,
    recordedAt: row.recordedAt.toISOString(),
    recordedByName: row.recordedBy.name,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    photos: row.photos,
  };
}

/** The case, if it exists in this shop and is still editable. */
async function editableCase(db: TenantDb, caseId: string) {
  const repairCase = await db.repairCase.findUnique({
    where: { id: caseId },
    select: { id: true, status: true, vehicle: { select: { bodyType: true } } },
  });
  if (!repairCase) throw new InspectionInputError("findingMissing");
  if (repairCase.status === "DELIVERED") throw new InspectionInputError("caseDelivered");
  return repairCase;
}

/** A finding plus its still-editable case, scoped to this shop. */
async function editableFinding(db: TenantDb, findingId: string) {
  const finding = await db.finding.findUnique({
    where: { id: findingId },
    include: { ...FINDING_INCLUDE, repairCase: { select: { id: true, status: true } } },
  });
  if (!finding) throw new InspectionInputError("findingMissing");
  if (finding.repairCase.status === "DELIVERED") {
    throw new InspectionInputError("caseDelivered");
  }
  return finding;
}

/**
 * A Finding on a Job has stopped being an inspection note: it is the stated
 * reason for work that may already be priced, quoted and authorized. Editing
 * it silently un-accepts it (updateFinding), which would leave a Job holding
 * an unaccepted Finding, and deleting it would leave the Job with no stated
 * reason at all. There is no per-Finding ungroup — the only release is
 * deleting the Job, which refuses once the Job is past PROPOSED — so freezing
 * the Finding here is what keeps the two sides honest.
 */
function assertUngrouped(finding: { jobId: string | null }) {
  if (finding.jobId) throw new InspectionInputError("findingGrouped");
}

function fail(error: unknown): { ok: false; error: InspectionError } {
  if (error instanceof InspectionInputError) return { ok: false, error: error.code };
  console.error("[inspection] failed:", error);
  return { ok: false, error: "failed" };
}

const dedupe = <T,>(values: readonly T[], allowed: readonly T[]) =>
  allowed.filter((v) => values.includes(v));

/** Tap on a clean zone: open a new Damage Map finding there. */
export async function createMapFinding(
  caseId: string,
  zone: string,
): Promise<ActionResult<FindingDto>> {
  try {
    const { session, db } = await tenantContext();
    const repairCase = await editableCase(db, caseId);
    if (!isZoneForBodyType(zone, repairCase.vehicle.bodyType)) {
      throw new InspectionInputError("invalidZone");
    }
    const finding = await db.finding.create({
      data: {
        shopId: session.shopId,
        caseId,
        source: "DAMAGE_MAP",
        zone,
        // Both lists start empty. Seeding "scratch, repair" meant a Finding was
        // born asserting a damage and a price the inspector had never chosen,
        // and Accept would carry it through unnoticed.
        recordedByStaffId: session.staffId,
      },
      include: FINDING_INCLUDE,
    });
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, value: toDto(finding) };
  } catch (error) {
    return fail(error);
  }
}

/** Edit a finding's damage types, proposed actions, or note. */
export async function updateFinding(
  findingId: string,
  patch: {
    damageTypes?: string[];
    proposedActions?: string[];
    note?: string;
  },
): Promise<ActionResult<FindingDto>> {
  try {
    const { db } = await tenantContext();
    const existing = await editableFinding(db, findingId);
    assertUngrouped(existing);

    const data: {
      damageTypes?: DamageType[];
      proposedActions?: ProposedAction[];
      note?: string | null;
      confirmedAt?: Date | null;
    } = {};
    if (patch.damageTypes !== undefined && existing.source === "DAMAGE_MAP") {
      // Clearing the last damage type is allowed while the Finding is being
      // captured; it is Accept that insists on one (canConfirm).
      data.damageTypes = dedupe(patch.damageTypes as DamageType[], DAMAGE_TYPES);
    }
    if (patch.proposedActions !== undefined) {
      data.proposedActions = dedupe(patch.proposedActions as ProposedAction[], PROPOSED_ACTIONS);
    }
    if (patch.note !== undefined) {
      data.note = patch.note.trim().slice(0, MAX_NOTE_LENGTH) || null;
    }
    // Editing a confirmed Finding reopens it: "confirmed" has to mean the
    // advisor accepted THESE values, not an earlier version of them. The
    // screen already reopens before it lets anyone type; this holds the
    // invariant for every other caller.
    if (existing.confirmedAt) data.confirmedAt = null;

    const updated = await db.finding.update({
      where: { id: findingId },
      data,
      include: FINDING_INCLUDE,
    });
    revalidatePath(`/cases/${existing.repairCase.id}`);
    return { ok: true, value: toDto(updated) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * The accept step: flip a Finding between "still being captured" and
 * "accepted as final". Never a save — every field persisted the moment it
 * was tapped, so an interrupted inspection loses nothing either way. Only a
 * confirmed Finding is offered for grouping into a Job (see job-actions.ts).
 */
export async function setFindingConfirmed(
  findingId: string,
  confirmed: boolean,
): Promise<ActionResult<FindingDto>> {
  try {
    const { db } = await tenantContext();
    const existing = await editableFinding(db, findingId);
    assertUngrouped(existing);
    if (confirmed && !canConfirm(existing)) {
      throw new InspectionInputError(
        existing.source === "DAMAGE_MAP" && existing.damageTypes.length === 0
          ? "noDamage"
          : "noAction",
      );
    }

    const updated = await db.finding.update({
      where: { id: findingId },
      data: { confirmedAt: confirmed ? new Date() : null },
      include: FINDING_INCLUDE,
    });
    revalidatePath(`/cases/${existing.repairCase.id}`);
    return { ok: true, value: toDto(updated) };
  } catch (error) {
    return fail(error);
  }
}

/** Remove a finding and its photo rows (storage bytes orphan — accepted). */
export async function removeFinding(
  findingId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { db } = await tenantContext();
    const existing = await editableFinding(db, findingId);
    assertUngrouped(existing);
    await db.$transaction(async (tx) => {
      await tx.photo.deleteMany({ where: { findingId } });
      await tx.finding.delete({ where: { id: findingId } });
    });
    revalidatePath(`/cases/${existing.repairCase.id}`);
    return { ok: true, value: { id: findingId } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Tri-state checklist control. OK removes the item's finding (OK is never
 * persisted — founder ruling); Due soon / Needs work upserts it, one finding
 * per item per case (schema-unique).
 */
export async function setChecklistState(
  caseId: string,
  item: string,
  state: "OK" | FindingCondition,
): Promise<ActionResult<FindingDto | null>> {
  try {
    const { session, db } = await tenantContext();
    await editableCase(db, caseId);
    if (!isChecklistItem(item)) throw new InspectionInputError("invalidItem");

    // An accepted Finding is a record, not a form (D-11) — and this path can
    // delete it and its photos, so a disabled button in the client is not the
    // place to enforce that. Reopening from the record is the way back in.
    const current = await db.finding.findFirst({
      where: { caseId, checklistItem: item },
      select: { id: true, confirmedAt: true, jobId: true },
    });
    if (current) assertUngrouped(current);
    if (current?.confirmedAt) throw new InspectionInputError("findingAccepted");

    if (state === "OK") {
      if (current) {
        await db.$transaction(async (tx) => {
          await tx.photo.deleteMany({ where: { findingId: current.id } });
          await tx.finding.delete({ where: { id: current.id } });
        });
      }
      revalidatePath(`/cases/${caseId}`);
      return { ok: true, value: null };
    }

    const finding = await db.finding.upsert({
      where: {
        shopId_caseId_checklistItem: {
          shopId: session.shopId,
          caseId,
          checklistItem: item,
        },
      },
      create: {
        shopId: session.shopId,
        caseId,
        source: "CHECKLIST",
        checklistItem: item,
        condition: state,
        proposedActions: state === "NEEDS_WORK" ? ["SERVICE"] : [],
        recordedByStaffId: session.staffId,
      },
      update: { condition: state },
      include: FINDING_INCLUDE,
    });
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, value: toDto(finding) };
  } catch (error) {
    return fail(error);
  }
}

/** Attach one (client-downscaled) photo to a finding. */
export async function addFindingPhoto(
  findingId: string,
  formData: FormData,
): Promise<ActionResult<FindingDto>> {
  try {
    const { session, db } = await tenantContext();
    const existing = await editableFinding(db, findingId);
    assertUngrouped(existing);

    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0 || !PHOTO_TYPES.has(file.type)) {
      throw new InspectionInputError("photoInvalid");
    }
    if (file.size > MAX_PHOTO_BYTES) throw new InspectionInputError("photoTooLarge");
    const bytes = new Uint8Array(await file.arrayBuffer());

    const caseId = existing.repairCase.id;
    const storageKey = newPhotoKey(session.shopId, caseId, file.type);
    await photoStore.put(storageKey, bytes, file.type);
    await db.photo.create({
      data: {
        shopId: session.shopId,
        caseId,
        findingId,
        storageKey,
        contentType: file.type,
        sizeBytes: bytes.byteLength,
        uploadedByStaffId: session.staffId,
      },
    });

    const fresh = await db.finding.findUniqueOrThrow({
      where: { id: findingId },
      include: FINDING_INCLUDE,
    });
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, value: toDto(fresh) };
  } catch (error) {
    return fail(error);
  }
}

/** Remove one finding photo (never touches case-level walkaround shots). */
export async function removeFindingPhoto(
  photoId: string,
): Promise<ActionResult<FindingDto>> {
  try {
    const { db } = await tenantContext();
    const photo = await db.photo.findUnique({
      where: { id: photoId },
      select: { id: true, findingId: true },
    });
    if (!photo?.findingId) throw new InspectionInputError("findingMissing");
    const finding = await editableFinding(db, photo.findingId);
    assertUngrouped(finding);
    await db.photo.delete({ where: { id: photoId } });

    const fresh = await db.finding.findUniqueOrThrow({
      where: { id: finding.id },
      include: FINDING_INCLUDE,
    });
    revalidatePath(`/cases/${finding.repairCase.id}`);
    return { ok: true, value: toDto(fresh) };
  } catch (error) {
    return fail(error);
  }
}
