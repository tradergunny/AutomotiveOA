import {
  isLineImageContentType,
  LINE_MAX_PHOTOS_PER_UPDATE,
  type LineErrorCode,
  type LineMessage,
} from "@/lib/line";
import {
  buildCatchUpBody,
  buildCheckinBody,
  buildDeliveredBody,
  buildInQcBody,
  buildJobCompletedBody,
  buildPartsArrivedBody,
  buildReadyBody,
  buildWaitingPartsBody,
  buildWorkStartedBody,
  type SystemBodyBase,
} from "@/lib/line-draft";
import {
  deliverLineUpdate,
  lineGateFor,
  newPublicToken,
  publicOrigin,
  type LineGateError,
} from "@/lib/line-send";
import type { LineUpdateKind } from "@/lib/generated/prisma/enums";
import { caseBalance } from "@/lib/payments";
import type { TenantDb } from "@/lib/tenant";

/**
 * The system send seam (M7.10, ADR-007). Every Milestone message and
 * Progress notice — check-in, work started, waiting for parts, parts
 * arrived, each finished Job, final quality check, ready, delivered, the
 * catch-up — is one call to sendSystemUpdate, and nothing else sends one.
 * The composer (FREEFORM) and Send quotation (QUOTATION) keep their own
 * callers of deliverLineUpdate because a human wrote or pressed those.
 *
 * What is fixed here, because it is what a later "simplification" removes:
 *
 * - The act has ALREADY committed when this runs (the caller's transaction
 *   is closed). The message is second and can never fail the act, so this
 *   function NEVER THROWS: every failure — a gate block, a transport error,
 *   a database error, a bug — is caught, logged, and returned as a result.
 * - A gate block is recorded: a NOT_SENT row with the kind, the body that
 *   would have been said, the gate reason in errorCode, and no photo tokens
 *   (nothing was published), plus a LINE_UPDATE_NOT_SENT event. "Did we
 *   ever tell them?" stays answerable (CONTEXT.md LINE Update).
 * - The words are the system's (lib/line-draft.ts), plus the one optional
 *   note. The photos are evidence only: a Job's own shots on JOB_COMPLETED,
 *   the finished work's on READY (CONTEXT.md Photo) — never the walkaround
 *   or a Finding's, unless a caller names them explicitly.
 */

export type SystemUpdateKind = Exclude<LineUpdateKind, "FREEFORM" | "QUOTATION">;

export type SystemUpdateInput = {
  /** The Staff whose act caused the Update (LineUpdate.sentByStaffId). */
  actor: { shopId: string; staffId: string };
  caseId: string;
  kind: SystemUpdateKind;
  /** The Milestone act's optional note to the customer; appended as written. */
  note?: string | null;
  /** JOB_COMPLETED: the Job that finished — its title, its photos, the row's jobId. */
  jobId?: string | null;
  /**
   * Explicit photo ids in send order. When omitted, the kind's own evidence
   * rule applies. Either way only this case's JPEG/PNG photos go, at most
   * LINE's cap; anything else is skipped, never an error.
   */
  photoIds?: string[];
};

export type SystemUpdateResult =
  | { outcome: "SENT"; updateId: string }
  | { outcome: "FAILED"; updateId: string; code: LineErrorCode }
  | { outcome: "NOT_SENT"; updateId: string; reason: LineGateError }
  | { outcome: "ERROR"; error: "caseMissing" | "jobMissing" | "failed" };

type LoadedCase = NonNullable<Awaited<ReturnType<typeof loadCase>>>;

async function loadCase(db: TenantDb, caseId: string) {
  return db.repairCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      reference: true,
      status: true,
      shop: { select: { name: true } },
      vehicle: { select: { plate: true } },
      contactCustomer: { select: { id: true, name: true } },
      jobs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          waitingReason: true,
          payerType: true,
          priceSatang: true,
          partLines: { select: { etaDate: true } },
        },
      },
      payments: { select: { payerType: true, amountSatang: true, voidedAt: true } },
    },
  });
}

/** The earliest expected arrival among the Jobs waiting for parts, if any is known. */
function earliestPartsEta(jobs: LoadedCase["jobs"]): Date | null {
  let earliest: Date | null = null;
  for (const job of jobs) {
    if (job.status !== "WAITING" || job.waitingReason !== "PARTS") continue;
    for (const line of job.partLines) {
      if (line.etaDate && (!earliest || line.etaDate < earliest)) earliest = line.etaDate;
    }
  }
  return earliest;
}

function bodyFor(
  kind: SystemUpdateKind,
  repairCase: LoadedCase,
  job: { title: string } | null,
  note: string | null | undefined,
): string {
  const base: SystemBodyBase = {
    shopName: repairCase.shop.name,
    customerName: repairCase.contactCustomer.name,
    plate: repairCase.vehicle.plate,
    reference: repairCase.reference,
    note,
  };
  switch (kind) {
    case "CHECKIN":
      return buildCheckinBody(base);
    case "WORK_STARTED":
      return buildWorkStartedBody(base);
    case "WAITING_PARTS":
      return buildWaitingPartsBody({ ...base, etaDate: earliestPartsEta(repairCase.jobs) });
    case "PARTS_ARRIVED":
      return buildPartsArrivedBody(base);
    case "JOB_COMPLETED":
      return buildJobCompletedBody({ ...base, jobTitle: job?.title ?? "" });
    case "IN_QC":
      return buildInQcBody(base);
    case "READY": {
      // The Customer's side only — an insurer's share never reaches the
      // customer (CONTEXT.md Milestone message).
      const balance = caseBalance(repairCase.jobs, repairCase.payments);
      return buildReadyBody({ ...base, customerOwedSatang: Math.max(0, balance.customer.dueSatang) });
    }
    case "DELIVERED":
      return buildDeliveredBody(base);
    case "CATCH_UP":
      return buildCatchUpBody({ ...base, jobs: repairCase.jobs, caseStatus: repairCase.status });
  }
}

