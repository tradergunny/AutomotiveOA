# ADR-007: The system sends customer updates on meaningful status changes; Staff acts carry the milestones

**Status:** Accepted — 2026-09-10 · **Supersedes** [ADR-003](ADR-003-no-auto-customer-notifications.md)

## Context

[ADR-003](ADR-003-no-auto-customer-notifications.md) (2026-08-19) ruled that no internal state change ever triggers a customer message: the system may pre-fill a draft, a human presses send. M6 built exactly that — a composer on the case page with a Thai draft, a photo picker, a preview and a two-press send — and M7.7 added the one exception the ADR allowed, Send quotation, where a human press sends a fixed message with no composer.

Three weeks of use against staged and real cases showed the cost. Every update was a chore: open the case, read the draft, press send twice. The Customer Timeline panel that hosted it was the largest thing on the page, and its size — a chat window under a log of chat bubbles — was itself the confusion (founder, 2026-09-10). And ADR-003's own consequence came true: "update frequency depends on staff diligence". Its planned mitigation was a dashboard nag, which fixes the shop's habit and not the customer's silence.

ADR-003's *reason* was never wrong. Internal events alarm ("Your car failed QC"), and the customer-facing narrative is reputational. What was wrong was the remedy: it kept every message behind a human press, when the alarming messages are a short, nameable list and the rest are what a garage customer wants — evidence that their car is being worked on, in the shop's voice, without anyone having to remember.

The founder's brief for the redesign, verbatim: *customers don't need every internal event; they need only meaningful status changes that affect their expectations* — and *the customer needs to feel the trust and credibility from receiving updates.* Those two sentences pull in opposite directions, and this decision is where they meet.

## Decision

**A LINE Update is sent by the system, without a compose step, whenever one of a named set of things happens to the Repair Case. The set is closed; everything not on it stays internal.** Two kinds, defined in [CONTEXT.md](../../CONTEXT.md):

- **Milestone messages** ride on a Staff act that already addresses the customer: **Check-in**, **Send quotation** (unchanged from D-25), **Ready** (however reached — Mark ready, or the QC pass that completed the last Job), **Delivered**, and **linking a LINE Contact** to a Customer with an open case, which sends one **catch-up** describing the case as it stands. The act's dialog offers one optional note to the customer, appended as written.
- **Progress notices** fire with no Staff act aimed at the customer: **work started** (once per case), **waiting for parts** with the expected arrival, **parts arrived — work resumed**, **each Job completed** with that Job's photos, and **final quality check**. Two guards: a QC pass that makes the case Ready sends only Ready; Jobs completing within the same hour coalesce into one notice.
- **Never:** a QC bounce, a revert, a cancellation, a price change, a Paint-booth or Technician wait, a Job merely starting, a Response being recorded, a Payment. ADR-003's reasoning is kept in full for these.

**Mechanics that this ADR fixes, because each is the kind of thing a later "simplification" removes:**

1. **The act commits first; the message goes second; the message can never fail the act.** Mark ready, QC pass, check-in and the rest write their own transaction as today, then the send runs, then the Update is recorded — extending M6's push-first-record-second order with one step in front. A LINE failure records a `FAILED` row; a gate block (no channel, no linked contact, unfollowed) records a **not-sent** row naming the reason. Nothing rolls back, and no act waits on LINE to answer before it is done. A car is Ready when the shop says so, told or not.
2. **Every Update carries its kind.** "Work started once per case", "Ready subsumes the last completion", the hour-long coalescing window, and the compact log's rendering are all rules about *kinds*, so the kind is a stored field on the immutable row, not something inferred from the text.
3. **Wording is the system's**, fixed Thai per kind, as `lib/line-draft.ts` already holds it; the optional note is the only human text. Per-Shop editable templates stay in [LATER.md](../LATER.md).
4. **Free-form sending survives as a dialog** — for Follow-ups and the ad-hoc word — and the Customer Timeline becomes a compact log of what the customer heard, most of it now system-written ([DESIGN.md](../design/DESIGN.md) D-29). The preview and the arm-then-confirm double press retire with the composer; a fixed, named recipient in the dialog title is the safeguard.

**Rejected:**

- *Per-Job "started" notices and per-event pushes.* A five-Job case would send five near-identical messages in a morning. Stage entry is the customer-shaped unit for "work started"; Job completion is the evidence-shaped unit for progress, and it is the one carrying photos.
- *Replaying missed messages when a LINE Contact is linked late.* A three-day-old "we have received your car" reads as a fault. One catch-up, describing now, replaces them.
- *A retry daemon for failed pushes.* Still out (M6 scope). A `FAILED` row is visible on the case page; the free-form dialog is the retry.
- *A silence guard* ("no Update in 3 days → send a summary"). The strongest trust lever, but the system's first scheduler and a new class of unattended send. Deferred until Level 2 has run at the pilot ([LATER.md](../LATER.md)).

## Consequences

- **ADR-003 is superseded, not amended.** Its consequence "any future feature that wants to message customers automatically must revisit this ADR explicitly" is what this document is. The two-narrative rule (internal timeline vs Customer Timeline) survives intact; what changed is who writes the customer's half.
- **The customer's phone becomes a live view of the case.** That is the point, and it is also why the never-list is closed: the first time a Progress notice says something a Staff member would not have said, the shop will ask to turn the whole thing off. Adding a kind is a CONTEXT.md change, argued in the open, never a one-line trigger.
- **Wrong links now surface as wrong messages.** ADR-005 mitigated a mislinked LINE Contact by showing the display name in the send confirmation, which no longer exists. The catch-up message on link replaces it: a mislinked person receives a message about a car that is not theirs and says so. This is louder than before and is accepted — a silent mislink was the worse failure.
- **Message volume rises, and so does LINE cost.** A typical body-shop visit sends roughly eight to twelve pushes instead of two or three. A free-plan OA's monthly allowance is per Shop (ADR-002); the pilot's first month should be watched, and [LINE-SETUP.md](../LINE-SETUP.md) says so.
- **Every customer-facing act gains a send step after its transaction**, so those server actions get slower by one LINE round trip. They already carried a photo upload in the same request; the round trip is bounded by the transport's timeout, and a slow LINE never blocks the act's commit.
- **Send quotation is the model, and it is unchanged.** The composer's `sendLineUpdate` and the quotation's `sendQuotation` already share `deliverLineUpdate`; every new kind is one more caller of the same function, with the same immutable row and the same `CaseEvent`.
- **The staged-case script writes `LineUpdate` rows directly** (`scripts/stage-cases.ts`), bypassing the send path. It must write a kind too, or the log renders those rows wrong.
- **LINE-SETUP.md's "nothing is ever sent automatically"** becomes the opposite promise: here is exactly what your customers will receive, and when.
