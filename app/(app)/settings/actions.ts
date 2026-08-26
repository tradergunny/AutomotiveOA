"use server";

import { revalidatePath } from "next/cache";
import { lineTransport, type LineErrorCode } from "@/lib/line";
import {
  credentialFingerprint,
  lineCryptoAvailable,
  openCredential,
  sealCredential,
} from "@/lib/line-credentials";
import { normalizePhone } from "@/lib/normalize";
import { can } from "@/lib/permissions";
import { tenantContext } from "@/lib/session";
import type { TenantDb } from "@/lib/tenant";
import { CONTACT_INCLUDE, toContactDto, type LineContactDto } from "./contact-dto";

/**
 * Connecting the Shop's own LINE OA (ADR-002) and linking LINE identities to
 * Customers (ADR-005).
 *
 * Credentials arrive here in plaintext exactly once, are verified against
 * LINE, and are sealed by lib/line-credentials before they touch the
 * database (ADR-004). Nothing in this file returns a credential — the DTOs
 * below carry a fingerprint and the OA's public identity, never a value.
 */

export type LineChannelDto = {
  connected: true;
  botDisplayName: string | null;
  botBasicId: string | null;
  botUserId: string | null;
  verifiedAt: string | null;
  connectedByName: string;
  secretFingerprint: string;
  tokenFingerprint: string;
};

export type LineSettingsError =
  | "forbidden"
  | "cryptoUnavailable"
  | "secretRequired"
  | "tokenRequired"
  | "userIdInvalid"
  | "userIdTaken"
  | "notConnected"
  | "contactMissing"
  | "customerMissing"
  | "customerTaken"
  | "phoneInvalid"
  | `line.${LineErrorCode}`
  | "failed";

export type LineSettingsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: LineSettingsError };

const MAX_CREDENTIAL_LENGTH = 4000;
/** LINE user ids are "U" + 32 hex characters. */
const LINE_USER_ID = /^U[0-9a-f]{32}$/;

function readCredential(formData: FormData, field: string): string {
  return String(formData.get(field) ?? "").trim().slice(0, MAX_CREDENTIAL_LENGTH);
}

async function channelDto(db: TenantDb, shopId: string): Promise<LineChannelDto | null> {
  const channel = await db.shopLineChannel.findUnique({
    where: { shopId },
    include: { connectedBy: { select: { name: true } } },
  });
  if (!channel) return null;
  return {
    connected: true,
    botDisplayName: channel.botDisplayName,
    botBasicId: channel.botBasicId,
    botUserId: channel.botUserId,
    verifiedAt: channel.verifiedAt?.toISOString() ?? null,
    connectedByName: channel.connectedBy.name,
    // Fingerprints come from the SEALED value, so no plaintext is opened just
    // to render the settings screen.
    secretFingerprint: credentialFingerprint(channel.channelSecretEnc),
    tokenFingerprint: credentialFingerprint(channel.channelAccessTokenEnc),
  };
}

/**
 * Connect (or replace) the Shop's channel. The credentials are proven against
 * LINE first — a token that cannot call GET /v2/bot/info is not stored.
 */
export async function connectLineChannel(
  formData: FormData,
): Promise<LineSettingsResult<LineChannelDto>> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "line.manageChannel")) return { ok: false, error: "forbidden" };
    if (!lineCryptoAvailable()) return { ok: false, error: "cryptoUnavailable" };

    const channelSecret = readCredential(formData, "channelSecret");
    if (!channelSecret) return { ok: false, error: "secretRequired" };
    const accessToken = readCredential(formData, "channelAccessToken");
    if (!accessToken) return { ok: false, error: "tokenRequired" };

    const info = await lineTransport.getBotInfo(accessToken);
    if (!info.ok) return { ok: false, error: `line.${info.code}` };

    const data = {
      channelSecretEnc: sealCredential(session.shopId, "channelSecret", channelSecret),
      channelAccessTokenEnc: sealCredential(
        session.shopId,
        "channelAccessToken",
        accessToken,
      ),
      botUserId: info.value.userId,
      botBasicId: info.value.basicId,
      botDisplayName: info.value.displayName,
      botPictureUrl: info.value.pictureUrl,
      verifiedAt: new Date(),
      connectedByStaffId: session.staffId,
    };

    await db.shopLineChannel.upsert({
      where: { shopId: session.shopId },
      create: { shopId: session.shopId, ...data },
      update: data,
    });

    revalidatePath("/settings");
    const dto = await channelDto(db, session.shopId);
    return dto ? { ok: true, value: dto } : { ok: false, error: "failed" };
  } catch (error) {
    console.error("[line-settings] connect failed:", error);
    return { ok: false, error: "failed" };
  }
}

