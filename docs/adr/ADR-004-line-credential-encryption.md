# ADR-004: LINE channel credentials are encrypted in-app, with the key in the environment

**Status:** Accepted — 2026-08-27

## Context

[ADR-002](ADR-002-per-shop-line-oa.md) put each Shop's own LINE Official Account behind the platform: we store the Shop's channel credentials and send on its behalf. It required those credentials to be stored encrypted and deliberately left the mechanism open.

Two secrets are involved: the **channel access token** (sends messages as that OA) and the **channel secret** (verifies inbound webhook signatures). Either one in the wrong hands means messaging a garage's entire customer list under that garage's brand — reputationally the worst thing this system can leak, worse than the repair data itself.

The real question is not which cipher. It is **where the key lives**, because that is what decides who can decrypt, and it is expensive to change once pilot shops have connected.

## Decision

**AES-256-GCM envelope encryption performed by the app, with the key supplied as an environment variable.**

- Node's built-in `crypto` — no new dependency, identical behavior on Vercel and on a self-hosted box.
- Stored format: `v1:<iv>:<tag>:<ciphertext>`, base64url. The `v1` prefix exists so key rotation is additive rather than a migration.
- **AAD is bound to `shopId` + field name.** A ciphertext lifted out of one Shop's row fails to decrypt in another's — the same defense-in-depth reflex as ADR-001's same-shop composite foreign keys, applied to bytes.
- The key is 32 random bytes in `LINE_CREDENTIALS_KEY`: the Vercel environment in staging/production, `.env` in dev. That is **the same trust tier as `AUTH_SECRET` and `DATABASE_URL`**, which already live there.
- Decryption happens only inside `lib/line-credentials.ts`, only on the server, only at verify/send time. No DTO, server-component payload, or log line may carry a plaintext credential; the settings screen renders a masked fingerprint and never fetches the value.
- A missing or malformed key **disables LINE features with a clear message** instead of crashing: a fresh clone with no key still boots, and every non-LINE milestone still works.
- Rotation: `LINE_CREDENTIALS_KEY_PREVIOUS` as a read-fallback while re-encrypting, selected by the version prefix. The procedure belongs to M8's deploy guide.

## Consequences

- **What this defeats:** a leaked database dump or backup — the realistic accident for a small SaaS on hosted Postgres. Credentials in a stolen `pg_dump` are inert without the environment.
- **What it does not defeat:** an attacker with code execution or environment access. The server must be able to decrypt in order to send at all, so that ceiling is inherent to any system that sends on someone's behalf. Recording it here stops anyone later mistaking this for more protection than it is.
- Key loss is credential loss: without the key, every connected Shop must paste its credentials again. The key belongs in the same backup discipline as `AUTH_SECRET`.
- A managed KMS (AWS/GCP) was rejected for MVP: it gives real key isolation and an audit trail, but its own credentials then live in the same environment, so the trust boundary moves exactly one hop — in exchange for a cloud account, a network round-trip on the send path, and a new way for sending to fail. The `v1:` prefix means adopting one later re-encrypts rather than remodels. Revisit at the first customer security review that asks.
- Sub-decision, recorded for the record: Shops paste a **channel secret + a long-lived channel access token**, the fewest concepts for a non-technical owner to find in the LINE console. Issuing short-lived tokens from a channel id/secret is hygienically better and is additive — the stored shape is unchanged.
