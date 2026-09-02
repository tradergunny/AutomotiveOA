"use server";

import { revalidatePath } from "next/cache";
import type { PayerType } from "@/lib/generated/prisma/enums";
import { applyCaseReadiness } from "@/lib/case-flow";
import { PAYER_TYPES, PART_ORDER_STATUSES, type JobDto } from "@/lib/jobs";
import { bahtToSatang } from "@/lib/money";
import {
  OfferError,
  deleteProposedLine,
  mergeProposedLines,
  recordOfferResponse as recordOfferResponseCore,
  type OfferDecision,
  type OfferErrorCode,
} from "@/lib/offer";
import { can } from "@/lib/permissions";
import { tenantContext } from "@/lib/session";
import type { TenantDb } from "@/lib/tenant";
import { newPhotoKey, photoStore } from "@/lib/storage";
import { JOB_INCLUDE, toJobDto } from "./job-dto";

// Job actions (M4 brief §3–§5; M7.7 D-20/D-22/D-24). Same shape as the M3
// inspection actions: every mutation re-checks case ownership through the
// tenant guard, refuses DELIVERED cases, and returns the fresh JobDto so the
// client panel can reconcile its state. This file writes PROPOSED /
// AUTHORIZED / DECLINED; the working transitions live in flow-actions.ts
// (M5). Mutations that are timeline material write their CaseEvent in the
// same transaction (M5 ruling 1), and authorization changes re-derive READY
// (ruling 4a). Since M7.7 the Offer's own rules — merge, the Response as a
// set, delete-reopens — live in lib/offer.ts and are only wrapped here.

export type JobError =
  | OfferErrorCode
  | "titleRequired"
  | "priceInvalid"
  | "priceLocked"
  | "catalogMissing"
  | "insurerRequired"
  | "forbidden"
  | "partMissing"
  | "photoInvalid"
  | "photoTooLarge"
  | "failed";

export type JobActionResult<T> = { ok: true; value: T } | { ok: false; error: JobError };

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_LENGTH = 300;
const MAX_NOTE_LENGTH = 2000;
const MAX_PART_QUANTITY = 999;

class JobInputError extends Error {
  constructor(readonly code: JobError) {
    super(`job input: ${code}`);
  }
}

/** The case, if it exists in this shop and is still editable (not DELIVERED). */
async function editableCase(db: TenantDb, caseId: string) {
  const repairCase = await db.repairCase.findUnique({
    where: { id: caseId },
    select: { id: true, status: true, reference: true },
  });
  if (!repairCase) throw new JobInputError("caseMissing");
  if (repairCase.status === "DELIVERED") throw new JobInputError("caseDelivered");
  return repairCase;
}

/** A job plus its still-editable case, scoped to this shop. */
async function editableJob(db: TenantDb, jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      catalogItem: { select: { priceSatang: true } },
      repairCase: { select: { id: true, status: true } },
    },
  });
  if (!job) throw new JobInputError("jobMissing");
  if (job.repairCase.status === "DELIVERED") throw new JobInputError("caseDelivered");
  return job;
}

async function freshDto(db: TenantDb, jobId: string): Promise<JobDto> {
  const row = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: JOB_INCLUDE });
  return toJobDto(row);
}

async function freshDtos(db: TenantDb, jobIds: string[]): Promise<JobDto[]> {
  const rows = await db.job.findMany({
    where: { id: { in: jobIds } },
    include: JOB_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toJobDto);
}

function fail(error: unknown): { ok: false; error: JobError } {
  if (error instanceof JobInputError) return { ok: false, error: error.code };
  if (error instanceof OfferError) return { ok: false, error: error.code };
  console.error("[jobs] failed:", error);
  return { ok: false, error: "failed" };
}

function cleanText(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim().slice(0, max);
  return text || null;
}

/** payerType + insurerName as one validated unit (INSURER needs a name). */
function parsePayer(payerType: string, insurerName: unknown) {
  if (!(PAYER_TYPES as readonly string[]).includes(payerType)) {
    throw new JobInputError("invalidInput");
  }
  const typed = payerType as PayerType;
  const name = cleanText(insurerName, MAX_TEXT_LENGTH);
  if (typed === "INSURER" && !name) throw new JobInputError("insurerRequired");
  return { payerType: typed, insurerName: typed === "INSURER" ? name : null };
}

/** Optional price input: "" → null (unpriced), otherwise valid baht. */
function parseOptionalPrice(input: string): number | null {
  if (!input.trim()) return null;
  const satang = bahtToSatang(input);
  if (satang == null) throw new JobInputError("priceInvalid");
  return satang;
}

function revalidateCase(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/");
}

/* ------------------------------------------------------------------ */
/* Job creation — the Add job dialog's two sources (D-22). Findings    */
/* make their own lines on Accept (D-24, inspection/actions.ts).       */
/* ------------------------------------------------------------------ */

/** Custom: customer-requested work with no Finding — a typed title, optional price. */
export async function createCustomJob(
  caseId: string,
  input: { title: string; price: string; payerType: string; insurerName?: string },
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    await editableCase(db, caseId);

    const title = cleanText(input.title, MAX_TEXT_LENGTH);
    if (!title) throw new JobInputError("titleRequired");
    const payer = parsePayer(input.payerType, input.insurerName);
    const priceSatang = parseOptionalPrice(input.price);

    const job = await db.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          shopId: session.shopId,
          caseId,
          title,
          priceSatang,
          ...payer,
          createdByStaffId: session.staffId,
        },
      });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId,
          type: "JOB_CREATED",
          jobId: created.id,
          jobTitle: title,
          actorStaffId: session.staffId,
        },
      });
      return created;
    });

    revalidateCase(caseId);
    return { ok: true, value: await freshDto(db, job.id) };
  } catch (error) {
    return fail(error);
  }
}

