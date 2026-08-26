"use server";

import { revalidatePath } from "next/cache";
import type {
  AuthorizationChannel,
  PayerType,
} from "@/lib/generated/prisma/enums";
import { applyCaseReadiness } from "@/lib/case-flow";
import { AUTH_CHANNELS, PAYER_TYPES, PART_ORDER_STATUSES, type JobDto } from "@/lib/jobs";
import { bahtToSatang } from "@/lib/money";
import { can } from "@/lib/permissions";
import { tenantContext } from "@/lib/session";
import type { TenantDb } from "@/lib/tenant";
import { newPhotoKey, photoStore } from "@/lib/storage";
import { JOB_INCLUDE, toJobDto } from "./job-dto";

// Job actions (M4 brief §3–§5). Same shape as the M3 inspection actions:
// every mutation re-checks case ownership through the tenant guard, refuses
// DELIVERED cases, and returns the fresh JobDto so the client panel can
// reconcile its state. This file writes PROPOSED / AUTHORIZED / DECLINED;
// the working transitions live in flow-actions.ts (M5). Since M5, mutations
// that are timeline material also write their CaseEvent in the same
// transaction (ruling 1), and authorization changes re-derive READY
// (ruling 4a).

export type JobError =
  | "caseMissing"
  | "caseDelivered"
  | "jobMissing"
  | "notProposed"
  | "titleRequired"
  | "priceInvalid"
  | "priceRequired"
  | "priceLocked"
  | "invalidFindings"
  | "catalogMissing"
  | "insurerRequired"
  | "invalidInput"
  | "forbidden"
  | "partMissing"
  | "photoInvalid"
  | "photoTooLarge"
  | "quotationMissing"
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

function fail(error: unknown): { ok: false; error: JobError } {
  if (error instanceof JobInputError) return { ok: false, error: error.code };
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

/* ------------------------------------------------------------------ */
/* Job creation (brief §3): two paths.                                 */
/* ------------------------------------------------------------------ */

/** Path (a): group ungrouped Findings into one quoted Job. */
export async function createJobFromFindings(
  caseId: string,
  input: {
    findingIds: string[];
    title: string;
    price: string;
    payerType: string;
    insurerName?: string;
  },
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    await editableCase(db, caseId);

    const title = cleanText(input.title, MAX_TEXT_LENGTH);
    if (!title) throw new JobInputError("titleRequired");
    const payer = parsePayer(input.payerType, input.insurerName);
    const priceSatang = parseOptionalPrice(input.price);

    // Zero findings is allowed (founder ruling: customer-requested work),
    // but every named finding must be this case's and still ungrouped.
    const findingIds = [...new Set(input.findingIds)];
    if (findingIds.length > 0) {
      const owned = await db.finding.count({
        where: { id: { in: findingIds }, caseId, jobId: null },
      });
      if (owned !== findingIds.length) throw new JobInputError("invalidFindings");
    }

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
      if (findingIds.length > 0) {
        await tx.finding.updateMany({
          where: { id: { in: findingIds }, caseId, jobId: null },
          data: { jobId: created.id },
        });
      }
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

    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/");
    return { ok: true, value: await freshDto(db, job.id) };
  } catch (error) {
    return fail(error);
  }
}

/** Path (b): a standard service from the catalog — price locked to the entry. */
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

    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/");
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
    revalidatePath(`/cases/${job.repairCase.id}`);
    revalidatePath("/");
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Price edits, only while PROPOSED. Quoted (non-catalog) Jobs: any staff.
 * Catalog Jobs: Manager only (CONTEXT.md price override) — recorded via
 * priceOverriddenBy, cleared again when the price returns to the entry's.
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

    revalidatePath(`/cases/${job.repairCase.id}`);
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Delete a still-PROPOSED Job: releases its Findings back to ungrouped,
 * removes its part lines, authorization history, and photo rows (storage
 * bytes orphan — same accepted trade-off as M3 finding removal). Any
 * quotation line keeps its snapshot; the DB sets its soft job link NULL.
 */
