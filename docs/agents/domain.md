# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo keeps its glossary in `CONTEXT.md`. Wherever a skill says `GLOSSARY.md`, use `CONTEXT.md`, and don't create a separate `GLOSSARY.md`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) updates these when terms or decisions get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── ADR-001-shared-multi-tenant.md
│   └── ADR-002-per-shop-line-oa.md
└── app/
```

New ADRs follow the existing `ADR-NNN-<slug>.md` naming.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-003 (no auto customer notifications), but worth reopening because…_
