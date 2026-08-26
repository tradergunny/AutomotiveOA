import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * LINE channel-credential encryption (ADR-004).
 *
 * The Shop's channel secret and access token are the two things that could
 * message a garage's entire customer list under its own brand, so they never
 * sit in the database in the clear. AES-256-GCM envelopes; the key is 32
 * random bytes in LINE_CREDENTIALS_KEY — the same trust tier as AUTH_SECRET
 * and DATABASE_URL, which already live in the environment.
 *
 * AAD binds every envelope to its Shop AND field, so a ciphertext lifted out
 * of one Shop's row fails to open in another's — ADR-001's same-shop
 * composite-FK reflex, applied to bytes.
 *
 * This module is the ONLY place plaintext exists. Nothing here may be called
 * from a client component, returned in a DTO, or logged. A missing or
 * malformed key disables LINE features (see lineCryptoStatus) instead of
 * crashing the app: a fresh clone with no key still boots.
 *
 * Rotation is additive by construction: the "v1" version tag plus
 * LINE_CREDENTIALS_KEY_PREVIOUS as a read-only fallback while re-encrypting.
 * The procedure itself belongs to M8's deploy guide.
 */

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type CredentialField = "channelSecret" | "channelAccessToken";

export class LineCryptoError extends Error {
  constructor(message: string) {
    super(`[line-crypto] ${message}`);
    this.name = "LineCryptoError";
  }
}

function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    return null;
  }
  return key.length === KEY_BYTES ? key : null;
}

/** Current key first, then the rotation fallback (decrypt-only). */
function keyring(): Buffer[] {
  return [
    parseKey(process.env.LINE_CREDENTIALS_KEY),
    parseKey(process.env.LINE_CREDENTIALS_KEY_PREVIOUS),
  ].filter((key): key is Buffer => key !== null);
}

/**
 * Whether LINE features can work at all. The settings screen calls this to
 * explain itself rather than letting a save blow up at the last moment.
 */
export function lineCryptoAvailable(): boolean {
  return parseKey(process.env.LINE_CREDENTIALS_KEY) !== null;
}

function aad(shopId: string, field: CredentialField): Buffer {
  return Buffer.from(`${shopId}:${field}`, "utf8");
}

/** Encrypt one credential for one Shop. Returns the storable envelope. */
export function sealCredential(
  shopId: string,
  field: CredentialField,
  plaintext: string,
): string {
  const key = parseKey(process.env.LINE_CREDENTIALS_KEY);
  if (!key) {
    throw new LineCryptoError("LINE_CREDENTIALS_KEY is missing or not 32 base64 bytes");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(shopId, field));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt one credential. Throws on a wrong key, a tampered envelope, or a
 * ciphertext belonging to a different Shop or field — GCM's auth tag and the
 * AAD do that work; there is no "probably fine" path.
 */
export function openCredential(
  shopId: string,
  field: CredentialField,
  envelope: string,
): string {
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new LineCryptoError("unrecognized credential envelope");
  }
  const [, ivPart, tagPart, ctPart] = parts;
  const iv = Buffer.from(ivPart!, "base64url");
  const tag = Buffer.from(tagPart!, "base64url");
  const ciphertext = Buffer.from(ctPart!, "base64url");

  const keys = keyring();
  if (keys.length === 0) {
    throw new LineCryptoError("LINE_CREDENTIALS_KEY is missing or not 32 base64 bytes");
  }
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aad(shopId, field));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // wrong key (or a real tamper) — try the rotation fallback, then fail
    }
  }
  throw new LineCryptoError("credential could not be decrypted with any configured key");
}

/**
 * What the settings screen shows instead of the value: enough to tell two
 * pasted tokens apart, useless to anyone who reads it.
 */
export function credentialFingerprint(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `••••${tail}`;
}

/** Constant-time compare for secrets that arrive from outside (webhooks). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
