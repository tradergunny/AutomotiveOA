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
- **D-2 Case board: attention-grouped list.** Dense table grouped by what needs a human: In assessment · Awaiting authorization · Waiting (with reason) · In progress · In QC · Ready for pickup · Balance due. Each open case appears in exactly **one** group — the first that matches (M5 ruling); In assessment is the leading catch-all so a just-checked-in car is never invisible; Balance due needs Payments and arrives with M7. No kanban — Repair Case progress is derived, so drag-to-move is meaningless.
- **D-3 Accent: racing amber-orange.** Starting token: `--primary` ≈ Tailwind orange-500 (`#f97316`), tunable on sight. Corner ticks, CTAs, and active states carry it. Status hues stay conventional: green = done/authorized, amber = waiting/attention, red = declined / QC-fail / overdue balance, blue = in-process (In progress, In QC) — the accent itself is never a status hue. Damage Map severity tint uses the same palette: amber hatch = minor (scratch/dent), red hatch = severe (crack/broken). (Founder may still supply exact UFC-project tokens to override.)
- **D-4 Name: AutomotiveOA** — spelling fixed from the folder's "Automative". Wordmark set in the technical style until a real logo exists; the OA suffix keeps the LINE Official Account association.
- **D-5 Damage Map artwork: programmatic React SVG, refined beyond M0** (founder ruling, 2026-08-26). The M0 mockup's five-view geometry is the starting reference, not a port target: M3 improves silhouettes, proportions, panel details, and zone boundaries (real panel cut lines), and refines the tap/hover/keyboard interactions — while staying a typed in-repo data module. No vector-tool exports, no third-party art.