/**
 * Which photos ride along: the caller's explicit choice (kept in order), or
 * the kind's evidence — the finished Job's own shots on JOB_COMPLETED, every
 * completed Job's on READY, none otherwise. Newest first, JPEG/PNG only,
 * within LINE's cap; walkaround and Finding photos are never picked up.
 */
async function photosFor(
  db: TenantDb,
  input: SystemUpdateInput,
  repairCase: LoadedCase,
): Promise<string[]> {
  if (input.photoIds) {
    if (input.photoIds.length === 0) return [];
    const found = await db.photo.findMany({
      where: { id: { in: input.photoIds }, caseId: repairCase.id },
      select: { id: true, contentType: true },
    });
    const usable = new Set(
      found.filter((photo) => isLineImageContentType(photo.contentType)).map((photo) => photo.id),
    );
    return input.photoIds.filter((id) => usable.has(id)).slice(0, LINE_MAX_PHOTOS_PER_UPDATE);
  }

  let jobIds: string[];
  if (input.kind === "JOB_COMPLETED" && input.jobId) {
    jobIds = [input.jobId];
  } else if (input.kind === "READY") {
    jobIds = repairCase.jobs.filter((job) => job.status === "COMPLETED").map((job) => job.id);
  } else {
    return [];
  }
  if (jobIds.length === 0) return [];
  const photos = await db.photo.findMany({
    where: { caseId: repairCase.id, jobId: { in: jobIds } },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, contentType: true },
  });
  return photos
    .filter((photo) => isLineImageContentType(photo.contentType))
    .slice(0, LINE_MAX_PHOTOS_PER_UPDATE)
    .map((photo) => photo.id);
}

/**
 * Send one system Update for a case. Never throws; the act that caused it
 * has already committed and does not wait on the answer beyond this call.
 */
export async function sendSystemUpdate(
  db: TenantDb,
  input: SystemUpdateInput,
): Promise<SystemUpdateResult> {
  try {
    const repairCase = await loadCase(db, input.caseId);
    if (!repairCase) return { outcome: "ERROR", error: "caseMissing" };

    const job =
      input.kind === "JOB_COMPLETED"
        ? (repairCase.jobs.find((candidate) => candidate.id === input.jobId) ?? null)
        : null;
    if (input.kind === "JOB_COMPLETED" && !job) return { outcome: "ERROR", error: "jobMissing" };

    const bodyText = bodyFor(input.kind, repairCase, job, input.note);
    const customer = repairCase.contactCustomer;
    const gate = await lineGateFor(db, input.actor.shopId, customer.id);

    if (!gate.ok) {
      // ---- the recorded gap: nothing pushed, nothing published ----
      const contact =
        gate.error === "unfollowed"
          ? await db.lineContact.findFirst({ where: { customerId: customer.id }, select: { lineUserId: true } })
          : null;
      const row = await db.$transaction(async (tx) => {
        const created = await tx.lineUpdate.create({
          data: {
            shopId: input.actor.shopId,
            caseId: repairCase.id,
            customerId: customer.id,
            lineUserId: contact?.lineUserId ?? null,
            recipientName: customer.name,
            bodyText,
            kind: input.kind,
            jobId: job?.id ?? null,
            deliveryStatus: "NOT_SENT",
            errorCode: gate.error,
            sentByStaffId: input.actor.staffId,
          },
          select: { id: true },
        });
        await tx.caseEvent.create({
          data: {
            shopId: input.actor.shopId,
            caseId: repairCase.id,
            type: "LINE_UPDATE_NOT_SENT",
            lineUpdateId: created.id,
            subjectName: customer.name,
            actorStaffId: input.actor.staffId,
          },
        });
        return created;
      });
      return { outcome: "NOT_SENT", updateId: row.id, reason: gate.error };
    }

    const photoIds = await photosFor(db, input, repairCase);
    const photos = photoIds.map((photoId) => ({ photoId, token: newPublicToken() }));
    const origin = photos.length ? await publicOrigin() : "";
    const messages: LineMessage[] = [
      { type: "text", text: bodyText },
      ...photos.map(({ token }) => {
        const url = `${origin}/api/line/photo/${token}`;
        return { type: "image" as const, originalContentUrl: url, previewImageUrl: url };
      }),
    ];

    const delivered = await deliverLineUpdate({
      db,
      actor: input.actor,
      caseId: repairCase.id,
      customer,
      gate: gate.value,
      kind: input.kind,
      jobId: job?.id ?? null,
      bodyText,
      photos,
      quotation: null,
      messages,
    });
    if (!delivered.push.ok) {
      return { outcome: "FAILED", updateId: delivered.update.id, code: delivered.push.code };
    }
    return { outcome: "SENT", updateId: delivered.update.id };
  } catch (error) {
    // The act is already done; a message we could not even record is a bug
    // to read about in the logs, never a reason to fail the caller.
    console.error(`[line-updates] ${input.kind} for case ${input.caseId} failed:`, error);
    return { outcome: "ERROR", error: "failed" };
  }
}
