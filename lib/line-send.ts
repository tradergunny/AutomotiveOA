import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { lineTransport, type LineErrorCode, type LineMessage } from "@/lib/line";
import { lineCryptoAvailable, openCredential } from "@/lib/line-credentials";
import type { FlowTx } from "@/lib/case-flow";
import type { TenantDb } from "@/lib/tenant";

/**
 * The one place in the system that speaks to a customer (M6 brief §7,
 * ADR-003), factored out of the composer's action in M7.7 so that Send
 * quotation (D-25) walks exactly the same path: the same gate, the same
 * push-first-record-second order, the same LineUpdate row and CaseEvent.
 * Both callers are server actions a human pressed; nothing here is ever
 * reached by a status change, a cron, or an event.
 *
 * Order is deliberate and its risk is accepted (M6 brief, decision 4): a
 * LINE push cannot be rolled back, so we push FIRST and record SECOND, in one
 * small transaction. If the database fails in that window the customer has a
 * message we did not record — logged loudly, and preferable to a mutable
 * "pending" row that could not close the window either.
 */

export type LineGateError = "notConnected" | "cryptoUnavailable" | "noIdentity" | "unfollowed";

export type LineGate = {
  accessToken: string;
  contact: { lineUserId: string };
};

/** 128 bits — the whole authorization for a published photo or document. */
export function newPublicToken(): string {
  return randomBytes(16).toString("hex");
}

export async function publicOrigin(): Promise<string> {
  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Whether this shop can reach this customer at all: a connected channel
 * whose credentials can be opened, and a linked LINE identity that still
 * follows the OA. Each blocked reason is a normal, explained state.
 */
export async function lineGateFor(
  db: TenantDb,
  shopId: string,
  customerId: string,
): Promise<{ ok: true; value: LineGate } | { ok: false; error: LineGateError }> {
  if (!lineCryptoAvailable()) return { ok: false, error: "cryptoUnavailable" };
  const channel = await db.shopLineChannel.findUnique({ where: { shopId } });
  if (!channel) return { ok: false, error: "notConnected" };
  const contact = await db.lineContact.findFirst({ where: { customerId } });
  if (!contact) return { ok: false, error: "noIdentity" };
  if (contact.followState === "UNFOLLOWED") return { ok: false, error: "unfollowed" };
  const accessToken = openCredential(shopId, "channelAccessToken", channel.channelAccessTokenEnc);
  return { ok: true, value: { accessToken, contact: { lineUserId: contact.lineUserId } } };
}

export type SentUpdateDto = {
  id: string;
  bodyText: string;
  deliveryStatus: "SENT" | "FAILED";
  errorCode: string | null;
  recipientName: string;
  sentByName: string;
  sentAt: string;
  photoIds: string[];
  /** The Quotation this Update carried, when Send quotation sent it (M7.7). */
  quotationLabel: string | null;
};

export type DeliverInput = {
  db: TenantDb;
  actor: { shopId: string; staffId: string };
  caseId: string;
  customer: { id: string; name: string };
  gate: LineGate;
  bodyText: string;
  /** Photo ids in send order, each with its freshly minted token. */
  photos: { photoId: string; token: string }[];
  quotation: { id: string; label: string } | null;
  messages: LineMessage[];
  /** Extra bookkeeping in the recording transaction (a Follow-up flip). */
  afterRecord?: (tx: FlowTx, update: { id: string }, delivered: boolean) => Promise<void>;
};

export type DeliverResult = {
  update: SentUpdateDto;
  push: { ok: true } | { ok: false; code: LineErrorCode };
};

/** Push, then record — the irreversible bit and its immutable record. */
export async function deliverLineUpdate(input: DeliverInput): Promise<DeliverResult> {
  const { db, actor, caseId, customer, gate } = input;

  // ---- the irreversible bit ----
  const push = await lineTransport.push(gate.accessToken, gate.contact.lineUserId, input.messages);
  const delivered = push.ok;

  const update = await db.$transaction(async (tx) => {
    const row = await tx.lineUpdate.create({
      data: {
        shopId: actor.shopId,
        caseId,
        customerId: customer.id,
        lineUserId: gate.contact.lineUserId,
        recipientName: customer.name,
        bodyText: input.bodyText,
        deliveryStatus: delivered ? "SENT" : "FAILED",
        lineRequestId: push.requestId,
        errorCode: push.ok ? null : push.code,
        errorDetail: push.ok ? null : push.detail.slice(0, 500),
        quotationId: input.quotation?.id ?? null,
        sentByStaffId: actor.staffId,
        photos: {
          // shopId comes from the parent LineUpdate via the composite FK.
          create: input.photos.map(({ photoId, token }, index) => ({
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
        shopId: actor.shopId,
        caseId,
        type: delivered ? "LINE_UPDATE_SENT" : "LINE_UPDATE_FAILED",
        lineUpdateId: row.id,
        subjectName: customer.name,
        note: push.ok ? null : push.detail.slice(0, 500),
        actorStaffId: actor.staffId,
      },
    });

    if (input.afterRecord) await input.afterRecord(tx, row, delivered);
    return row;
  });

  return {
    update: {
      id: update.id,
      bodyText: update.bodyText,
      deliveryStatus: update.deliveryStatus,
      errorCode: update.errorCode,
      recipientName: update.recipientName,
      sentByName: update.sentBy.name,
      sentAt: update.sentAt.toISOString(),
      photoIds: update.photos.map((photo) => photo.photoId),
      quotationLabel: input.quotation?.label ?? null,
    },
    push: push.ok ? { ok: true } : { ok: false, code: push.code },
  };
}
