"use server";

import { revalidatePath } from "next/cache";
import {
  isLineImageContentType,
  LINE_MAX_PHOTOS_PER_UPDATE,
  LINE_MAX_TEXT_LENGTH,
  type LineErrorCode,
  type LineMessage,
} from "@/lib/line";
import {
  deliverLineUpdate,
  lineGateFor,
  newPublicToken,
  publicOrigin,
  type LineGateError,
  type SentUpdateDto,
} from "@/lib/line-send";
import { tenantContext } from "@/lib/session";

export type { SentUpdateDto } from "@/lib/line-send";

/**
 * Sending a LINE Update (M6 brief §7) — the composer's action. The push and
 * its record live in lib/line-send.ts since M7.7, shared with Send quotation
 * (D-25); this file keeps the composer's own validation and the Follow-up
 * bookkeeping. It only ever runs because a human pressed send (ADR-003).
 *
 * Since M7 (decision 5, superseding M6's read-only line): DELIVERED cases
 * accept Updates — delivery freezes the WORK record, while money and
 * messages stay appendable, because follow-ups are mostly about delivered
 * cases. A send launched from a Follow-up marks it CONTACTED in the same
 * recording transaction — bookkeeping caused by a human's send, the
 * ADR-003-safe direction.
 */

export type SendUpdateError =
  | "caseMissing"
  | "followUpMissing"
  | LineGateError
  | "bodyRequired"
  | "bodyTooLong"
  | "tooManyPhotos"
  | "photoInvalid"
  | `line.${LineErrorCode}`
  | "failed";

export type SendUpdateResult =
  | { ok: true; value: SentUpdateDto }
  | { ok: false; error: SendUpdateError };

export async function sendLineUpdate(
  caseId: string,
  formData: FormData,
): Promise<SendUpdateResult> {
  try {
    const { session, db } = await tenantContext();

    // Browsers submit textarea content with CRLF line breaks; LINE (and our
    // own record of what was sent) should carry plain newlines.
    const bodyText = String(formData.get("body") ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (!bodyText) return { ok: false, error: "bodyRequired" };
    if (bodyText.length > LINE_MAX_TEXT_LENGTH) return { ok: false, error: "bodyTooLong" };

    const photoIds = formData
      .getAll("photoId")
      .map((value) => String(value))
      .filter(Boolean);
    if (photoIds.length > LINE_MAX_PHOTOS_PER_UPDATE) {
      return { ok: false, error: "tooManyPhotos" };
    }

    const repairCase = await db.repairCase.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        status: true,
        contactCustomer: { select: { id: true, name: true } },
      },
    });
    if (!repairCase) return { ok: false, error: "caseMissing" };

    // A send launched from the Follow-up worklist carries the row's id; a
    // stale or foreign id is refused rather than silently ignored.
    const followUpId = String(formData.get("followUpId") ?? "") || null;
    const followUp = followUpId
      ? await db.followUp.findUnique({
          where: { id: followUpId },
          select: { id: true, caseId: true, jobTitle: true },
        })
      : null;
    if (followUpId && (!followUp || followUp.caseId !== caseId)) {
      return { ok: false, error: "followUpMissing" };
    }

    const gate = await lineGateFor(db, session.shopId, repairCase.contactCustomer.id);
    if (!gate.ok) return { ok: false, error: gate.error };

    // Photos must belong to THIS case and be a format LINE will fetch.
    const photos = photoIds.length
      ? await db.photo.findMany({
          where: { id: { in: photoIds }, caseId },
          select: { id: true, contentType: true },
        })
      : [];
    if (photos.length !== photoIds.length) return { ok: false, error: "photoInvalid" };
    if (photos.some((photo) => !isLineImageContentType(photo.contentType))) {
      return { ok: false, error: "photoInvalid" };
    }

    // Keep the caller's chosen order, and mint one capability token each.
    const ordered = photoIds.map((id) => ({ photoId: id, token: newPublicToken() }));
    const origin = await publicOrigin();

    const messages: LineMessage[] = [
      { type: "text", text: bodyText },
      ...ordered.map(({ token }) => {
        const url = `${origin}/api/line/photo/${token}`;
        // Our stored photos are already downscaled (lib/downscale), so the
        // preview and the original are the same bytes.
        return { type: "image" as const, originalContentUrl: url, previewImageUrl: url };
      }),
    ];

    const delivered = await deliverLineUpdate({
      db,
      actor: { shopId: session.shopId, staffId: session.staffId },
      caseId,
      customer: repairCase.contactCustomer,
      gate: gate.value,
      bodyText,
      photos: ordered,
      quotation: null,
      messages,
      // The follow-up flips CONTACTED only when the message actually reached
      // the customer — a FAILED push leaves the worklist row untouched.
      afterRecord: async (tx, row, wasDelivered) => {
        if (!followUp || !wasDelivered) return;
        await tx.followUp.update({
          where: { id: followUp.id },
          data: {
            status: "CONTACTED",
            snoozedUntil: null,
            lastActionByStaffId: session.staffId,
            lastActionAt: new Date(),
            lastActionNote: null,
          },
        });
        await tx.caseEvent.create({
          data: {
            shopId: session.shopId,
            caseId,
            type: "FOLLOW_UP_CONTACTED",
            followUpId: followUp.id,
            jobTitle: followUp.jobTitle,
            lineUpdateId: row.id,
            actorStaffId: session.staffId,
          },
        });
      },
    });

    revalidatePath(`/cases/${caseId}`);
    if (followUp && delivered.push.ok) revalidatePath("/followups");

    if (!delivered.push.ok) return { ok: false, error: `line.${delivered.push.code}` };
    return { ok: true, value: delivered.update };
  } catch (error) {
    // If we land here AFTER a successful push, the customer has a message we
    // failed to record. Loud on purpose (M6 brief, decision 4).
    console.error("[line-update] send failed:", error);
    return { ok: false, error: "failed" };
  }
}
