"use server";

import { revalidatePath } from "next/cache";
import { tenantContext } from "@/lib/session";
import type { CaseEventType } from "@/lib/generated/prisma/enums";
import { FOLLOW_UP_INCLUDE, toFollowUpDto, type FollowUpDto } from "./followup-dto";

/**
 * Follow-up worklist actions (M7 brief §5, decision 4 — ruled by the
 * founder). The FollowUp row is mutable worklist state; history lands where
 * history lives: every transition writes its typed CaseEvent on the source
 * case in the same transaction (the M5 one-table ruling — chasing is
 * operational). The LINE path lives in the case page's send pipeline
 * (line-actions.ts), which marks CONTACTED on a successful send; the
 * actions here are the by-hand paths — phone contact, snooze, drop, reopen.
 * Nothing here sends anything (ADR-003).
 */

export type FollowUpError = "missing" | "dateInvalid" | "reasonRequired" | "failed";

export type FollowUpActionResult =
  | { ok: true; value: FollowUpDto }
  | { ok: false; error: FollowUpError };

const MAX_NOTE_LENGTH = 2000;

class FollowUpInputError extends Error {
  constructor(readonly code: FollowUpError) {
    super(`follow-up input: ${code}`);
  }
}

function fail(error: unknown): { ok: false; error: FollowUpError } {
  if (error instanceof FollowUpInputError) return { ok: false, error: error.code };
  console.error("[followups] failed:", error);
  return { ok: false, error: "failed" };
}

function cleanNote(value: unknown): string | null {
  const text = String(value ?? "").trim().slice(0, MAX_NOTE_LENGTH);
  return text || null;
}

/** One transition: update the row + its typed CaseEvent, atomically. */
async function transition(
  followUpId: string,
  input: {
    status: "OPEN" | "SNOOZED" | "CONTACTED" | "DROPPED";
    eventType: CaseEventType;
    snoozedUntil?: Date | null;
    note?: string | null;
  },
): Promise<FollowUpActionResult> {
  const { session, db } = await tenantContext();

  const followUp = await db.followUp.findUnique({
    where: { id: followUpId },
    select: { id: true, caseId: true, status: true, jobTitle: true },
  });
  if (!followUp) throw new FollowUpInputError("missing");

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.followUp.update({
      where: { id: followUpId },
      data: {
        status: input.status,
        snoozedUntil: input.snoozedUntil ?? null,
        lastActionByStaffId: session.staffId,
        lastActionAt: new Date(),
        lastActionNote: input.note ?? null,
      },
      include: FOLLOW_UP_INCLUDE,
    });
    await tx.caseEvent.create({
      data: {
        shopId: session.shopId,
        caseId: followUp.caseId,
        type: input.eventType,
        followUpId,
        jobTitle: followUp.jobTitle,
        snoozedUntil: input.snoozedUntil ?? null,
        note: input.note ?? null,
        actorStaffId: session.staffId,
      },
    });
    return row;
  });

  revalidatePath("/followups");
  revalidatePath(`/cases/${followUp.caseId}`);
  return { ok: true, value: toFollowUpDto(updated) };
}

/** The phone path — a send from the composer marks CONTACTED by itself. */
export async function markFollowUpContacted(
  followUpId: string,
  note?: string,
): Promise<FollowUpActionResult> {
  try {
    return await transition(followUpId, {
      status: "CONTACTED",
      eventType: "FOLLOW_UP_CONTACTED",
      note: cleanNote(note),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function snoozeFollowUp(
  followUpId: string,
  until: string, // yyyy-mm-dd
): Promise<FollowUpActionResult> {
  try {
    const snoozedUntil = new Date(`${until}T00:00:00Z`);
    if (!until || Number.isNaN(snoozedUntil.getTime())) {
      throw new FollowUpInputError("dateInvalid");
    }
    return await transition(followUpId, {
      status: "SNOOZED",
      eventType: "FOLLOW_UP_SNOOZED",
      snoozedUntil,
    });
  } catch (error) {
    return fail(error);
  }
}

/** Won't chase — reason required, and the row stays visible under Dropped. */
export async function dropFollowUp(
  followUpId: string,
  reason: string,
): Promise<FollowUpActionResult> {
  try {
    const note = cleanNote(reason);
    if (!note) throw new FollowUpInputError("reasonRequired");
    return await transition(followUpId, {
      status: "DROPPED",
      eventType: "FOLLOW_UP_DROPPED",
      note,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function reopenFollowUp(followUpId: string): Promise<FollowUpActionResult> {
  try {
    return await transition(followUpId, {
      status: "OPEN",
      eventType: "FOLLOW_UP_REOPENED",
    });
  } catch (error) {
    return fail(error);
  }
}
