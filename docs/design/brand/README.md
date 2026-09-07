# Brand assets — LINE Official Account

Artwork for the **AutomotiveOA** product's own LINE OA (the platform account, not a
pilot Shop's — every Shop owns its own OA per [ADR-002](../../adr/ADR-002-per-shop-line-oa.md)).
Uploaded in [LINE OA Manager](https://manager.line.biz/) → Settings → Account settings,
per Part 1 of [LINE-SETUP.md](../../LINE-SETUP.md).

| File | Size | Where it goes |
|---|---|---|
| `line-oa-profile-640.png` | 640 × 640 | Profile picture (LINE recommends 640 × 640, max 3 MB, JPG/PNG) |
| `line-oa-cover-1080x878.png` | 1080 × 878 | Background image (LINE's recommended size, max 3 MB) |
| `line-oa-context-preview.png` | — | Not uploaded: proof of how both land in LINE's own chrome |

## What is drawn, and why

Both follow [DESIGN.md](../DESIGN.md): `#09090b` field, racing amber-orange
`#f97316` (D-3), sharp geometry, 1px borders with dashed secondaries, 45° hatch,
radial veils, and the corner-tick decorator. Type is the repo's own self-hosted
IBM Plex — Sans for Latin, Sans Thai for Thai, Mono for the eyebrow.

**Profile.** A two-tone `AO` monogram (white A, amber O) inside a corner-ticked
frame. The frame is inset 118px so its ticks sit **inside the inscribed circle** —
LINE crops profile pictures to a circle, and nothing here is clipped by it. The
colour split is what carries identity down at 28px in a chat list.

**Cover.** Wordmark (D-4: wordmark until a real logo exists), a Thai-first
tagline, and the D-6 **stage spine** — ประเมิน → อนุมัติ → ซ่อม → พร้อมรับ → ส่งมอบ —
in the product's own vocabulary. The bottom ~240px carries no content and the
frame stops above it, because LINE overlays the profile circle and account name
there.

## Regenerating

Artboards are HTML in `src/`, rendered by headless Chrome at the exact upload size:

```bash
node docs/design/brand/src/render.mjs
```

It inlines `app/fonts/*.woff2` as base64 (so an artboard opened directly in a
browser needs the build step) and overwrites the three PNGs. Requires Google
Chrome at its standard macOS path.
