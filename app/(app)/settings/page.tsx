import { headers } from "next/headers";
import { lineCryptoAvailable } from "@/lib/line-credentials";
import { lineTransport } from "@/lib/line";
import { can } from "@/lib/permissions";
import { requireSession, tenantDb } from "@/lib/session";
import { ArrivalSettings } from "./arrival-settings";
import { CONTACT_INCLUDE, toContactDto } from "./contact-dto";
import { LineSettings } from "./line-settings";

// Settings (M6 brief §2 + §4): connect the Shop's own LINE OA (ADR-002) and
// link the LINE identities its webhook captured to Customers (ADR-005).
// Connecting is Manager-only and server-enforced in ./actions.ts; Advisors
// read the connection and do the day-to-day linking. M7.8 adds the Arrivals
// panel beneath: the public form's rotatable key and the LINE door's two
// plain values (ADR-006), Manager-only on the same terms.
export default async function SettingsPage() {
  const [session, db, headerList] = await Promise.all([requireSession(), tenantDb(), headers()]);

  const [channel, contacts, shop] = await Promise.all([
    db.shopLineChannel.findUnique({
      where: { shopId: session.shopId },
      include: { connectedBy: { select: { name: true } } },
    }),
    db.lineContact.findMany({
      include: CONTACT_INCLUDE,
      orderBy: [{ customerId: "asc" }, { lastEventAt: "desc" }],
    }),
    db.shop.findUniqueOrThrow({
      where: { id: session.shopId },
      select: { arrivalToken: true, arrivalTokenRotatedAt: true },
    }),
  ]);

  // The webhook URL the owner pastes into the LINE Developers console. Built
  // from the live request so it is correct in dev, on staging, and in
  // production without another env var to keep in sync.
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;
  const webhookUrl = `${origin}/api/line/webhook/${session.shopId}`;
  const canManage = can(session.role, "line.manageChannel");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
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
        canManage={canManage}
        cryptoAvailable={lineCryptoAvailable()}
        transportMode={lineTransport.mode}
      />
      <ArrivalSettings
        initialForm={{
          token: shop.arrivalToken,
          rotatedAt: shop.arrivalTokenRotatedAt?.toISOString() ?? null,
        }}
        initialLiff={channel ? { liffId: channel.liffId, loginChannelId: channel.loginChannelId } : null}
        origin={origin}
        channelConnected={channel != null}
        canManage={canManage}
      />
    </div>
  );
}