export async function deleteJob(jobId: string): Promise<JobActionResult<{ id: string }>> {
  try {
    const { session, db } = await tenantContext();
    const job = await editableJob(db, jobId);
    if (job.status !== "PROPOSED") throw new JobInputError("notProposed");

    await db.$transaction(async (tx) => {
      await tx.finding.updateMany({ where: { jobId }, data: { jobId: null } });
      await tx.partLine.deleteMany({ where: { jobId } });
      await tx.jobAuthorization.deleteMany({ where: { jobId } });
      await tx.photo.deleteMany({ where: { jobId } });
      await tx.job.delete({ where: { id: jobId } });
      // jobId stays NULL on purpose: the row is gone, the snapshot title
      // keeps the timeline entry renderable (schema comment).
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId: job.repairCase.id,
          type: "JOB_DELETED",
          jobTitle: job.title,
          actorStaffId: session.staffId,
        },
      });
    });

    revalidatePath(`/cases/${job.repairCase.id}`);
    revalidatePath("/");
    return { ok: true, value: { id: jobId } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */
/* Authorization recording (brief §4): append-only history.            */
/* ------------------------------------------------------------------ */

export async function recordAuthorization(
  jobId: string,
  input: {
    decision: "AUTHORIZED" | "DECLINED";
    channel: string;
    note?: string;
    quotationId?: string;
  },
): Promise<JobActionResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    const job = await editableJob(db, jobId);
    if (job.status !== "PROPOSED") throw new JobInputError("notProposed");
    if (input.decision !== "AUTHORIZED" && input.decision !== "DECLINED") {
      throw new JobInputError("invalidInput");
    }
    // The payer authorizes an amount — an unpriced Job can be declined
    // ("no thanks" to a suggestion) but never authorized.
    if (input.decision === "AUTHORIZED" && job.priceSatang == null) {
      throw new JobInputError("priceRequired");
    }
    if (!(AUTH_CHANNELS as readonly string[]).includes(input.channel)) {
      throw new JobInputError("invalidInput");
    }

    let quotationId: string | null = null;
    if (input.quotationId) {
      const quotation = await db.quotation.findUnique({
        where: { id: input.quotationId },
        select: { id: true, caseId: true },
      });
      if (!quotation || quotation.caseId !== job.repairCase.id) {
        throw new JobInputError("quotationMissing");
      }
      quotationId = quotation.id;
    }

    const note = cleanText(input.note, MAX_NOTE_LENGTH);
    await db.$transaction(async (tx) => {
      await tx.jobAuthorization.create({
        data: {
          shopId: session.shopId,
          jobId,
          decision: input.decision,
          channel: input.channel as AuthorizationChannel,
          quotationId,
          note,
          recordedByStaffId: session.staffId,
        },
      });
      await tx.job.update({ where: { id: jobId }, data: { status: input.decision } });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId: job.repairCase.id,
          type: "JOB_AUTHORIZATION_RECORDED",
          jobId,
          jobTitle: job.title,
          fromStatus: "PROPOSED",
          toStatus: input.decision,
          note,
          actorStaffId: session.staffId,
        },
      });
      // New authorized work on a READY case revokes it (ruling 4a).
      if (input.decision === "AUTHORIZED") {
        await applyCaseReadiness(tx, session.shopId, job.repairCase.id, session.staffId);
      }
    });

    revalidatePath(`/cases/${job.repairCase.id}`);
    revalidatePath("/");
    return { ok: true, value: await freshDto(db, jobId) };
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

    revalidatePath(`/cases/${job.repairCase.id}`);
    revalidatePath("/");
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
    await editableJob(db, jobId);
    await db.partLine.create({
      data: { shopId: session.shopId, jobId, ...parsePartLine(input) },
    });
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
    await editableJob(db, line.jobId);
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
    await editableJob(db, line.jobId);
    await db.partLine.delete({ where: { id: partLineId } });
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