/** Standard service from the catalog — price locked to the entry. */
export async function createCatalogJob(
  caseId: string,
  input: { catalogItemId: string; payerType: string; insurerName?: string },
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    await editableCase(db, caseId);
    const payer = parsePayer(input.payerType, input.insurerName);

    const item = await db.serviceCatalogItem.findUnique({
      where: { id: input.catalogItemId },
      select: { id: true, name: true, priceSatang: true, active: true },
    });
    if (!item?.active) throw new JobInputError("catalogMissing");

    const job = await db.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          shopId: session.shopId,
          caseId,
          title: item.name,
          catalogItemId: item.id,
          priceSatang: item.priceSatang,
          ...payer,
          createdByStaffId: session.staffId,
        },
      });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId,
          type: "JOB_CREATED",
          jobId: created.id,
          jobTitle: created.title,
          actorStaffId: session.staffId,
        },
      });
      return created;
    });

    revalidateCase(caseId);
    return { ok: true, value: await freshDto(db, job.id) };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */
/* Job editing (brief §3): title/payer while PROPOSED; note/assignee    */
/* any time before delivery.                                            */
/* ------------------------------------------------------------------ */

export async function updateJob(
  jobId: string,
  patch: {
    title?: string;
    payerType?: string;
    insurerName?: string;
    note?: string;
    assignedStaffId?: string | null;
  },
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    const job = await editableJob(db, jobId);

    const data: Record<string, unknown> = {};
    if (patch.title !== undefined || patch.payerType !== undefined) {
      if (job.status !== "PROPOSED") throw new JobInputError("notProposed");
    }
    if (patch.title !== undefined) {
      const title = cleanText(patch.title, MAX_TEXT_LENGTH);
      if (!title) throw new JobInputError("titleRequired");
      data.title = title;
    }
    if (patch.payerType !== undefined) {
      Object.assign(data, parsePayer(patch.payerType, patch.insurerName));
    }
    if (patch.note !== undefined) data.note = cleanText(patch.note, MAX_NOTE_LENGTH);
    let assignmentChanged = false;
    if (patch.assignedStaffId !== undefined) {
      if (patch.assignedStaffId === null) {
        data.assignedStaffId = null;
      } else {
        const staff = await db.staff.findUnique({
          where: { id: patch.assignedStaffId },
          select: { id: true },
        });
        if (!staff) throw new JobInputError("invalidInput");
        data.assignedStaffId = staff.id;
      }
      assignmentChanged = data.assignedStaffId !== job.assignedStaffId;
    }

    await db.$transaction(async (tx) => {
      await tx.job.update({ where: { id: jobId }, data });
      if (assignmentChanged) {
        await tx.caseEvent.create({
          data: {
            shopId: session.shopId,
            caseId: job.repairCase.id,
            type: "JOB_ASSIGNED",
            jobId,
            jobTitle: (data.title as string | undefined) ?? job.title,
            subjectStaffId: data.assignedStaffId as string | null,
            actorStaffId: session.staffId,
          },
        });
      }
    });
    revalidateCase(job.repairCase.id);
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Price edits, only while PROPOSED — the Offer's one live cell (D-21).
 * Quoted (non-catalog) Jobs: any staff. Catalog Jobs: Manager only
 * (CONTEXT.md price override) — recorded via priceOverriddenBy, cleared
 * again when the price returns to the entry's. Pricing a line is what
 * freezes its Findings (D-24); nothing extra to write for that.
 */
export async function updateJobPrice(
  jobId: string,
  priceInput: string,
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    const job = await editableJob(db, jobId);
    if (job.status !== "PROPOSED") throw new JobInputError("notProposed");

    const priceSatang = parseOptionalPrice(priceInput);
    if (job.catalogItemId) {
      if (!can(session.role, "catalog.priceOverride")) {
        throw new JobInputError("priceLocked");
      }
      if (priceSatang == null) throw new JobInputError("priceInvalid");
      const override = priceSatang !== job.catalogItem?.priceSatang;
      await db.$transaction(async (tx) => {
        await tx.job.update({
          where: { id: jobId },
          data: {
            priceSatang,
            priceOverriddenByStaffId: override ? session.staffId : null,
          },
        });
        if (override) {
          await tx.caseEvent.create({
            data: {
              shopId: session.shopId,
              caseId: job.repairCase.id,
              type: "JOB_PRICE_OVERRIDDEN",
              jobId,
              jobTitle: job.title,
              priceSatang,
              actorStaffId: session.staffId,
            },
          });
        }
      });
    } else {
      await db.job.update({ where: { id: jobId }, data: { priceSatang } });
    }

    revalidateCase(job.repairCase.id);
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Delete a still-PROPOSED line. Its Findings REOPEN — off the line and
 * un-accepted (D-24, amending D-11): deleting the line is the release of a
 * frozen Finding, and the inspection screen takes it from there.
 */
export async function deleteJob(jobId: string): Promise<JobActionResult<{ id: string }>> {
  try {
    const { session, db } = await tenantContext();
    const job = await editableJob(db, jobId);
    if (job.status !== "PROPOSED") throw new JobInputError("notProposed");

    const actor = { shopId: session.shopId, staffId: session.staffId };
    await db.$transaction((tx) =>
      deleteProposedLine(tx, actor, { id: job.id, title: job.title, caseId: job.repairCase.id }),
    );

    revalidateCase(job.repairCase.id);
    return { ok: true, value: { id: jobId } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Merge (D-24): two or more Proposed lines of one payer become one — the
 * three-panel repaint. The oldest survives with every Finding, part and photo;
 * the price stays only if exactly one part had one. Returns the survivor and
 * the ids that left.
 */
export async function mergeJobs(
  caseId: string,
  jobIds: string[],
): Promise<JobActionResult<{ survivor: JobDto; absorbedIds: string[] }>> {
  try {
    const { session, db } = await tenantContext();
    await editableCase(db, caseId);
    const actor = { shopId: session.shopId, staffId: session.staffId };
    const survivorId = await mergeProposedLines(db, actor, caseId, jobIds);
    revalidateCase(caseId);
    return {
      ok: true,
      value: {
        survivor: await freshDto(db, survivorId),
        absorbedIds: jobIds.filter((id) => id !== survivorId),
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */
/* The Response (D-20): one payer's answer to the Offer, as a set.     */
/* ------------------------------------------------------------------ */

export async function recordOfferResponse(
  caseId: string,
  input: {
    payerType: string;
    insurerName?: string;
    channel: string;
    quotationId?: string;
    note?: string;
    decisions: OfferDecision[];
  },
): Promise<JobActionResult<JobDto[]>> {
  try {
    const { session, db } = await tenantContext();
    const part = parsePayer(input.payerType, input.insurerName);
    const actor = { shopId: session.shopId, staffId: session.staffId };
    const { jobIds } = await recordOfferResponseCore(db, actor, caseId, {
      part,
      channel: input.channel,
      quotationId: input.quotationId || null,
      note: input.note,
      decisions: input.decisions,
    });
    revalidateCase(caseId);
    return { ok: true, value: await freshDtos(db, jobIds) };
  } catch (error) {
    return fail(error);
  }
}

/** Manager-only correction: back to PROPOSED, recorded as one more entry. */
export async function revertAuthorization(
  jobId: string,
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "authorization.revert")) {
      throw new JobInputError("forbidden");
    }
    const job = await editableJob(db, jobId);
    if (job.status !== "AUTHORIZED" && job.status !== "DECLINED") {
      throw new JobInputError("invalidInput");
    }

    await db.$transaction(async (tx) => {
      await tx.jobAuthorization.create({
        data: {
          shopId: session.shopId,
          jobId,
          decision: "REVERTED",
          recordedByStaffId: session.staffId,
        },
      });
      await tx.job.update({ where: { id: jobId }, data: { status: "PROPOSED" } });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId: job.repairCase.id,
          type: "JOB_AUTHORIZATION_RECORDED",
          jobId,
          jobTitle: job.title,
          fromStatus: job.status,
          toStatus: "PROPOSED",
          actorStaffId: session.staffId,
        },
      });
      // Un-authorizing may leave only completed work → the case turns READY.
      if (job.status === "AUTHORIZED") {
        await applyCaseReadiness(tx, session.shopId, job.repairCase.id, session.staffId);
      }
    });

    revalidateCase(job.repairCase.id);
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */
/* Part Lines (brief §5): what this repair needs — nothing more.       */
/* ------------------------------------------------------------------ */

type PartLineInput = {
  name: string;
  quantity: string;
  unitCost: string;
  supplier: string;
  etaDate: string;
  note: string;
};

function parsePartLine(input: PartLineInput) {
  const name = cleanText(input.name, MAX_TEXT_LENGTH);
  if (!name) throw new JobInputError("invalidInput");
  const quantity = Number(input.quantity || "1");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PART_QUANTITY) {
    throw new JobInputError("invalidInput");
  }
  const unitCostSatang = parseOptionalPrice(input.unitCost);
  const etaDate = input.etaDate ? new Date(`${input.etaDate}T00:00:00Z`) : null;
  if (etaDate && Number.isNaN(etaDate.getTime())) throw new JobInputError("invalidInput");
  return {
    name,
    quantity,
    unitCostSatang,
    supplier: cleanText(input.supplier, MAX_TEXT_LENGTH),
    etaDate,
    note: cleanText(input.note, MAX_NOTE_LENGTH),
  };
}

export async function addPartLine(
  jobId: string,
  input: PartLineInput,
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    const job = await editableJob(db, jobId);
    await db.partLine.create({
      data: { shopId: session.shopId, jobId, ...parsePartLine(input) },
    });
    // The case header's Waiting blocker and the board's parts progress read
    // part lines since M7.5 (D-6) — keep the server render fresh.
    revalidateCase(job.repairCase.id);
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

export async function updatePartLine(
  partLineId: string,
  input: PartLineInput & { orderStatus: string },
): Promise<JobActionResult<JobDto>> {
  try {
    const { db } = await tenantContext();
    const line = await db.partLine.findUnique({
      where: { id: partLineId },
      select: { id: true, jobId: true },
    });
    if (!line) throw new JobInputError("partMissing");
    const job = await editableJob(db, line.jobId);
    if (!(PART_ORDER_STATUSES as readonly string[]).includes(input.orderStatus)) {
      throw new JobInputError("invalidInput");
    }
    await db.partLine.update({
      where: { id: partLineId },
      data: {
        ...parsePartLine(input),
        orderStatus: input.orderStatus as (typeof PART_ORDER_STATUSES)[number],
      },
    });
    revalidateCase(job.repairCase.id);
    return { ok: true, value: await freshDto(db, line.jobId) };
  } catch (error) {
    return fail(error);
  }
}

export async function removePartLine(
  partLineId: string,
): Promise<JobActionResult<JobDto>> {
  try {
    const { db } = await tenantContext();
    const line = await db.partLine.findUnique({
      where: { id: partLineId },
      select: { id: true, jobId: true },
    });
    if (!line) throw new JobInputError("partMissing");
    const job = await editableJob(db, line.jobId);
    await db.partLine.delete({ where: { id: partLineId } });
    revalidateCase(job.repairCase.id);
    return { ok: true, value: await freshDto(db, line.jobId) };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */
/* Job photos (brief §1): relayed progress shots, uploaded by office    */
/* staff — the M2/M3 photo plumbing at Job level.                       */
/* ------------------------------------------------------------------ */

export async function addJobPhoto(
  jobId: string,
  formData: FormData,
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    const job = await editableJob(db, jobId);

    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0 || !PHOTO_TYPES.has(file.type)) {
      throw new JobInputError("photoInvalid");
    }
    if (file.size > MAX_PHOTO_BYTES) throw new JobInputError("photoTooLarge");
    const bytes = new Uint8Array(await file.arrayBuffer());

    const caseId = job.repairCase.id;
    const storageKey = newPhotoKey(session.shopId, caseId, file.type);
    await photoStore.put(storageKey, bytes, file.type);
    await db.photo.create({
      data: {
        shopId: session.shopId,
        caseId,
        jobId,
        storageKey,
        contentType: file.type,
        sizeBytes: bytes.byteLength,
        uploadedByStaffId: session.staffId,
      },
    });

    revalidatePath(`/cases/${caseId}`);
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

export async function removeJobPhoto(
  photoId: string,
): Promise<JobActionResult<JobDto>> {
  try {
    const { db } = await tenantContext();
    const photo = await db.photo.findUnique({
      where: { id: photoId },
      select: { id: true, jobId: true },
    });
    if (!photo?.jobId) throw new JobInputError("jobMissing");
    const job = await editableJob(db, photo.jobId);
    await db.photo.delete({ where: { id: photoId } });
    revalidatePath(`/cases/${job.repairCase.id}`);
    return { ok: true, value: await freshDto(db, photo.jobId) };
  } catch (error) {
    return fail(error);
  }
}
