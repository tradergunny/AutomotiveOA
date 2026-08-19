# AutomotiveOA

Multi-tenant workshop-management + CRM platform for Thai automotive repair / body shops, with customer updates delivered through each garage's own LINE Official Account.

Built first with a pilot shop, sold to other garages (see [ADR-001](docs/adr/ADR-001-shared-multi-tenant.md)).

## Status

M1 (scaffold & foundation) built: bilingual app shell behind login, on a tenant-guarded data layer. Domain features arrive milestone by milestone — see [docs/MILESTONES.md](docs/MILESTONES.md).

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

## Documentation

| Doc | Purpose |
|-----|---------|
| [CONTEXT.md](CONTEXT.md) | Canonical domain glossary — the language used in code, UI, and docs |
| [docs/design/DESIGN.md](docs/design/DESIGN.md) | UI guidelines: stack, dark technical aesthetic, bilingual TH/EN, Damage Map |
| [docs/design/mockup.html](docs/design/mockup.html) | M0 clickable visual mockup (Case Board + Inspection / Damage Map) |
| [docs/adr/](docs/adr/) | Architecture Decision Records |
| [docs/LATER.md](docs/LATER.md) | Deliberately deferred scope |
| [docs/INTERVIEW-QUESTIONS.md](docs/INTERVIEW-QUESTIONS.md) | Garage-interview checklist validating working assumptions |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · next-intl (TH/EN) · Auth.js · Prisma 7 · PostgreSQL, behind a tenant-guarded data layer ([lib/tenant.ts](lib/tenant.ts), per [ADR-001](docs/adr/ADR-001-shared-multi-tenant.md)).
