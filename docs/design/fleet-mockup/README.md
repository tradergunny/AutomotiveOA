# Fleet repair mockup (M9 Step 0)

Throwaway clickable mockup for the Ratchaphruk site visit. One offline file: open `index.html`. Fake data, held in memory, so a reload resets it. No product code depends on this.

Rebuild after editing `mockup.src.html`:

```bash
node docs/design/fleet-mockup/build.mjs
```

**Visual world:** pinned by the founder on 2026-11-08 from two fleet-dashboard screenshots ("exactly" this layout and color) and one minimal sign-in. Light grey ground, white rounded cards, pill nav, one blue accent, large car on white, three columns. Not yet recorded in `docs/design/DESIGN.md`: that waits for the founder's approval of this mockup.

**Demo path:** sign in → type `5201` → open a Visit → add `โช้ค` → close → print the bill → the car's page.

**Placeholders to replace**
- The name สมุดซ่อม (`BRAND` at the top of the script).
- The drawn taxi: swap for real photos of their cars taken at the visit.
- Taxi colors: their real fleet colors are unknown.
- Every plate, person, price and count. The Repair Type list is drafted, not theirs.
- Bill layout and A4 size: compare with their real bill.

**Shown but not promised:** repeat warnings, cost per car and oil-change due need past repairs to be importable (brief Step 8). Pins on the car are mockup-only: Repair Groups don't record a location on the car.
