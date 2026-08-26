# ADR-005: A Customer is linked to a LINE identity through the OA's webhook

**Status:** Accepted — 2026-08-27

## Context

Sending a customer a LINE message requires their LINE `userId`. Our identity key for a Customer is a phone number ([CONTEXT.md](../CONTEXT.md)). Nothing bridges the two:

- No API turns a phone number into a `userId`.
- A `userId` is **per-OA** — the same person on two Shops' Official Accounts is two different ids.
- The customer cannot tell you their own `userId`. It is not displayed anywhere in the LINE app, and the LINE Official Account Manager's chat list does not expose it either.

There are exactly two ways to obtain one: **an inbound webhook event from that OA**, or **LINE Login / LIFF**. LIFF is deferred in [LATER.md](LATER.md) together with tap-to-approve, because it needs a second channel type per Shop, a hosted LIFF app, and its own onboarding step.

CONTEXT.md's LINE Update entry also said the MVP is push-only and that "nothing flows back into the system automatically" — written about *replies*, but broad enough to forbid the only mechanism that makes pushing possible at all.

## Decision

**Each Shop's OA points at a per-Shop webhook endpoint, which captures LINE identities; Staff link a captured identity to a Customer by hand.**

- Endpoint is `/api/line/webhook/[shopId]`. The Shop is known from the path *before* verification, which a single shared endpoint cannot manage without first trusting the request body's `destination` field. The shopId is not a secret and confers nothing without a valid signature.
- Every request is verified by HMAC-SHA256 against that Shop's channel secret **before the body is parsed**. That signature check is the entire security boundary of the app's first public write path, and is tested as such.
- `follow` creates or refreshes a `LineContact`; `unfollow` marks it, so a doomed push is refused with a reason instead of burning message quota; **`message` events are ingested for identity only** — the userId and a timestamp.
- **Message content is never read, stored, or displayed.** Replies continue to live in the OA chat inbox, handled by Staff there (CONTEXT.md).
- Linking a `LineContact` to a Customer is a deliberate human act, using the same phone lookup as check-in, and is recorded as a `CaseEvent`.
- A Manager-only "paste a userId" field exists for founder testing and for a shop that already knows an id. It is not a customer-facing path.

**CONTEXT.md is amended accordingly:** no message *content* flows back into the system automatically; *identity* does.

## Consequences

- **The milestone is shaped by this, not by preference.** Without a webhook there is no push at all, so M6 could not have avoided a public endpoint by choosing differently.
- Onboarding grows past ADR-002's existing friction: the owner must also paste a webhook URL into the LINE Developers console and toggle two settings there. ADR-002 already predicted manual assistance during early sales.
- **Linking is a human match and can go wrong.** LINE display names are nicknames and emoji and often will not resemble the Customer record. Mitigated by showing the linked display name and avatar on the Customer record and again in the send confirmation, so a bad link surfaces before the first message rather than after.
- Ingesting `message` events is what makes customers who friended the OA *before* it was connected reachable at all; without it they would be permanently unmessageable. It is also the part that comes closest to the old push-only wording, hence the explicit amendment above rather than a silent contradiction.
- Coverage is not total: a customer who never adds the OA cannot be reached. "No linked identity" is therefore a normal, explained state in the composer — never an error — and the practical shop-floor answer is a QR poster at the counter.
- A claim-code flow (customer sends a short code to the OA, which auto-links it) would remove the mismatch risk entirely, but requires matching against message *text* — the one thing this ADR otherwise promises not to touch. Deferred until mismatches prove common; it is additive on top of the manual inbox.
- Adopting LIFF later ([LATER.md](LATER.md)) does not undo any of this: LINE Login yields the same `userId` for the same OA, so it becomes a second, self-service way to populate the same link.
