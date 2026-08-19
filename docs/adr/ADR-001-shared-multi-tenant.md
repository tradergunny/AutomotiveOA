# ADR-001: Shared multi-tenant architecture

**Status:** Accepted — 2026-08-19

## Context

The platform is B2B SaaS: built with a pilot garage, sold to many garages. The two viable shapes are a shared deployment (one system, one database, rows scoped by `shop_id`) or an instance per garage (isolated deployment and database per tenant). The team is small, onboarding speed matters commercially, and no buyer has demanded hard data isolation.

## Decision

One deployment, one database. Every tenant-owned row carries a `shop_id`, and every query is scoped to one Shop. No product feature ever reads across Shops.

## Consequences

- Cheapest to operate; one upgrade updates every tenant; a new garage onboards in minutes.
- The failure mode is severe: a single unscoped query is a data leak between competing garages. Mitigation: tenant scoping is enforced at the data-access layer (row-level security or a repository-level tenant guard) — never by hand-written `WHERE` clauses per feature — and covered by tests that prove cross-tenant reads fail.
- Noisy-neighbor performance risk is accepted at MVP scale.
- Revisit if a buyer demands hard isolation or data residency; that becomes a premium deployment option, not a rewrite of the default.
