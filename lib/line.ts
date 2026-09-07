import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The LINE Messaging API behind one small seam (M6 brief §5) — the same shape
 * as lib/storage.ts's photo-store seam, for the same reason: the milestone
 * has to be verifiable on a fresh clone with no Official Account and no
 * message fees.
 *
 * - LIVE driver: real HTTPS calls to api.line.me with the Shop's own token.
 * - FAKE driver: writes the exact JSON payload it WOULD have posted to
 *   .data/line/outbox.jsonl and returns a synthetic request id. Everything
 *   around it still runs for real — the LineUpdate row, the publication
 *   tokens, the CaseEvent, the Customer Timeline — so the app itself is the
 *   verification surface and the outbox is the proof of the wire format.
 *
 * Selection: LINE_TRANSPORT wins when set ("fake" | "live"); otherwise dev
 * defaults to fake and production to live. Credentials are per-Shop and live
 * in the database (ADR-002/004), so they cannot select the driver.
 */

export type LineMessage =
  | { type: "text"; text: string }
  | { type: "image"; originalContentUrl: string; previewImageUrl: string };

export type LineBotInfo = {
  userId: string;
  basicId: string | null;
  displayName: string | null;
  pictureUrl: string | null;
};

export type LineProfile = {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
};

/**
 * What a verified LINE Login ID token says about the person holding it
 * (M7.8, ADR-006): the userId (`sub`) and the profile claims. This is the
 * ONLY way a userId reaches an Arrival — the client never sends one and the
 * server never trusts one (brief, decision 1).
 */
export type LineIdentity = {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
};

/**
 * Every failure staff can actually hit, named. The composer maps each to its
 * own bilingual sentence — never a stack trace, never "something went wrong".
 */
export type LineErrorCode =
  | "invalidToken"
  | "quotaExceeded"
  | "notFriend"
  | "rateLimited"
  | "invalidRequest"
  | "network"
  | "serverError"
  /** The ID token did not verify: expired, forged, or for another channel. */
  | "invalidIdToken";

export type LineCallResult<T> =
  | { ok: true; value: T; requestId: string | null }
  | { ok: false; code: LineErrorCode; detail: string; requestId: string | null };

export interface LineTransport {
  readonly mode: "live" | "fake";
  getBotInfo(accessToken: string): Promise<LineCallResult<LineBotInfo>>;
  getProfile(accessToken: string, lineUserId: string): Promise<LineCallResult<LineProfile>>;
  push(
    accessToken: string,
    to: string,
    messages: LineMessage[],
  ): Promise<LineCallResult<null>>;
  /**
   * Verify a LINE Login ID token against the Shop's Login channel and return
   * the identity it carries (M7.8). `loginChannelId` is the audience the
   * token must have been issued for — a token from another channel fails.
   */
  verifyIdToken(idToken: string, loginChannelId: string): Promise<LineCallResult<LineIdentity>>;
}

/**
 * One push request carries at most 5 message objects, so an Update is one
 * text plus at most four images (M6 brief, decision 3). The composer enforces
 * this; the constant lives here, next to the API that imposes it.
 */
export const LINE_MAX_MESSAGES_PER_PUSH = 5;
export const LINE_MAX_PHOTOS_PER_UPDATE = LINE_MAX_MESSAGES_PER_PUSH - 1;
/** LINE's text message cap. */
export const LINE_MAX_TEXT_LENGTH = 5000;
/** LINE fetches image URLs itself and accepts only these. */
export const LINE_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png"] as const;

export function isLineImageContentType(contentType: string): boolean {
  return (LINE_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType);
}

const API_BASE = "https://api.line.me";

/** HTTP status + LINE's message → one of our named codes. */
function classify(status: number, body: string): LineErrorCode {
  if (status === 401) return "invalidToken";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "serverError";
  if (status === 403) {
    // 403 covers both "monthly limit reached" and "this channel may not".
    return /limit|quota/i.test(body) ? "quotaExceeded" : "invalidToken";
  }
  if (status === 400) {
    // The friend check is a 400 whose message names it; everything else here
    // is our own malformed request.
    return /friend|not found|invalid user/i.test(body) ? "notFriend" : "invalidRequest";
  }
  return "invalidRequest";
}

