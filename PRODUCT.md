# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff of an in-house taxi fleet workshop in Thailand. The **Clerk** sits at the repair counter, handles roughly 30–40 cars a day, and enters everything about a Visit, including work reported by mechanics. The **Manager** settles Contract Mismatches, sees changed prices, and exports closed Visits for the office. Mechanics and drivers do not use the system; many mechanics do not work comfortably in English, and some older drivers have phones without screens.

## Product Purpose

A repair record for each car, created as a by-product of the counter's work. The Clerk finds a car by plate, opens a Visit, records the work and cost, and prints a Repair Bill. Each car keeps its history when its Contract Holder changes. Success is a counter that is faster than paper plus retyping, so the record actually gets kept: the workshop's own earlier repair module went unused because it was hard to use.

## Positioning

The car, not the customer, is the centre of the product. No name is chosen yet. Canonical language lives in [CONTEXT.md](CONTEXT.md).

## Operating Context

A Thai-language workshop counter with an unknown device, to be confirmed at the site visit. Thai taxi plates, baht, Buddhist-era dates. One Workshop can serve cars from several Cooperatives. The cooperative's contract program remains the official record of who holds a contract, and its programs handle payments, instalments and receipts.

## Capabilities and Constraints

M9 trial: open and close Visits, Repair Types with free text as the fallback, editable suggested prices, a printed Thai Repair Bill that does not read as a receipt, one page per car, Contract Mismatches, Manager lists and an office export file. Repeat warnings, cost per car and oil-change due join only if past repairs can be imported. Out: live tracking, quotations, payments, receipts, separate parts rows, mechanic logins, driver messages. See [docs/milestones/M9-fleet-repair-trial.md](docs/milestones/M9-fleet-repair-trial.md).

## Brand Commitments

Founder's pinned reference (2026-11-08): the layout and color of a clean fleet dashboard, namely a light grey ground, white rounded cards, a pill-shaped nav, one blue accent and a large car on white. Minimal and not generic-looking. The old name, amber accent, dark-only rule and ClaimTrack skin are retired. Working files are in [docs/design/fleet-mockup](docs/design/fleet-mockup).

## Evidence on Hand

One machine-transcribed interview at Ratchaphruk. No clerk, mechanic or driver has been interviewed, and no price has been discussed. No testimonials, benchmarks or pricing claims may be invented. All mockup data is fake.

## Product Principles

- Faster than paper, or it will not be used.
- The plate box is always the way in.
- The history belongs to the car.
- A Repair Bill states a cost, never a payment.
- Warn the Clerk, never block the Clerk.
