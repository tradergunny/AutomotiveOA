import { beforeEach, describe, expect, it } from "vitest";
import {
  credentialFingerprint,
  lineCryptoAvailable,
  openCredential,
  sealCredential,
} from "@/lib/line-credentials";

/**
 * ADR-004 proof. The cipher is standard; what needs testing is the part that
 * is ours: that an envelope is bound to ONE shop and ONE field, that a
 * tampered or wrongly-keyed envelope fails closed rather than half-opening,
 * and that a missing key is a clear error instead of a silent plaintext path.
 */

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

beforeEach(() => {
  process.env.LINE_CREDENTIALS_KEY = KEY_A;
  delete process.env.LINE_CREDENTIALS_KEY_PREVIOUS;
});

describe("line credential envelopes", () => {
  it("round-trips a credential", () => {
    const sealed = sealCredential("shop1", "channelAccessToken", "super-secret-token");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("super-secret-token");
    expect(openCredential("shop1", "channelAccessToken", sealed)).toBe("super-secret-token");
  });

  it("produces a different envelope every time (random IV)", () => {
    const a = sealCredential("shop1", "channelSecret", "same");
    const b = sealCredential("shop1", "channelSecret", "same");
    expect(a).not.toBe(b);
    expect(openCredential("shop1", "channelSecret", a)).toBe("same");
    expect(openCredential("shop1", "channelSecret", b)).toBe("same");
  });

  it("refuses to open another shop's envelope", () => {
    const sealed = sealCredential("shop1", "channelSecret", "s3cr3t");
    expect(() => openCredential("shop2", "channelSecret", sealed)).toThrow(/could not be decrypted/);
  });

  it("refuses to open the wrong field's envelope", () => {
    const sealed = sealCredential("shop1", "channelSecret", "s3cr3t");
    expect(() => openCredential("shop1", "channelAccessToken", sealed)).toThrow(
      /could not be decrypted/,
    );
  });

  it("refuses a tampered ciphertext", () => {
    const sealed = sealCredential("shop1", "channelSecret", "s3cr3t");
    const parts = sealed.split(":");
    const bytes = Buffer.from(parts[3]!, "base64url");
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], bytes.toString("base64url")].join(":");
    expect(() => openCredential("shop1", "channelSecret", tampered)).toThrow();
  });

  it("refuses a wrong key, and accepts the rotation fallback", () => {
    const sealed = sealCredential("shop1", "channelSecret", "s3cr3t");
    process.env.LINE_CREDENTIALS_KEY = KEY_B;
    expect(() => openCredential("shop1", "channelSecret", sealed)).toThrow();
    process.env.LINE_CREDENTIALS_KEY_PREVIOUS = KEY_A;
    expect(openCredential("shop1", "channelSecret", sealed)).toBe("s3cr3t");
  });

  it("reports a missing or malformed key instead of encrypting anyway", () => {
    delete process.env.LINE_CREDENTIALS_KEY;
    expect(lineCryptoAvailable()).toBe(false);
    expect(() => sealCredential("shop1", "channelSecret", "x")).toThrow(/missing or not 32/);

    process.env.LINE_CREDENTIALS_KEY = "too-short";
    expect(lineCryptoAvailable()).toBe(false);
    expect(() => sealCredential("shop1", "channelSecret", "x")).toThrow(/missing or not 32/);
  });

  it("rejects an unrecognized envelope shape", () => {
    expect(() => openCredential("shop1", "channelSecret", "plaintext")).toThrow(/unrecognized/);
    expect(() => openCredential("shop1", "channelSecret", "v2:a:b:c")).toThrow(/unrecognized/);
  });

  it("fingerprints without revealing the value", () => {
    expect(credentialFingerprint("abcdefghij")).toBe("••••ghij");
  });
});
