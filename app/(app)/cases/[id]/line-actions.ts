"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  isLineImageContentType,
  lineTransport,
  LINE_MAX_PHOTOS_PER_UPDATE,
  LINE_MAX_TEXT_LENGTH,
  type LineErrorCode,
  type LineMessage,
} from "@/lib/line";
import { lineCryptoAvailable, openCredential } from "@/lib/line-credentials";
import { tenantContext } from "@/lib/session";

/**
 * Sending a LINE Update (M6 brief §7) — the one place in the system that
 * speaks to a customer, and it only ever runs because a human pressed send
 * (ADR-003). No caller anywhere is a status change, a cron, or an event.
 *
 * Order is deliberate and its risk is accepted (M6 brief, decision 4): a
 * LINE push cannot be rolled back, so we push FIRST and record SECOND, in one
 * small transaction. If the database fails in that window the customer has a
 * message we did not record — logged loudly, and preferable to a mutable
 * "pending" row that could not close the window either.
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
  | "notConnected"
  | "cryptoUnavailable"
  | "noIdentity"
  | "unfollowed"
  | "bodyRequired"
  | "bodyTooLong"
  | "tooManyPhotos"
  | "photoInvalid"
  | `line.${LineErrorCode}`
  | "failed";

export type SentUpdateDto = {
  id: string;
  bodyText: string;
  deliveryStatus: "SENT" | "FAILED";
  errorCode: string | null;
  recipientName: string;
  sentByName: string;
  sentAt: string;
  photoIds: string[];
};

export type SendUpdateResult =
  | { ok: true; value: SentUpdateDto }
  | { ok: false; error: SendUpdateError };

/** 128 bits — the whole authorization for a published photo (decision 3). */
function newPublicToken(): string {
  return randomBytes(16).toString("hex");
}

async function publicOrigin(): Promise<string> {
  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

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

    if (!lineCryptoAvailable()) return { ok: false, error: "cryptoUnavailable" };
    const channel = await db.shopLineChannel.findUnique({ where: { shopId: session.shopId } });
    if (!channel) return { ok: false, error: "notConnected" };

    const contact = await db.lineContact.findFirst({
      where: { customerId: repairCase.contactCustomer.id },
    });
    if (!contact) return { ok: false, error: "noIdentity" };
    if (contact.followState === "UNFOLLOWED") return { ok: false, error: "unfollowed" };

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

    const accessToken = openCredential(
      session.shopId,
      "channelAccessToken",
      channel.channelAccessTokenEnc,
    );

    // ---- the irreversible bit ----
    const push = await lineTransport.push(accessToken, contact.lineUserId, messages);

    const delivered = push.ok;
    const update = await db.$transaction(async (tx) => {
      const row = await tx.lineUpdate.create({
        data: {
          shopId: session.shopId,
          caseId,
          customerId: repairCase.contactCustomer.id,
          lineUserId: contact.lineUserId,
          recipientName: repairCase.contactCustomer.name,
          bodyText,
          deliveryStatus: delivered ? "SENT" : "FAILED",
          lineRequestId: push.requestId,
          errorCode: push.ok ? null : push.code,
          errorDetail: push.ok ? null : push.detail.slice(0, 500),
          sentByStaffId: session.staffId,
          photos: {
            // shopId comes from the parent LineUpdate via the composite FK.
            create: ordered.map(({ photoId, token }, index) => ({
              photoId,
              sortOrder: index,
              // A failed send delivered nothing, so nothing becomes public.
              publicToken: delivered ? token : null,
            })),
          },
        },
        include: {
          sentBy: { select: { name: true } },
          photos: { orderBy: { sortOrder: "asc" }, select: { photoId: true } },
        },
      });

      await tx.caseEvent.create({
        data: {
          shopId: session.shopId,
          caseId,
          type: delivered ? "LINE_UPDATE_SENT" : "LINE_UPDATE_FAILED",
          lineUpdateId: row.id,
          subjectName: repairCase.contactCustomer.name,
          note: push.ok ? null : push.detail.slice(0, 500),
          actorStaffId: session.staffId,
        },
      });

      // The follow-up flips CONTACTED only when the message actually reached
      // the customer — a FAILED push leaves the worklist row untouched.
      if (followUp && delivered) {
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
      }

      return row;
    });

    revalidatePath(`/cases/${caseId}`);
    if (followUp && delivered) revalidatePath("/followups");

    if (!push.ok) return { ok: false, error: `line.${push.code}` };
    return {
      ok: true,
      value: {
        id: update.id,
        bodyText: update.bodyText,
        deliveryStatus: update.deliveryStatus,
        errorCode: update.errorCode,
        recipientName: update.recipientName,
        sentByName: update.sentBy.name,
        sentAt: update.sentAt.toISOString(),
        photoIds: update.photos.map((photo) => photo.photoId),
      },
    };
  } catch (error) {
    // If we land here AFTER a successful push, the customer has a message we
    // failed to record. Loud on purpose (M6 brief, decision 4).
    console.error("[line-update] send failed:", error);
    return { ok: false, error: "failed" };
  }
}