/** Re-prove the stored credentials and refresh the cached OA identity. */
export async function verifyLineChannel(): Promise<LineSettingsResult<LineChannelDto>> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "line.manageChannel")) return { ok: false, error: "forbidden" };

    const channel = await db.shopLineChannel.findUnique({ where: { shopId: session.shopId } });
    if (!channel) return { ok: false, error: "notConnected" };

    const accessToken = openCredential(
      session.shopId,
      "channelAccessToken",
      channel.channelAccessTokenEnc,
    );
    const info = await lineTransport.getBotInfo(accessToken);
    if (!info.ok) return { ok: false, error: `line.${info.code}` };

    await db.shopLineChannel.update({
      where: { shopId: session.shopId },
      data: {
        botUserId: info.value.userId,
        botBasicId: info.value.basicId,
        botDisplayName: info.value.displayName,
        botPictureUrl: info.value.pictureUrl,
        verifiedAt: new Date(),
      },
    });

    revalidatePath("/settings");
    const dto = await channelDto(db, session.shopId);
    return dto ? { ok: true, value: dto } : { ok: false, error: "failed" };
  } catch (error) {
    console.error("[line-settings] verify failed:", error);
    return { ok: false, error: "failed" };
  }
}

/**
 * Disconnect: the credentials go, the LineContacts and the sent-Update
 * history stay. Reconnecting the same OA picks the same identities back up.
 */
export async function disconnectLineChannel(): Promise<LineSettingsResult<null>> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "line.manageChannel")) return { ok: false, error: "forbidden" };

    await db.shopLineChannel.deleteMany({ where: { shopId: session.shopId } });
    revalidatePath("/settings");
    return { ok: true, value: null };
  } catch (error) {
    console.error("[line-settings] disconnect failed:", error);
    return { ok: false, error: "failed" };
  }
}

/**
 * The Manager-only escape hatch (ADR-005): a userId the shop already knows.
 * Not a customer-facing path — customers cannot see their own userId — but it
 * makes a real OA testable before anyone has friended it.
 */
export async function captureLineUserId(
  formData: FormData,
): Promise<LineSettingsResult<LineContactDto>> {
  try {
    const { session, db } = await tenantContext();
    if (!can(session.role, "line.manageChannel")) return { ok: false, error: "forbidden" };

    const lineUserId = String(formData.get("lineUserId") ?? "").trim();
    if (!LINE_USER_ID.test(lineUserId)) return { ok: false, error: "userIdInvalid" };

    const existing = await db.lineContact.findFirst({ where: { lineUserId } });
    if (existing) return { ok: false, error: "userIdTaken" };

    const contact = await db.lineContact.create({
      data: { shopId: session.shopId, lineUserId },
      include: CONTACT_INCLUDE,
    });
    revalidatePath("/settings");
    return { ok: true, value: toContactDto(contact) };
  } catch (error) {
    console.error("[line-settings] capture failed:", error);
    return { ok: false, error: "failed" };
  }
}

/** Phone lookup for the link flow — the same key check-in uses (CONTEXT.md). */
export async function lookupCustomerForLink(
  phoneRaw: string,
): Promise<LineSettingsResult<{ id: string; name: string; phone: string } | null>> {
  try {
    const { db } = await tenantContext();
    const phone = normalizePhone(phoneRaw);
    if (phone.length < 4) return { ok: false, error: "phoneInvalid" };
    const customer = await db.customer.findFirst({
      where: { phone: { startsWith: phone } },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    });
    return { ok: true, value: customer };
  } catch (error) {
    console.error("[line-settings] lookup failed:", error);
    return { ok: false, error: "failed" };
  }
}

