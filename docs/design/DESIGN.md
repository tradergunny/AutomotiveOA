# DESIGN.md — UI Guidelines

Source of truth for look, feel, and frontend conventions. Conceptual language lives in [CONTEXT.md](../../CONTEXT.md); this file is about how the product looks and is coded.

## Stack & structure (locked)

- **Next.js + TypeScript + Tailwind CSS + shadcn/ui** project structure.
- Components: `/components/ui` (shadcn primitives), `/components/blocks` (composed blocks). `cn()` helper from `/lib/utils`.
- Icons: **lucide-react** only.
- Reference artifact: [reference/features-10.tsx](reference/features-10.tsx) — pasted by the founder from their prior project family ("UFC project" style); its conventions govern. Integration of reference components happens at scaffold time, not before.

## Aesthetic: dark technical / bordered

Rules extracted from the reference:

- **Dark-first**, zinc-based neutral scale, shadcn CSS-variable tokens (`--background`, `--muted`, `--primary`…).
- **Sharp geometry**: `rounded-none` on structural surfaces (cards, panels). No soft radii on structure.
- **Thin borders carry the structure**: 1px solid for primary edges, **dashed** for secondary separations (`border-t border-dashed`).
- **Corner-tick decorator** (the signature): 2px `border-primary` brackets on the four corners of key cards.
- **Hatch fills**: 45° `repeating-linear-gradient` stripes for texture/status patterning.
- **Radial-gradient veils** to fade imagery into the surface.
- **Label rows**: `size-4` lucide icon + `text-muted-foreground` caption; large `font-semibold` statements for headings.
- Density: information-dense but calm — this is an operations tool, not a marketing site.

## Typography (proposal — veto welcome)

- Thai-capable pairing at matched weights: **IBM Plex Sans Thai** (or Noto Sans Thai) alongside a matching Latin face (IBM Plex Sans / Geist).
- Tabular numerals wherever money or counts column up (estimates, part lines, balances).

## Language

- **Bilingual TH/EN from day one.** Every user-facing string goes through i18n keys (e.g. next-intl); per-User locale toggle; no hardcoded copy anywhere, including validation and empty states.
- Customer-facing LINE message templates are authored in Thai first.

## Damage Map

- **One unfolded sheet**: top view centered, front/rear/left/right arranged around it — traditional insurance damage-sheet layout. Staff read all visible body damage at a glance; no view switching.
- All exterior zones tappable: bumpers (F/R), grille, hood, roof, boot/bed, each door, each fender/quarter panel, wheels, mirrors, windshield/rear glass, lights.
- Marked zones show state: count badge + severity tint; hatch fill for marked areas (fits the aesthetic).
- Small screens/tablet: pinch-zoom, plus tap-to-expand a single view.
- **Body types in MVP: sedan + pickup.** `Vehicle.bodyType` selects the artwork; zone names stay identical across body types.
- SVG is authored in-repo as a **programmatic React SVG** — typed geometry data (zone id → shape, per body type) plus decor paths; stroke-based, theme-aware, no external asset dependency (D-5).

## Resolved design decisions

