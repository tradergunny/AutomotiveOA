# M2 — Customers, Vehicles & Check-in

The first domain milestone. Goal: the front-desk moment works — the Advisor looks up the person at the desk by phone, finds or creates the Customer and their Vehicle, and opens a Repair Case with walkaround photos. No inspection, no Jobs, no pricing yet (M3+); the case just exists — correctly owned, numbered, and photographed.

**Branch:** `m2-customers-vehicles-checkin` · **Gate:** a real check-in can be performed end-to-end.

## Read first
- [CONTEXT.md](../../CONTEXT.md) — Customer, Vehicle, Repair Case, Photo (identity keys and the history rules live here)
- [docs/design/DESIGN.md](../design/DESIGN.md) — aesthetic, density, the TH/EN rule
- [ADR-001](../adr/ADR-001-shared-multi-tenant.md) + [lib/tenant.ts](../../lib/tenant.ts) — every new model must be classified in the tenant guard; its compile-time exhaustiveness check refuses to build until you do

## Scope (in)
1. **Schema — Customer, Vehicle, RepairCase, Photo.** Customer: name, phone (normalized digits, per-Shop unique — the identity key), optional company tag, optional note. Vehicle: plate (normalized, per-Shop unique, edited **in place** on a plate change — never a duplicate row), optional province and VIN, `bodyType` (`SEDAN`/`PICKUP` — selects M3's Damage Map artwork), optional make/model/color, primary-Customer FK. RepairCase: per-Shop reference, Vehicle FK, contact-Customer FK (the person who brought the car — a Customer record, since it's who the Shop talks to), status enum `CHECKED_IN → READY → DELIVERED` (M2 only ever writes Checked In; transitions arrive M5), optional visit note, checked-in timestamp, Staff attribution. Photo: always belongs to a RepairCase (walkaround level now; Finding/Job links arrive with those models in M3/M4), storage key, captured-at, uploader. All four classified in `lib/tenant.ts`; tenant-guard tests extended to cover them.
2. **Case references** — `RC-####`, sequential **per Shop**, concurrency-safe (transactional counter). Every Shop numbers independently.
3. **Customers & Vehicles screen** (`/customers`) — one searchable list (name / phone digits / company / plate); customer create + edit; customer detail with their Vehicles and cases; vehicle create + edit, including plate edit-in-place and primary-Customer re-link. Basic info only — spending/visit history views are M7's history split.
4. **Check-in flow** (`/checkin`) — phone lookup decides existing-vs-new for the person at the desk; they become the case's contact. Vehicle by plate lookup or created new. When the Vehicle's primary Customer differs from the contact, the Advisor chooses: visit-contact only (borrowed/family car) or re-link ownership (CONTEXT.md: staff re-link the primary Customer at check-in). Optional visit note, walkaround photos, submit → Repair Case opens and lands on its page.
5. **Walkaround photos** — the Advisor shoots straight in: camera capture or file pick, multiple shots, client-side downscale before upload, thumbnails with remove-before-save. Files go through a small storage module (backend per decision below) and are served only through an authenticated, tenant-checked route — never public URLs.
6. **Repair Case page (minimal)** (`/cases/[id]`) — reference, Checked In status badge, vehicle + contact + primary Customer, visit note, photo grid. This is the skeleton M3 (Inspection) and M4+ keep extending.
7. **Case Board minimal list** — replace M1's empty state with a plain list of open cases (reference, plate, vehicle, contact, checked-in age). No attention grouping, no Job rollups — that's M5's board.
8. **Seed extension** — a handful of Thai-named Customers and Vehicles (both body types) on the pilot Shop so lookups are testable on a fresh clone; still idempotent. No seeded cases — performing a check-in is the gate.

All new UI is bilingual through the M1 i18n plumbing — every string in both message files, validation and empty states included.

## Scope (out — do not build)
- Inspection, Damage Map, Findings (M3) — M2 only stores `bodyType`.
- Jobs, pricing, quotations, authorizations (M4); status transitions, rollups, attention-grouped board, delivery (M5).
- Anything LINE (M6). Payments, history views, Follow-ups (M7).
- Fleet/corporate accounts ([LATER.md](../LATER.md)). Customer merge/dedupe tooling and delete flows — create/edit only in MVP.
- Technician-shot photos and the LINE-group photo relay — those are Job-level photos (M4+); M2 photos are Advisor-shot at check-in.

## Decisions to surface to the founder (don't guess silently)
- **Photo storage backend.** Proposal: Vercel Blob (fits M1's Vercel + hosted-Postgres assumption) behind the storage module so it stays swappable; photos are customer data, so access stays authenticated per scope §5.
- **Case numbering.** Proposal: per-Shop sequence starting at `RC-1001` (CONTEXT.md's `RC-1024` style). Veto if you want year-prefixed (`RC-2026-0001`).
- **Check-in extras.** Proposal: add an optional odometer field (feeds service-interval CRM later); skip fuel-level and customer signature in MVP.
- **Identity edge cases.** Phone per-Shop unique means one Customer per number — a shared family phone becomes one Customer record in MVP. Plate unique per Shop on normalized plate (+ province when given). Flag if the pilot shop's reality disagrees.

## Done when
Fresh clone → migrate → seed → log in as the Advisor → check in a brand-new walk-in end-to-end: phone lookup misses → create Customer → create Vehicle (plate, body type) → shoot walkaround photos → `RC-1001` exists, Checked In, photos on its page and the case on the board. Then check in a seeded returning customer: phone lookup hits, plate lookup hits. A plate edit updates the same Vehicle row in place, its cases still attached. Both flows fully usable in TH and EN. Tenant-guard tests — extended to the four new models — pass. PR opened for founder review.
