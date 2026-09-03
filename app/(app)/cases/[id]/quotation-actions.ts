"use server";

import { revalidatePath } from "next/cache";
import type { LineErrorCode } from "@/lib/line";
import { buildQuotationBody } from "@/lib/line-draft";
import {
  deliverLineUpdate,
  lineGateFor,
  newPublicToken,
  publicOrigin,
  type LineGateError,
  type SentUpdateDto,
} from "@/lib/line-send";
import { PAYER_TYPES, quotationLabel, type OfferPart, type QuotationDto } from "@/lib/jobs";
import { OfferError, stampQuotation, type OfferErrorCode } from "@/lib/offer";
import { tenantContext } from "@/lib/session";
import { QUOTATION_INCLUDE, toQuotationDto } from "./job-dto";

// Send quotation (M7.7 brief §6, D-25) — superseding M4's explicit Issue
// action. The advisor never thinks about versions: sending reuses the latest
// Quotation whose lines equal the part's priced lines at current prices,
// else snapshots a new version through the same issue path (QUOTATION_ISSUED)
// — the snapshot stays the credibility, issuing just stops being a separate
// act. A LINE send then mints the document link on first send, builds the
// Thai summary, and walks the composer's own push-first-record-second path
// (lib/line-send.ts), so the Customer Timeline and the internal timeline
// both see it. Print stamps the version and hands back the document to
// print — the insurer's part of a mixed Offer is printed, never pushed
// (CONTEXT.md: the system does not talk to insurers).

export type SendQuotationError =
  | OfferErrorCode
  | "insurerPrintOnly"
  | LineGateError
  | `line.${LineErrorCode}`
  | "failed";

export type SendQuotationResult =
  | { ok: true; value: { quotation: QuotationDto; update: SentUpdateDto | null } }
  | {
      ok: false;
      error: SendQuotationError;
      /** Set when the version was stamped before the send itself failed. */
      quotation?: QuotationDto;
    };

const MAX_TEXT_LENGTH = 300;

function parsePart(payerType: string, insurerName: unknown): OfferPart {
  if (!(PAYER_TYPES as readonly string[]).includes(payerType)) {
    throw new OfferError("invalidInput");
  }
  const name = String(insurerName ?? "").trim().slice(0, MAX_TEXT_LENGTH) || null;
  if (payerType === "INSURER" && !name) throw new OfferError("invalidInput");
  return { payerType: payerType as OfferPart["payerType"], insurerName: payerType === "INSURER" ? name : null };
}

export async function sendQuotation(
  caseId: string,
  input: { payerType: string; insurerName?: string; via: "LINE" | "PRINT" },
): Promise<SendQuotationResult> {
  let stamped: QuotationDto | undefined;
  try {
    const { session, db } = await tenantContext();
    const part = parsePart(input.payerType, input.insurerName);
    if (input.via !== "LINE" && input.via !== "PRINT") throw new OfferError("invalidInput");
    if (input.via === "LINE" && part.payerType === "INSURER") {
      return { ok: false, error: "insurerPrintOnly" };
    }
    const actor = { shopId: session.shopId, staffId: session.staffId };

    // ---- stamp the version (reuse or new) ----
    const { quotationId } = await stampQuotation(db, actor, caseId, part);
    const fresh = async () =>
      toQuotationDto(
        await db.quotation.findUniqueOrThrow({
          where: { id: quotationId },
          include: QUOTATION_INCLUDE,
        }),
      );
    stamped = await fresh();

    if (input.via === "PRINT") {
      revalidatePath(`/cases/${caseId}`);
      return { ok: true, value: { quotation: stamped, update: null } };
    }

    // ---- the LINE gate, explained rather than hidden ----
    const repairCase = await db.repairCase.findUniqueOrThrow({
      where: { id: caseId },
      select: {
        reference: true,
        vehicle: { select: { plate: true } },
        contactCustomer: { select: { id: true, name: true } },
      },
    });
    const gate = await lineGateFor(db, session.shopId, repairCase.contactCustomer.id);
    if (!gate.ok) {
      revalidatePath(`/cases/${caseId}`);
      return { ok: false, error: gate.error, quotation: stamped };
    }

    // ---- the document link: minted once, immutable like its version ----
    let token = stamped.publicToken;
    if (!token) {
      token = newPublicToken();
      await db.quotation.update({ where: { id: quotationId }, data: { publicToken: token } });
      stamped = await fresh();
    }
    const shop = await db.shop.findFirst({ select: { name: true } });
    const label = quotationLabel(stamped.number, stamped.version);
    const bodyText = buildQuotationBody({
      shopName: shop?.name ?? "",
      customerName: repairCase.contactCustomer.name,
      plate: repairCase.vehicle.plate,
      reference: repairCase.reference,
      label,
      lines: stamped.lines.map((line) => ({ title: line.title, priceSatang: line.priceSatang })),
      totalSatang: stamped.totalSatang,
      documentUrl: `${await publicOrigin()}/q/${token}`,
    });

    const delivered = await deliverLineUpdate({
      db,
      actor,
      caseId,
      customer: repairCase.contactCustomer,
      gate: gate.value,
      bodyText,
      photos: [],
      quotation: { id: quotationId, label },
      messages: [{ type: "text", text: bodyText }],
    });

    revalidatePath(`/cases/${caseId}`);
    if (!delivered.push.ok) {
      return { ok: false, error: `line.${delivered.push.code}`, quotation: stamped };
    }
    return { ok: true, value: { quotation: await fresh(), update: delivered.update } };
  } catch (error) {
    if (error instanceof OfferError) return { ok: false, error: error.code, quotation: stamped };
    // If we land here AFTER a successful push, the customer has a message we
    // failed to record. Loud on purpose (M6 brief, decision 4).
    console.error("[quotations] send failed:", error);
    return { ok: false, error: "failed", quotation: stamped };
  }
}
