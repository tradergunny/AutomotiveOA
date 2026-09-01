# AutomotiveOA

Multi-tenant workshop-management + CRM platform for Thai automotive repair / body shops, with customer updates delivered through each garage's own LINE Official Account.

Built first with a pilot shop, sold to other garages (see [ADR-001](docs/adr/ADR-001-shared-multi-tenant.md)).

## Status

**M7.5 is merged; M8 (hardening & pilot readiness) is the last milestone before the pilot goes live** — see [docs/MILESTONES.md](docs/MILESTONES.md) for the full ledger.

The build so far: check-in opens a Repair Case (M2), an inspection turns the car into Findings (M3), Findings are grouped into priced, per-Job-authorized work with versioned Quotations (M4), that work moves through Waiting / In Progress / QC to Delivered on an attention-grouped board with a staff-only internal timeline (M5), the customer gets their curated half through the Shop's own LINE OA (M6), and Payments, per-payer balances, the Customer/Vehicle history split, and a Follow-up worklist close the money-and-relationships loop (M7).

**M7.5** made all of that legible. A Repair Case now has exactly one derived **Stage** ([CONTEXT.md](CONTEXT.md)) — In assessment · Awaiting authorization · Waiting · In progress · In QC · Ready · Delivered / Balance due — computed once in [lib/case-flow.ts](lib/case-flow.ts) and shared by the board and the case page, so both speak the same vocabulary. The page leads with a stage spine and a derived next action, wears the car's own check-in photo, renders Job cards as records with an explicit Edit toggle, and keeps a fixed section order that shrinks around the current Stage (D-6 – D-10 in [docs/design/DESIGN.md](docs/design/DESIGN.md)).

Each Shop connects its **own** LINE Official Account in `/settings` (ADR-002) — credentials verified against LINE, then stored encrypted (ADR-004) — and the OA's webhook captures the LINE identities staff match to Customers by hand (ADR-005). On a case, the **Customer timeline** sits beside the internal one: a Thai draft is pre-filled from the case's real Jobs in customer-safe wording, staff edit it, attach up to four case photos, preview exactly what will go out, and press send. Every send is an immutable record of what the customer actually saw, and appears on the internal timeline as an event. Nothing is ever sent automatically (ADR-003). Setting up an Official Account is walked through step by step in [docs/LINE-SETUP.md](docs/LINE-SETUP.md).

**Staging is live on Vercel** (since 2026-08-26) at <https://automotive-oa.vercel.app>: production branch `main` — every merged PR deploys automatically. Neon Postgres (pooled `DATABASE_URL` at runtime; `vercel.json` runs `prisma migrate deploy` on the unpooled URL at build time) and a **private** Vercel Blob store for photos (`BLOB_READ_WRITE_TOKEN` selects the driver in [lib/storage.ts](lib/storage.ts)). Env vars live in the Vercel dashboard and are baked in at build time — connecting a store or changing a value does nothing until the next deploy. The full deploy guide is an M8 deliverable.

## Getting started (dev)

Requires Node 22+. No Docker or local Postgres install needed.

```bash
npm install
```

```bash
npm run db:dev
```

`db:dev` starts a local Postgres-compatible server (Prisma dev) and prints its connection URL. Copy `.env.example` to `.env`, set `DATABASE_URL` to that URL **with the database name changed from `template1` to `automotiveoa`** (never use template1 itself — Postgres clones new databases from it), and set `AUTH_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Then:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:3000 and log in with a seeded pilot-shop account:

| Login | Password | Role |
|---|---|---|
| `somchai@somchaigarage.dev` | `manager123` | Manager |
| `ann@somchaigarage.dev` | `advisor123` | Service Advisor |

Tests (`npm test`) need the dev database running.

### Staged cases for a Stage walkthrough

`npm run cases:stage` fills the pilot shop with one Repair Case per **Stage** (RC-1010 – RC-1019): fresh assessment, ungrouped findings, unpriced proposal, awaiting authorization, waiting on parts, in progress with a cancelled job, in QC, ready, delivered-with-balance, and delivered-settled — each with generated walkaround photos so the board's car thumbnails (D-9) are real.

```bash
npm run cases:stage
```

Dev only. It writes rows directly rather than performing the flows, so it is a viewing aid for the M7.5 walkthrough gate, never a substitute for exercising check-in or inspection by hand. It is idempotent: a re-run deletes what the previous run created (tracked in `.data/staged-cases.json`, gitignored) before staging afresh, and it touches nothing the seed or your own testing created.

### LINE in dev

You do **not** need a LINE Official Account to run or test the app. With no `LINE_TRANSPORT` set, development uses a stand-in transport that writes the exact payload it *would* have posted to `.data/line/outbox.jsonl` (gitignored) and charges nothing — everything else runs for real, so the Customer timeline, the internal event, and the photo links are all genuine.

Set `LINE_CREDENTIALS_KEY` in `.env` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), then in `/settings` connect a channel using **any** access token starting with `dev-` (for example `dev-token`) and any channel secret. The stand-in accepts `dev-` tokens and refuses everything else, exactly the way LINE refuses a bad one.

To exercise the inbound half — a customer adding the OA — simulate a signed webhook against your dev server:

```bash
npm run line:simulate -- follow
```

`follow`, `message`, and `unfollow` are all supported (`-- follow --user U…` picks a specific id). The script signs the body with the connected Shop's real channel secret, so the encryption and signature paths are exercised too. No tunnel, no account, no fees.

Note that a real OA needs a publicly reachable HTTPS app for both webhooks and photo delivery, so the live pass belongs on the deployed staging URL, not `localhost`.

Check-in and inspection photos are stored in `.data/photos/` (gitignored) by the local storage driver; production swaps in Vercel Blob behind the same seam ([lib/storage.ts](lib/storage.ts)) at deploy time.

### Authoring new migrations

`npm run db:migrate` only **applies** committed migrations. To **create** one after editing `prisma/schema.prisma`, set `SHADOW_DATABASE_URL` in `.env` first (see `.env.example` — the `db:dev` server is single-store, so `prisma migrate dev` must use the dedicated shadow server it also runs, one port above the main TCP port), then:

```bash
npm run db:migrate:new
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [CONTEXT.md](CONTEXT.md) | Canonical domain glossary — the language used in code, UI, and docs |
| [docs/design/DESIGN.md](docs/design/DESIGN.md) | UI guidelines: stack, dark technical aesthetic, bilingual TH/EN, Damage Map |
| [docs/design/mockup.html](docs/design/mockup.html) | M0 clickable visual mockup (Case Board + Inspection / Damage Map) |
| [docs/adr/](docs/adr/) | Architecture Decision Records |
| [docs/LINE-SETUP.md](docs/LINE-SETUP.md) | Step-by-step: creating a LINE Official Account and connecting it |
| [docs/MILESTONES.md](docs/MILESTONES.md) | Build plan — milestone ledger, gates, and what is next |
| [docs/LATER.md](docs/LATER.md) | Deliberately deferred scope |
| [docs/INTERVIEW-QUESTIONS.md](docs/INTERVIEW-QUESTIONS.md) | Garage-interview checklist validating working assumptions |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · next-intl (TH/EN) · Auth.js · Prisma 7 · PostgreSQL, behind a tenant-guarded data layer ([lib/tenant.ts](lib/tenant.ts), per [ADR-001](docs/adr/ADR-001-shared-multi-tenant.md)).