- **D-1 Theme: dark-only MVP.** One mode, polished properly. Quotation PDFs remain a separate always-light print artifact. Light mode stays reachable later via shadcn tokens.
- **D-2 Case board: attention-grouped list.** Dense table grouped by what needs a human: In assessment · Awaiting authorization · Waiting (with reason) · In progress · In QC · Ready for pickup · Balance due. Each open case appears in exactly **one** group — the first that matches (M5 ruling); In assessment is the leading catch-all so a just-checked-in car is never invisible. **Balance due** (M7 ruling) holds **delivered** cases still owed money — the one exception to open-cases-only: a delivered case stays on the board, rendered for money rather than work (split balance in red, days since delivered), until its balance clears; Ready rows show the amount to collect at handover. No kanban — Repair Case progress is derived, so drag-to-move is meaningless.
- **D-3 Accent: racing amber-orange.** Starting token: `--primary` ≈ Tailwind orange-500 (`#f97316`), tunable on sight. Corner ticks, CTAs, and active states carry it. Status hues stay conventional: green = done/authorized, amber = waiting/attention, red = declined / QC-fail / overdue balance, blue = in-process (In progress, In QC) — the accent itself is never a status hue. Damage Map severity tint uses the same palette: amber hatch = minor (scratch/dent), red hatch = severe (crack/broken). (Founder may still supply exact UFC-project tokens to override.)
- **D-4 Name: AutomotiveOA** — spelling fixed from the folder's "Automative". Wordmark set in the technical style until a real logo exists; the OA suffix keeps the LINE Official Account association.
- **D-5 Damage Map artwork: programmatic React SVG, refined beyond M0** (founder ruling, 2026-08-26). The M0 mockup's five-view geometry is the starting reference, not a port target: M3 improves silhouettes, proportions, panel details, and zone boundaries (real panel cut lines), and refines the tap/hover/keyboard interactions — while staying a typed in-repo data module. No vector-tool exports, no third-party art.
- **D-6 Repair Case page is stage-led** (founder ruling 2026-08-27). The page headline is the case's **Stage** (CONTEXT.md) rendered as a **stage spine** — a one-line stepper `Assessment → Authorization → Work → Ready → Delivered` with the current stage lit (Waiting/In progress/In QC light "Work" with the specific state written beneath, e.g. "waiting — parts"; Balance due lights "Delivered" with the owed amount beside it) — plus a derived **next-action strip** — one primary action, at most one secondary. In assessment cascades (no Findings → Open inspection; ungrouped Findings → Group into Jobs; unpriced Jobs → Set prices); Awaiting authorization offers Record authorization, with Issue quotation suggested while no Quotation covers the Proposed Jobs — the professional path, never a gate; Waiting shows the blocker itself ("2 parts due Aug 30") instead of a button; Ready and Balance due lead with the money to collect. The header carries stage + one money line only: the lifecycle badge and per-status rollup chips leave the header, the rollup moving into the Jobs section as detail. The strip is a suggestion, never a wizard — Jobs proceed independently and every action stays reachable. Board and case page speak the same Stage vocabulary.
- **D-7 Job cards are records, not forms** (founder ruling 2026-08-27). A card renders read-only, and only what its status warrants: Proposed = the offer (price, payer, authorize/decline); Authorized/Waiting/In progress/QC = the working view (technician, parts + ETAs, transitions, photos); Completed = a receipt (what, who, price, photos — no inputs); Cancelled/Declined = one quiet line with the reason. Empty scaffolding never renders — no headings over nothing, just a small add affordance where adding makes sense. Field changes live behind an explicit per-card **Edit** toggle; **actions are not edits** — status transitions, authorization recording, and part-arrival keep always-visible controls. Parts table: fully spread while the Job is active (refining the earlier always-open ruling), one summary line once terminal.
- **D-8 The quiet rulebook** (founder ruling 2026-08-27). A colored chip means exactly one thing: a **workflow state** (Stage, Job status, part order status, authorization state) — at most one chip per list row; counts and metadata are plain sentences with at most a tinted word ("2 findings — 1 **severe**, 1 minor"). The all-caps eyebrow-label-over-every-field idiom retires: where a value needs naming, quiet muted label–value pairs; self-evident values (฿ amounts, names in known slots) go unlabeled. Real type steps (page title > section title > body > meta) and air at section seams — density lives in tables, not everywhere. Dark-only (D-1) reaffirmed against a light reference: founder's 2026-08-27 "ClaimTrack" screenshot contributes its *organization* (one chip per row, calm label–value pairs, whitespace rhythm, per-vehicle visual identity), explicitly not its light/rounded skin.
- **D-9 Cases wear the car's face** (founder ruling 2026-08-27). Board rows and the case page header carry a small photo thumbnail of **the actual vehicle** — first check-in walkaround photo, no new capture flow — falling back to a plain body-type icon when none exists yet. Real photo over brand logo: it distinguishes three same-model cars in the yard, and no logo asset set to license or maintain.
- **D-10 Case page skeleton: fixed order, stage-aware shrinking** (founder ruling 2026-08-27). One order, always: **Header → Inspection → Jobs → Money → Customer Updates → Activity**. The header absorbs the old Vehicle/Contact cards — car photo, plate, make/model/color, contact name + phone, stage spine, next action, one money line; secondary identity detail (province, odometer, primary-vs-contact) goes small or lives on the linked pages. The walkaround photo grid folds into the Inspection area. Sections never reorder; a section irrelevant to the current Stage collapses to one quiet line (Inspection once work takes shape; Money until Ready/Balance due; Activity always opens as "last event" + expand). Tabs and stage-based reordering rejected: fixed geography preserves muscle memory, shrinking provides the focus.
