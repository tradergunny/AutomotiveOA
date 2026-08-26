import { headers } from "next/headers";
import { lineCryptoAvailable } from "@/lib/line-credentials";
import { lineTransport } from "@/lib/line";
import { can } from "@/lib/permissions";
import { requireSession, tenantDb } from "@/lib/session";
import { CONTACT_INCLUDE, toContactDto } from "./contact-dto";
import { LineSettings } from "./line-settings";

// Settings (M6 brief §2 + §4): connect the Shop's own LINE OA (ADR-002) and
// link the LINE identities its webhook captured to Customers (ADR-005).
// Connecting is Manager-only and server-enforced in ./actions.ts; Advisors
// read the connection and do the day-to-day linking.
export default async function SettingsPage() {
  const [session, db, headerList] = await Promise.all([requireSession(), tenantDb(), headers()]);

  const [channel, contacts] = await Promise.all([
    db.shopLineChannel.findUnique({
      where: { shopId: session.shopId },
      include: { connectedBy: { select: { name: true } } },
    }),
    db.lineContact.findMany({
      include: CONTACT_INCLUDE,
      orderBy: [{ customerId: "asc" }, { lastEventAt: "desc" }],
    }),
  ]);

  // The webhook URL the owner pastes into the LINE Developers console. Built
  // from the live request so it is correct in dev, on staging, and in
  // production without another env var to keep in sync.
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("host") ?? "localhost:3000";
  const webhookUrl = `${proto}://${host}/api/line/webhook/${session.shopId}`;

  return (
    <LineSettings
      initialChannel={
        channel
          ? {
              connected: true,
              botDisplayName: channel.botDisplayName,
              botBasicId: channel.botBasicId,
              botUserId: channel.botUserId,
              verifiedAt: channel.verifiedAt?.toISOString() ?? null,
              connectedByName: channel.connectedBy.name,
              secretFingerprint: `••••${channel.channelSecretEnc.slice(-4)}`,
              tokenFingerprint: `••••${channel.channelAccessTokenEnc.slice(-4)}`,
            }
          : null
      }
      initialContacts={contacts.map(toContactDto)}
      webhookUrl={webhookUrl}
      canManage={can(session.role, "line.manageChannel")}
      cryptoAvailable={lineCryptoAvailable()}
      transportMode={lineTransport.mode}
    />
  );
}
