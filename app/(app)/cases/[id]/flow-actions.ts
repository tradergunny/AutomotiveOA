"use server";

import { revalidatePath } from "next/cache";
import type { WaitingReason } from "@/lib/generated/prisma/enums";
import {
  applyCaseReadiness,
  canFlow,
  hasActiveWork,
  JOB_FLOW_ACTIONS,
  REVERTIBLE_STATUSES,
  WAITING_REASONS,
  type JobFlowAction,
} from "@/lib/case-flow";
import { mintFollowUpsForCase } from "@/lib/followups";
import type { JobDto } from "@/lib/jobs";
import { can } from "@/lib/permissions";
import { tenantContext } from "@/lib/session";
import type { TenantDb } from "@/lib/tenant";
import { JOB_INCLUDE, toJobDto } from "./job-dto";

// M5 flow actions (brief §2–§4): Job working transitions along the fixed
// edge map, the Manager-only single-step revert, and the case's Mark ready /
// Mark delivered. Every mutation writes its CaseEvent(s) in the SAME
// transaction (ruling 1) and re-derives READY where a Job left or rejoined
// the active set (ruling 4a). No free status write exists anywhere.

export type FlowError =
  | "caseMissing"
  | "caseDelivered"
  | "jobMissing"
  | "invalidTransition"
  | "reasonRequired"
  | "noteRequired"
  | "forbidden"
  | "qcOwnWork"
  | "activeWork"
  | "notReady"
  | "failed";

export type FlowResult<T> = { ok: true; value: T } | { ok: false; error: FlowError };

const MAX_NOTE_LENGTH = 2000;

class FlowInputError extends Error {
  constructor(readonly code: FlowError) {
    super(`flow input: ${code}`);
  }
}

function fail(error: unknown): { ok: false; error: FlowError } {
  if (error instanceof FlowInputError) return { ok: false, error: error.code };
  console.error("[flow] failed:", error);
  return { ok: false, error: "failed" };
}

function cleanNote(value: unknown): string | null {
  const text = String(value ?? "").trim().slice(0, MAX_NOTE_LENGTH);
  return text || null;
}

/** The job with what the flow needs, on a still-editable case. */
async function flowJob(db: TenantDb, jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      status: true,
      waitingReason: true,
      assignedStaffId: true,
      repairCase: { select: { id: true, status: true } },
    },
  });
  if (!job) throw new FlowInputError("jobMissing");
  if (job.repairCase.status === "DELIVERED") throw new FlowInputError("caseDelivered");
  return job;
}

async function freshDto(db: TenantDb, jobId: string): Promise<JobDto> {
  const row = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: JOB_INCLUDE });
  return toJobDto(row);
}

function revalidateCase(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/"); // the board groups by exactly what just changed
}

/* ------------------------------------------------------------------ */
/* Job working transitions (brief §2).                                 */
/* ------------------------------------------------------------------ */

export async function transitionJob(
  jobId: string,
  input: { action: string; waitingReason?: string; note?: string },
): Promise<FlowResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    if (!(input.action in JOB_FLOW_ACTIONS)) throw new FlowInputError("invalidTransition");
    const action = input.action as JobFlowAction;
    const job = await flowJob(db, jobId);
    if (!canFlow(action, job.status)) throw new FlowInputError("invalidTransition");

    const note = cleanNote(input.note);
    let waitingReason: WaitingReason | null = null;
    if (action === "SET_WAITING") {
      if (!(WAITING_REASONS as readonly string[]).includes(input.waitingReason ?? "")) {
        throw new FlowInputError("reasonRequired");
      }
      waitingReason = input.waitingReason as WaitingReason;
      // Same reason again: nothing changed, nothing to record.
      if (job.status === "WAITING" && job.waitingReason === waitingReason) {
        return { ok: true, value: await freshDto(db, jobId) };
      }
    }
    if (action === "QC_FAIL" || action === "CANCEL") {
      if (!note) throw new FlowInputError("noteRequired");
    }
    if (action === "QC_PASS") {
      if (!can(session.role, "qc.signOff")) throw new FlowInputError("forbidden");
      // Never the technician who did the work (CONTEXT.md) — holds even
      // though technicians have no logins yet; Staff are promotable.
      if (job.assignedStaffId === session.staffId) throw new FlowInputError("qcOwnWork");
    }
    if (action === "CANCEL" && !can(session.role, "job.cancel")) {
      throw new FlowInputError("forbidden");
    }

    const to = JOB_FLOW_ACTIONS[action].to;
    const reasonChangeOnly = action === "SET_WAITING" && job.status === "WAITING";
    const caseId = job.repairCase.id;

    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: { status: to, waitingReason: to === "WAITING" ? waitingReason : null },
      });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId,
          type: reasonChangeOnly
            ? "JOB_WAITING_REASON_CHANGED"
            : action === "QC_PASS"
              ? "JOB_QC_PASSED"
              : action === "QC_FAIL"
                ? "JOB_QC_FAILED"
                : action === "CANCEL"
                  ? "JOB_CANCELLED"
                  : "JOB_STATUS_CHANGED",
          jobId,
          jobTitle: job.title,
          fromStatus: reasonChangeOnly ? null : job.status,
          toStatus: reasonChangeOnly ? null : to,
          waitingReason,
          note,
          actorStaffId: session.staffId,
        },
      });
      // Only completing or cancelling can empty the active set (the sources
      // of every other edge are active already).
      if (to === "COMPLETED" || to === "CANCELLED") {
        await applyCaseReadiness(tx, session.shopId, caseId, session.staffId);
      }
    });

    revalidateCase(caseId);
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Manager-only single-step revert (ruling 2): back along the path the Job
 * came, read from its own event log; itself an event. Working statuses only —
 * authorization corrections are M4's revert.
 */
