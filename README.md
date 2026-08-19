# AutomotiveOA

Multi-tenant workshop-management + CRM platform for Thai automotive repair / body shops, with customer updates delivered through each garage's own LINE Official Account.

Built first with a pilot shop, sold to other garages (see [ADR-001](docs/adr/ADR-001-shared-multi-tenant.md)).

## Status

Pre-code. Domain model, architecture, and design system are settled and documented; the MVP is being built milestone by milestone. See [docs/MILESTONES.md](docs/MILESTONES.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [CONTEXT.md](CONTEXT.md) | Canonical domain glossary — the language used in code, UI, and docs |
| [docs/design/DESIGN.md](docs/design/DESIGN.md) | UI guidelines: stack, dark technical aesthetic, bilingual TH/EN, Damage Map |
| [docs/design/mockup.html](docs/design/mockup.html) | M0 clickable visual mockup (Case Board + Inspection / Damage Map) |
| [docs/adr/](docs/adr/) | Architecture Decision Records |
| [docs/LATER.md](docs/LATER.md) | Deliberately deferred scope |
| [docs/INTERVIEW-QUESTIONS.md](docs/INTERVIEW-QUESTIONS.md) | Garage-interview checklist validating working assumptions |

## Stack (from M1)

Next.js · TypeScript · Tailwind CSS · shadcn/ui · PostgreSQL, behind a tenant-guarded data layer.