/**
 * Record the link (or its removal) on the internal timeline of every case
 * this Customer is still the contact for — M5's rule that every operational
 * event becomes a CaseEvent, and the answer to "who connected this, and
 * when?". Delivered cases are closed for writes and are left alone.
 */
async function logIdentityEvent(
  db: TenantDb,
  input: {
    shopId: string;
    customerId: string;
    actorStaffId: string;
    type: "LINE_CUSTOMER_LINKED" | "LINE_CUSTOMER_UNLINKED";
    subjectName: string | null;
  },
) {
  const cases = await db.repairCase.findMany({
    where: { contactCustomerId: input.customerId, status: { not: "DELIVERED" } },
    select: { id: true },
  });
  if (cases.length === 0) return;
  await db.caseEvent.createMany({
    data: cases.map((row) => ({
      shopId: input.shopId,
      caseId: row.id,
      type: input.type,
      subjectName: input.subjectName,
      actorStaffId: input.actorStaffId,
    })),
  });
  for (const row of cases) revalidatePath(`/cases/${row.id}`);
}

export async function linkLineContact(
  contactId: string,
  customerId: string,
): Promise<LineSettingsResult<LineContactDto>> {
  try {
    const { session, db } = await tenantContext();

    const [contact, customer] = await Promise.all([
      db.lineContact.findUnique({ where: { id: contactId } }),
      db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } }),
    ]);
    if (!contact) return { ok: false, error: "contactMissing" };
    if (!customer) return { ok: false, error: "customerMissing" };

    // One linked contact per Customer (schema-enforced): relinking replaces,
    // and the replacement is recorded like any other change.
    const previous = await db.lineContact.findFirst({
      where: { customerId, NOT: { id: contactId } },
    });
    if (previous) {
      await db.lineContact.update({
        where: { id: previous.id },
        data: { customerId: null, linkedByStaffId: null, linkedAt: null },
      });
      await logIdentityEvent(db, {
        shopId: session.shopId,
        customerId,
        actorStaffId: session.staffId,
        type: "LINE_CUSTOMER_UNLINKED",
        subjectName: previous.displayName,
      });
    }

    const updated = await db.lineContact.update({
      where: { id: contactId },
      data: { customerId, linkedByStaffId: session.staffId, linkedAt: new Date() },
      include: CONTACT_INCLUDE,
    });

    await logIdentityEvent(db, {
      shopId: session.shopId,
      customerId,
      actorStaffId: session.staffId,
      type: "LINE_CUSTOMER_LINKED",
      subjectName: updated.displayName,
    });

    revalidatePath("/settings");
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, value: toContactDto(updated) };
  } catch (error) {
    console.error("[line-settings] link failed:", error);
    return { ok: false, error: "failed" };
  }
}

export async function unlinkLineContact(
  contactId: string,
): Promise<LineSettingsResult<LineContactDto>> {
  try {
    const { session, db } = await tenantContext();
    const contact = await db.lineContact.findUnique({ where: { id: contactId } });
    if (!contact) return { ok: false, error: "contactMissing" };

    const updated = await db.lineContact.update({
      where: { id: contactId },
      data: { customerId: null, linkedByStaffId: null, linkedAt: null },
      include: CONTACT_INCLUDE,
    });

    if (contact.customerId) {
      await logIdentityEvent(db, {
        shopId: session.shopId,
        customerId: contact.customerId,
        actorStaffId: session.staffId,
        type: "LINE_CUSTOMER_UNLINKED",
        subjectName: contact.displayName,
      });
      revalidatePath(`/customers/${contact.customerId}`);
    }

    revalidatePath("/settings");
    return { ok: true, value: toContactDto(updated) };
  } catch (error) {
    console.error("[line-settings] unlink failed:", error);
    return { ok: false, error: "failed" };
  }
}