export async function revertJobStep(jobId: string): Promise<FlowResult<JobDto>> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "job.revertStep")) throw new FlowInputError("forbidden");
    const job = await flowJob(db, jobId);
    if (!(REVERTIBLE_STATUSES as readonly string[]).includes(job.status)) {
      throw new FlowInputError("invalidTransition");
    }

    // The last status-bearing event tells us where the Job came from.
    const lastMove = await db.caseEvent.findFirst({
      where: { jobId, toStatus: { not: null } },
      orderBy: { at: "desc" },
      select: { fromStatus: true },
    });
    const target = lastMove?.fromStatus;
    if (!target) throw new FlowInputError("invalidTransition");

    // Reverting into WAITING restores the reason it was waiting with.
    let waitingReason: WaitingReason | null = null;
    if (target === "WAITING") {
      const lastReason = await db.caseEvent.findFirst({
        where: { jobId, waitingReason: { not: null } },
        orderBy: { at: "desc" },
        select: { waitingReason: true },
      });
      waitingReason = lastReason?.waitingReason ?? "OTHER";
    }

    const caseId = job.repairCase.id;
    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: { status: target, waitingReason },
      });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId,
          type: "JOB_REVERTED",
          jobId,
          jobTitle: job.title,
          fromStatus: job.status,
          toStatus: target,
          waitingReason,
          actorStaffId: session.staffId,
        },
      });
      // Un-completing / un-cancelling re-activates work — may revoke READY.
      if (job.status === "COMPLETED" || job.status === "CANCELLED") {
        await applyCaseReadiness(tx, session.shopId, caseId, session.staffId);
      }
    });

    revalidateCase(caseId);
    return { ok: true, value: await freshDto(db, jobId) };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */
/* Case flow (brief §4, ruling 4a/4b).                                 */
/* ------------------------------------------------------------------ */

/**
 * Explicit Mark ready — the customer-collects-anyway path for cases whose
 * work never materialized (everything Declined, or no Jobs). Cases with
 * completed work flip on their own; cases with active work are refused.
 */
export async function markCaseReady(caseId: string): Promise<FlowResult<{ status: string }>> {
  try {
    const { session, db } = await tenantContext();
    const repairCase = await db.repairCase.findUnique({
      where: { id: caseId },
      select: { id: true, status: true },
    });
    if (!repairCase) throw new FlowInputError("caseMissing");
    if (repairCase.status === "DELIVERED") throw new FlowInputError("caseDelivered");
    if (repairCase.status !== "CHECKED_IN") throw new FlowInputError("invalidTransition");

    const jobs = await db.job.findMany({ where: { caseId }, select: { status: true } });
    if (hasActiveWork(jobs)) throw new FlowInputError("activeWork");

    await db.$transaction(async (tx) => {
      await tx.repairCase.update({
        where: { id: caseId },
        data: { status: "READY", readyAt: new Date() },
      });
      await tx.caseEvent.create({
        data: { shopId: session.shopId, caseId, type: "CASE_READY", actorStaffId: session.staffId },
      });
    });

    revalidateCase(caseId);
    return { ok: true, value: { status: "READY" } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Delivery is always explicit (ruling 4b): only from READY, at handover.
 * Delivery is also the FollowUp mint point (M7 ruling 4): it freezes the
 * work record, so the candidate set — declined Jobs, never-actioned wear
 * Findings — is final, and the rows are created in the same transaction.
 */
export async function markCaseDelivered(
  caseId: string,
): Promise<FlowResult<{ status: string }>> {
  try {
    const { session, db } = await tenantContext();
    const repairCase = await db.repairCase.findUnique({
      where: { id: caseId },
      select: { id: true, status: true, contactCustomerId: true },
    });
    if (!repairCase) throw new FlowInputError("caseMissing");
    if (repairCase.status === "DELIVERED") throw new FlowInputError("caseDelivered");
    if (repairCase.status !== "READY") throw new FlowInputError("notReady");

    await db.$transaction(async (tx) => {
      await tx.repairCase.update({
        where: { id: caseId },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          deliveredByStaffId: session.staffId,
        },
      });
      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId,
          type: "CASE_DELIVERED",
          actorStaffId: session.staffId,
        },
      });
      await mintFollowUpsForCase(tx, session.shopId, caseId, repairCase.contactCustomerId);
    });

    revalidateCase(caseId);
    revalidatePath("/followups");
    return { ok: true, value: { status: "DELIVERED" } };
  } catch (error) {
    return fail(error);
  }
}
