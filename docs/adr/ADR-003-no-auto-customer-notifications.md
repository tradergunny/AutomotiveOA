# ADR-003: No automatic customer notifications

**Status:** Superseded by [ADR-007](ADR-007-system-sent-customer-updates.md) — 2026-09-10 (originally Accepted — 2026-08-19)

> The reasoning below still governs the events that never reach the customer — QC bounces, reverts, cancellations, price changes, shop-internal waits. What ADR-007 changes is that a closed, named set of status changes now sends without a human press. Its final consequence — "must revisit this ADR explicitly" — is what ADR-007 does.

## Context

The system tracks fine-grained internal Job events (QC failed, rework, waiting-reason changes). It is tempting — and would look like a feature — to push these to the customer's LINE automatically on every status change. But internal events can alarm or mislead ("Your car failed QC"), and the customer-facing narrative is reputational: tone and timing belong to a human.

## Decision

The Customer Timeline and the internal timeline are separate. Every LINE Update is composed and deliberately sent by Staff; no internal state change ever triggers a customer message. The system may pre-fill a draft (selected status, photos, suggested wording) — a human presses send.

## Consequences

- No embarrassing or confusing auto-messages; staff control the story the customer sees.
- Update frequency depends on staff diligence. Future mitigation lives on the dashboard ("no update sent in 3 days"), not in auto-sending.
- Any future feature that wants to message customers automatically (e.g. "car is Ready" pings, service reminders) must revisit this ADR explicitly rather than quietly wiring events to LINE.
