# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff of a Thai automotive body-and-service garage, at a desk PC or a tablet beside the car. Two logins in MVP: the **Service Advisor** (front desk: checks cars in, inspects, prices, sends quotations, records the customer's answer, collects payment, hands over) and the **Manager/Owner** (price overrides, QC sign-off, cancellations, the money view). Technicians are assignable Staff records without logins; the advisor records their progress. Customers touch the product only through the Shop's LINE Official Account and the self-service Arrival page on their phone.

## Product Purpose

AutomotiveOA runs one garage's day: every car in the yard is a Repair Case, every case's next move is derived from its Jobs, and the customer hears about every status change that affects their expectations without anyone having to remember to tell them. Success is a shop where nothing sitting in the yard is invisible, a newcomer reads any case's situation and next step in seconds, and the customer gets a numbered quotation and honest status without the advisor re-keying anything.

## Positioning

Stage is derived, never set. A case's placement on the board and its headline on its own page come from the same derivation over its Jobs, so the board, the case page, and the staff's speech ("it's in QC", "waiting on parts") can never disagree, and there is nothing to drag or forget to update. Multi-tenant from day one, with each Shop owning its own LINE OA and its own encrypted credentials. Canonical language lives in [CONTEXT.md](CONTEXT.md).

## Operating Context

Bilingual Thai/English staff UI; Thai-first customer messages. Thai plates ("4ขข 9333"), baht money in satang, insurance claims paid weeks after delivery, walk-ins who agree on the spot without a quotation. The shop's screen is a wide desktop or laptop at the front desk; the inspection screen is used on a tablet beside the car. Real vehicle photos exist from the check-in walkaround. Deployed on Vercel with hosted Postgres; photos in Blob storage behind an authenticated route.

## Capabilities and Constraints

Check-in (from nothing or from a customer's Arrival), the Damage Map and Service Checklist inspection, Findings that fill the Offer, merge, pricing from the Service Catalog or by quote, versioned Quotations sent over LINE with an unguessable document link, one Response per payer authorizing or declining each Job, the fixed Job transition edge map with a mandatory QC gate, derived Ready, explicit Delivered, append-only Payments per payer side, the Follow-up worklist, the internal timeline, and the curated Customer Timeline. Customer messages are sent by the system for a closed, named set of status changes and carried by the Staff acts that mark the visit's milestones (ADR-007); internal events — QC bounces, reverts, cancellations, price changes — never reach the customer. No inventory, no insurer integration, no technician logins, no light theme in MVP (dark-only, D-1). Fixed board grouping was ruled MVP scope in M5; M7.9 reopens it only for a plate/name search and a "Needs me" filter.

## Brand Commitments

Name **AutomotiveOA** (D-4). Racing amber-orange accent, `#f97316` (D-3), never used as a status hue. Dark-only product (D-1). IBM Plex Sans / Plex Sans Thai / Plex Mono, self-hosted. Lucide icons only. Founder's own reference family ("UFC project", ClaimTrack) governs organization; the 2026-09-10 board session adopts the ClaimTrack skin (rounded cards, sentence-case pills, soft depth) as the product's replacement visual language, board first, rest of the app in a follow-up milestone (D-27).

## Evidence on Hand

Real domain model and seeded pilot shop (`prisma/seed.ts`, `npm run cases:stage` stages one case per Stage). Walkaround photos per case. No customer testimonials, no benchmarks, no pricing claims — none may be invented. Design canvases for prior sessions under `docs/design/`.

## Product Principles

- The next move is always on screen, derived, never typed.
- One chip means one workflow state; counts and metadata are sentences.
- Attention wins: the oldest thing waiting on a human is the loudest thing on the page.
- Real photos, real plates, real money — nothing decorative stands in for shop truth.
- Consistency across screens over cleverness on one.
