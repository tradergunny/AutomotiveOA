import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractIdentitySignals, verifyLineSignature, webhookDestination } from "@/lib/line-webhook";

/**
 * ADR-005 proof. This signature check is the entire security boundary of the
 * app's first public write path, so it is tested like one — and the
 * "identity only, never content" promise is tested on a body that HAS
 * content.
 */

const SECRET = "channel-secret-value";

function sign(body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

const followBody = JSON.stringify({
  destination: "Ubot",
  events: [
    {
      type: "follow",
      timestamp: 1700000000000,
      source: { type: "user", userId: "U1" },
    },
  ],
});

describe("webhook signature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyLineSignature(followBody, sign(followBody), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(followBody);
    const tampered = followBody.replace("U1", "U2");
    expect(verifyLineSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyLineSignature(followBody, sign(followBody, "other"), SECRET)).toBe(false);
  });

  it("rejects a missing or malformed signature", () => {
    expect(verifyLineSignature(followBody, null, SECRET)).toBe(false);
    expect(verifyLineSignature(followBody, "", SECRET)).toBe(false);
    expect(verifyLineSignature(followBody, "not-base64-of-the-right-length", SECRET)).toBe(false);
  });
});

describe("identity extraction", () => {
  it("takes the userId, kind and time from follow/unfollow/message", () => {
    const signals = extractIdentitySignals({
      events: [
        { type: "follow", timestamp: 1, source: { type: "user", userId: "U1" } },
        { type: "unfollow", timestamp: 2, source: { type: "user", userId: "U2" } },
        {
          type: "message",
          timestamp: 3,
          source: { type: "user", userId: "U3" },
          message: { type: "text", text: "รถเสร็จยังครับ" },
        },
      ],
    });
    expect(signals).toEqual([
      { lineUserId: "U1", kind: "follow", at: new Date(1) },
      { lineUserId: "U2", kind: "unfollow", at: new Date(2) },
      { lineUserId: "U3", kind: "message", at: new Date(3) },
    ]);
    // The promise that matters: nothing carries the message text onward.
    expect(JSON.stringify(signals)).not.toContain("รถเสร็จยัง");
  });

  it("drops group and room sources, unknown types, and missing ids", () => {
    expect(
      extractIdentitySignals({
        events: [
          { type: "message", timestamp: 1, source: { type: "group", groupId: "G1" } },
          { type: "join", timestamp: 2, source: { type: "user", userId: "U9" } },
          { type: "follow", timestamp: 3, source: { type: "user" } },
        ],
      }),
    ).toEqual([]);
  });

  it("survives a body that is not shaped like a webhook at all", () => {
    expect(extractIdentitySignals(null)).toEqual([]);
    expect(extractIdentitySignals({})).toEqual([]);
    expect(extractIdentitySignals({ events: "nope" })).toEqual([]);
    expect(webhookDestination({ destination: "Ubot" })).toBe("Ubot");
    expect(webhookDestination({})).toBeNull();
  });
});
