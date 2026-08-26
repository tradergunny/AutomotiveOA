/**
 * Simulate an inbound LINE webhook (M6 brief, decision 5).
 *
 * The whole identity half of M6 depends on events LINE sends us — which means
 * that without this script, verifying it needs a real Official Account and a
 * public tunnel. Instead: build a webhook body, sign it with the connected
 * Shop's own channel secret (decrypted through lib/line-credentials, so the
 * encryption path is exercised too), and POST it at the dev server.
 *
 *   npm run line:simulate -- follow
 *   npm run line:simulate -- message
 *   npm run line:simulate -- unfollow
 *   npm run line:simulate -- follow --user U0000000000000000000000000000dead
 *
 * No Official Account, no tunnel, no message fees.
 */
import "./load-env"; // must come first — see that file
import { createHmac } from "node:crypto";
import { prismaUnscoped } from "../lib/db";
import { openCredential } from "../lib/line-credentials";

type Kind = "follow" | "unfollow" | "message";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const kind = (process.argv[2] ?? "follow") as Kind;
  if (!["follow", "unfollow", "message"].includes(kind)) {
    throw new Error(`unknown event kind "${kind}" — use follow | unfollow | message`);
  }

  const baseUrl = arg("url") ?? process.env.LINE_SIMULATE_URL ?? "http://localhost:3000";
  const lineUserId = arg("user") ?? "U00000000000000000000000000000001";

  const channel = await prismaUnscoped.shopLineChannel.findFirst({
    select: { shopId: true, channelSecretEnc: true, shop: { select: { name: true } } },
  });
  if (!channel) {
    throw new Error(
      "no Shop has connected a LINE channel yet — connect one in /settings first",
    );
  }
  const channelSecret = openCredential(channel.shopId, "channelSecret", channel.channelSecretEnc);

  const body = JSON.stringify({
    destination: "Ufake0000000000000000000000000000",
    events: [
      {
        type: kind,
        mode: "active",
        timestamp: Date.now(),
        webhookEventId: `sim-${Date.now()}`,
        source: { type: "user", userId: lineUserId },
        // A message event carries content in reality. We include a token one
        // so the route's "identity only" promise is exercised against a body
        // that HAS text — and nothing about it is ever stored.
        ...(kind === "message"
          ? { message: { id: "sim", type: "text", text: "สวัสดีครับ รถเสร็จยัง" } }
          : {}),
      },
    ],
  });

  const signature = createHmac("sha256", channelSecret).update(body, "utf8").digest("base64");
  const url = `${baseUrl}/api/line/webhook/${channel.shopId}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-line-signature": signature },
    body,
  });

  console.log(`${kind} → ${url}`);
  console.log(`shop: ${channel.shop.name} · user: ${lineUserId}`);
  console.log(`HTTP ${response.status} ${response.statusText}`);
  if (!response.ok) console.log(await response.text());
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prismaUnscoped.$disconnect());