export function createLiveLineTransport(): LineTransport {
  async function call<T>(
    accessToken: string,
    input: { method: "GET" | "POST"; url: string; body?: unknown },
  ): Promise<LineCallResult<T>> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${input.url}`, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(input.body ? { "Content-Type": "application/json" } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        cache: "no-store",
      });
    } catch (error) {
      return {
        ok: false,
        code: "network",
        detail: error instanceof Error ? error.message : "fetch failed",
        requestId: null,
      };
    }

    const requestId = response.headers.get("x-line-request-id");
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, code: classify(response.status, text), detail: text.slice(0, 500), requestId };
    }
    return { ok: true, value: (text ? JSON.parse(text) : null) as T, requestId };
  }

  return {
    mode: "live",
    async getBotInfo(accessToken) {
      const res = await call<{
        userId: string;
        basicId?: string;
        displayName?: string;
        pictureUrl?: string;
      }>(accessToken, { method: "GET", url: "/v2/bot/info" });
      if (!res.ok) return res;
      return {
        ok: true,
        requestId: res.requestId,
        value: {
          userId: res.value.userId,
          basicId: res.value.basicId ?? null,
          displayName: res.value.displayName ?? null,
          pictureUrl: res.value.pictureUrl ?? null,
        },
      };
    },
    async getProfile(accessToken, lineUserId) {
      const res = await call<{
        userId: string;
        displayName?: string;
        pictureUrl?: string;
      }>(accessToken, { method: "GET", url: `/v2/bot/profile/${encodeURIComponent(lineUserId)}` });
      if (!res.ok) return res;
      return {
        ok: true,
        requestId: res.requestId,
        value: {
          userId: res.value.userId,
          displayName: res.value.displayName ?? null,
          pictureUrl: res.value.pictureUrl ?? null,
        },
      };
    },
    async push(accessToken, to, messages) {
      const res = await call<unknown>(accessToken, {
        method: "POST",
        url: "/v2/bot/message/push",
        body: { to, messages },
      });
      if (!res.ok) return res;
      return { ok: true, value: null, requestId: res.requestId };
    },
    async verifyIdToken(idToken, loginChannelId) {
      // Not a bearer call: the verify endpoint takes the token and the
      // channel id as a form body and answers with the decoded claims.
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/oauth2/v2.1/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ id_token: idToken, client_id: loginChannelId }),
          cache: "no-store",
        });
      } catch (error) {
        return {
          ok: false,
          code: "network",
          detail: error instanceof Error ? error.message : "fetch failed",
          requestId: null,
        };
      }
      const requestId = response.headers.get("x-line-request-id");
      const text = await response.text();
      if (!response.ok) {
        // 400 here means the token itself was refused (expired, bad
        // signature, wrong audience) — its own code, so the form can say so.
        const code = response.status === 400 ? "invalidIdToken" : classify(response.status, text);
        return { ok: false, code, detail: text.slice(0, 500), requestId };
      }
      let claims: { sub?: unknown; name?: unknown; picture?: unknown };
      try {
        claims = JSON.parse(text);
      } catch {
        return { ok: false, code: "invalidIdToken", detail: "unparseable claims", requestId };
      }
      if (typeof claims.sub !== "string" || !claims.sub) {
        return { ok: false, code: "invalidIdToken", detail: "no sub claim", requestId };
      }
      return {
        ok: true,
        requestId,
        value: {
          userId: claims.sub,
          displayName: typeof claims.name === "string" ? claims.name : null,
          pictureUrl: typeof claims.picture === "string" ? claims.picture : null,
        },
      };
    },
  };
}

/**
 * Dev/test driver. Access tokens starting with "dev-" are treated as a valid
 * connection to a stand-in OA; anything else is refused exactly the way LINE
 * refuses a bad token, so BOTH paths are demonstrable without an account.
 *
 * ID tokens follow the same convention (M7.8, decision 4): "dev:U…" verifies
 * as that userId with a stand-in name, so the whole LINE door of the Arrival
 * form is walkable with no LINE Login channel, no tunnel, and no fees.
 */
const FAKE_TOKEN_PREFIX = "dev-";
const FAKE_ID_TOKEN_PREFIX = "dev:";
/** LINE user ids are "U" + 32 hex characters. */
const LINE_USER_ID = /^U[0-9a-f]{32}$/;

/** The fake ID token that stands for a given userId (`dev:U…`). */
export function fakeIdTokenFor(lineUserId: string): string {
  return `${FAKE_ID_TOKEN_PREFIX}${lineUserId}`;
}

export function createFakeLineTransport(outboxPath: string): LineTransport {
  async function record(kind: string, payload: unknown) {
    const line = JSON.stringify({ kind, payload });
    await mkdir(path.dirname(outboxPath), { recursive: true });
    await appendFile(outboxPath, `${line}\n`, "utf8");
  }

  function reject<T>(): LineCallResult<T> {
    return {
      ok: false,
      code: "invalidToken",
      detail: `fake transport: access token does not start with "${FAKE_TOKEN_PREFIX}"`,
      requestId: null,
    };
  }

  return {
    mode: "fake",
    async getBotInfo(accessToken) {
      if (!accessToken.startsWith(FAKE_TOKEN_PREFIX)) return reject<LineBotInfo>();
      return {
        ok: true,
        requestId: `fake-${randomUUID()}`,
        value: {
          userId: "Ufake0000000000000000000000000000",
          basicId: "@dev-oa",
          displayName: "DEV OA (fake transport)",
          pictureUrl: null,
        },
      };
    },
    async getProfile(accessToken, lineUserId) {
      if (!accessToken.startsWith(FAKE_TOKEN_PREFIX)) return reject<LineProfile>();
      return {
        ok: true,
        requestId: `fake-${randomUUID()}`,
        value: {
          userId: lineUserId,
          displayName: `LINE user ${lineUserId.slice(-4)}`,
          pictureUrl: null,
        },
      };
    },
    async push(accessToken, to, messages) {
      if (!accessToken.startsWith(FAKE_TOKEN_PREFIX)) return reject<null>();
      // The literal wire payload — this file IS the verification surface.
      await record("push", { to, messages });
      return { ok: true, value: null, requestId: `fake-${randomUUID()}` };
    },
    async verifyIdToken(idToken) {
      // The channel id is not checked here — dev shops rarely have one — but
      // the token must still be well-formed, so a body that merely LOOKS
      // like a userId is refused exactly as LINE would refuse a forged token.
      const userId = idToken.startsWith(FAKE_ID_TOKEN_PREFIX)
        ? idToken.slice(FAKE_ID_TOKEN_PREFIX.length)
        : null;
      if (!userId || !LINE_USER_ID.test(userId)) {
        return {
          ok: false,
          code: "invalidIdToken",
          detail: `fake transport: ID token is not "${FAKE_ID_TOKEN_PREFIX}U…"`,
          requestId: null,
        };
      }
      return {
        ok: true,
        requestId: `fake-${randomUUID()}`,
        value: {
          userId,
          displayName: `LINE user ${userId.slice(-4)} (dev)`,
          pictureUrl: null,
        },
      };
    },
  };
}

export const LINE_OUTBOX_PATH =
  process.env.LINE_OUTBOX_PATH ?? path.join(process.cwd(), ".data", "line", "outbox.jsonl");

function selectTransport(): LineTransport {
  const explicit = process.env.LINE_TRANSPORT?.trim().toLowerCase();
  if (explicit === "live") return createLiveLineTransport();
  if (explicit === "fake") return createFakeLineTransport(LINE_OUTBOX_PATH);
  return process.env.NODE_ENV === "production"
    ? createLiveLineTransport()
    : createFakeLineTransport(LINE_OUTBOX_PATH);
}

export const lineTransport: LineTransport = selectTransport();
