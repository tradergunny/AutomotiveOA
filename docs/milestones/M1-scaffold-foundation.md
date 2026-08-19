# M1 — Scaffold & Foundation

The first code milestone. Goal: a running, deployable, bilingual, multi-tenant-safe app shell that a Manager/Advisor can log into — with the data foundation every later milestone builds on. No domain features yet (no cases, inspections, jobs); those are M2+.

**Branch:** `m1-scaffold-foundation` · **Gate:** login works; the app shell renders in both TH and EN.

## Read first
- [CONTEXT.md](../../CONTEXT.md) — domain language (Shop, Staff, User, and the Shop-scoping rule)
- [docs/design/DESIGN.md](../design/DESIGN.md) — stack, dark tokens, TH/EN, aesthetic
- [docs/design/mockup.html](../design/mockup.html) — the approved look to match
- [ADR-001](../adr/ADR-001-shared-multi-tenant.md) — the tenant-guard requirement

## Scope (in)
1. **Project scaffold** — Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, structure per DESIGN.md (`/components/ui`, `/components/blocks`, `cn()` in `/lib/utils`). lucide-react for icons.
2. **Dark theme tokens** — the DESIGN.md palette as CSS variables / Tailwind theme: zinc base, amber-orange `--primary` (≈`#f97316`), the status hues (green/amber/red/blue), corner-tick + hatch utilities. Dark-only for MVP.
3. **i18n plumbing** — bilingual TH/EN from day one (e.g. next-intl). Every user-facing string via keys; per-User locale; no hardcoded copy. A Thai-capable + Latin font pairing (self-hosted).
4. **Database + schema foundation** — Postgres via an ORM (propose Prisma). Tables for **Shop**, **Staff**, **User** (Staff↔User per CONTEXT.md: a User is a Staff with a login). Every tenant-owned row carries `shop_id`.
5. **Tenant-guarded data layer (ADR-001)** — scoping enforced at the data-access layer (row-level security or a repository-level tenant guard), NOT hand-written WHERE clauses. A test proving cross-tenant reads fail.
6. **Auth** — login for Advisor and Manager roles. Manager-only capabilities stubbed (Service Catalog price override, QC sign-off) as permission checks, even though those features arrive later.
7. **App shell** — sidebar + topbar from the mockup, TH/EN toggle, logged-in user chip. Nav items present; only the shell/dashboard route is real, others can be stubs.
8. **Seed** — the pilot Shop (Somchai Garage) + a Manager and an Advisor user, so login is testable.

## Scope (out — do not build)
- Any domain feature: customers, vehicles, check-in, inspection, jobs, quotations, LINE, payments (M2+).
- Light mode (dark-only MVP). Technician logins (Phase 2). Anything in [LATER.md](../LATER.md).

## Decisions to surface to the founder (don't guess silently)
- ORM/DB choice (Prisma + Postgres proposed) and where Postgres runs in dev (local vs. a hosted dev instance).
- Auth approach (e.g. Auth.js/NextAuth credentials, or a hosted auth). Password handling stays out of plaintext.
- Hosting target assumption (Vercel + hosted Postgres is the default unless founder says otherwise).

## Done when
Fresh clone → install → migrate → seed → `dev` → log in as the seeded Manager → see the app shell → toggle TH/EN and the whole shell switches. Tenant-guard test passes. PR opened for founder review.
