# ADR-006: Customers announce a visit themselves through an Arrival, which links their LINE identity but records nothing on its own

**Status:** Accepted — 2026-09-08

## Context

Check-in ([M2](../milestones/M2-customers-vehicles-checkin.md)) is entirely advisor-keyed: phone lookup, plate lookup, name and car details typed at the desk. Two things about that are worse than they need to be. The mechanical part — pressing **Look up** twice — is pure friction with no domain reason behind it. The deeper part is that everything the customer knows best (who they are, what is wrong with the car) is re-keyed by staff, and the customer's LINE identity still has to be matched to their record by hand from the contacts inbox ([ADR-005](ADR-005-line-identity-via-webhook.md)), where nickname-and-emoji display names make a wrong match easy.

The obvious fixes were considered and rejected:

- **A Google Form.** Lives outside the tenant, gives no LINE identity, and staff re-key it anyway. We already serve public pages of our own (the quotation document at `/q/[token]`).
- **Self-registration that writes records directly.** Phone is the identity key and existing-vs-new is a human judgment ([CONTEXT.md](../../CONTEXT.md)). A customer's typed phone or plate can collide with or narrowly miss an existing record, and a Repair Case allocates an RC number and appears on the board. Letting a public form create any of these means the first mistyped digit creates a duplicate Customer or a phantom case.
- **The claim-code flow** parked in [LATER.md](../LATER.md) — the customer messages a code to the OA. It requires reading message text, the one thing ADR-005 promises not to do.

[LATER.md](../LATER.md) had deferred LIFF (LINE's in-app web pages) together with tap-to-approve, because a LIFF app needs a second channel type per Shop and its own onboarding step. Identity alone is a much smaller use of it than tap-to-approve.

## Decision

**A customer submits an Arrival from their own phone — per visit, as a candidate that check-in consumes. Submitted inside LINE, it carries their LINE identity, and confirming it links that identity to the Customer.**

- **Arrival, not registration.** It is a notice of a visit: person, car, what is wrong, odometer. A returning LINE-linked customer picks one of their cars and describes the problem. Lifecycle **waiting → checked in** or **dismissed**; stale after 24 hours. Defined in [CONTEXT.md](../../CONTEXT.md).
- **Candidate, never a record.** No Customer, Vehicle, or Repair Case is created by the submission. The advisor pulls the Arrival into the existing check-in wizard, which becomes the gateway: the same lookups, validation, and single transaction as today, with the Arrival attached. Check-in never depends on an Arrival — a tow that arrives without its owner is checked in from nothing.
- **Advisory for identity, authoritative for the visit.** The customer's complaint and odometer land as typed. Their name, phone, and plate never overwrite an existing record; a difference is shown beside the record ("customer wrote: …") for the advisor to act on. The one hard stop: a LINE identity already linked to a different Customer than the one the phone finds — the advisor must choose, and the link moves to their choice (a case event records it).
- **Two doors, one page.** A plain URL (QR poster) that is **write-only** and reveals nothing back, because phone is an identity key but not a secret. And the same page opened inside LINE, where a userId already linked to a Customer unlocks **that Customer's vehicles only** — never history, balances, or cases. This is an arrival notice, not a customer portal.
- **Silent on LINE.** Neither submission nor confirmation sends a LINE message. [ADR-003](ADR-003-no-auto-customer-notifications.md) stands; the confirmation lives on the page the customer just used, and the first LINE Update is composed by the advisor from the case, which now opens with a linked contact.
- **A public write path with a rotatable key.** The Shop's form URL is a random token — not the shopId, which ADR-005 could expose only because a signature guards the webhook — and can be regenerated from Settings, killing the old poster. A per-Shop cap on waiting Arrivals and a per-source rate limit bound what a flood can do.

## Consequences

- **Onboarding grows again.** Beyond ADR-002 and ADR-005, a Shop that wants the LINE door must create a LINE Login channel under the same provider as its OA and register a LIFF app pointing at the form, then paste one more value into Settings. A Shop that skips this still gets the plain form; the LINE door is simply closed until then. [LINE-SETUP.md](../LINE-SETUP.md) gains a part for it.
- **The counter QR should be the OA's add-friend link**, with Register in the rich menu, so LINE becomes the default door and the plain page the fallback for people who refuse LINE. Rich menus stay hand-configured in OA Manager.
- **ADR-005's manual link remains** the path for customers who never submit an Arrival. The self-service link is a second way to populate the same field, exactly as that ADR anticipated.
- **LIFF is now in the system for identity.** Tap-to-approve remains parked in LATER.md on its own merits; this ADR does not pull it in, but it removes the "needs LIFF" part of its cost.
- **The claim-code flow is superseded** for practical purposes and is dropped from LATER.md.
- **Auto-lookup on the wizard** (phone and plate look themselves up as the advisor stops typing) is bundled with this work because it is the same complaint, not because it needs an ADR.
