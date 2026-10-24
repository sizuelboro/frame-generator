# FrameForge

Make photo frames for Pixopik's frame library: a transparent overlay plus the
opening a photo drops into. Generate a moulding, or start from your own
artwork, then **Export for Pixopik**. The Canva publishing path (Worker, Canva
app, PDFs, Bulk publish) has been removed.

Version **7.6.0**. See [CHANGELOG.md](CHANGELOG.md).

## Layout

| Path | What it is |
| --- | --- |
| `index.html` + `js/` | FrameForge Studio, the browser editor. Deploys to Cloudflare Pages. |
| `shared/frameforge-limits.js` | **Single source of truth** for the path limits the tracers simplify against. |
| `tools/` | Limits generator, guards, deploy sync, test runners. |
| `tests/` | Studio browser suite. |
| `docs/` | Architecture, deploy, PSD export, validation. |
| `docs/archive/` | Superseded release notes. History only — do not treat as current. |
| `mockups/` | Sample overlay and thumbnail assets. |
| `repo/` | **Generated** Cloudflare Pages deploy mirror. Never edit by hand. |

## Quick start

```bash
npm install          # root has no runtime deps; installs nothing to ship
npm test             # limits + script order + deploy mirror guards, then all tests
```

Full instructions: [docs/deploy.md](docs/deploy.md).

## Working on this

**Never hardcode a path budget.** Edit `shared/frameforge-limits.js`, then:

```bash
npm run build:limits   # regenerates js/01-limits.js for the Studio
npm run check:limits   # fails if a script hardcodes a budget
```

The Studio is a bundle of **ordered classic scripts**, not ES modules. They
share one global scope on purpose, so the order in `index.html` is
load-bearing. Appending a file is safe; reordering is not.

```bash
npm run check:order    # fails if index.html and js/ disagree, or order regresses
```

**`repo/` is generated, not authored.** It is the Cloudflare Pages deploy
mirror of `index.html`, `_headers`, `js/` and `mockups/`. Edit the root, then:

```bash
npm run sync:deploy    # regenerate repo/ from the root (repo/.git is preserved)
npm run check:deploy   # fails if the mirror drifted from the root
```

Both guards run as part of `npm test`.

Read [docs/architecture.md](docs/architecture.md) before changing tracing,
bleed or path encoding.

## Two ways to make a frame

The Studio opens by asking how you want to make the frame. The choice only
decides which controls the left panel shows; switching later with the
**Generate / From image** tabs never changes the canvas.

| Mode | Left panel | Use it for |
| --- | --- | --- |
| **Generate** | Shape (1:1, 4:5, 3:4, 2:3, 9:16, portrait/landscape), Style grid, Border width | A moulding drawn for you. One click on a style draws the frame; changing any setting redraws the same frame. |
| **From image** | Upload frame image, Auto-detect opening, Select manually, Rect / Perspective, Remove background, Silhouette | Your own artwork, such as a hand-drawn crayon frame. |

Both modes share **Decorate** (image, shadow, text, shape layers), the layer
list and **Export for Pixopik**.

## Frame shapes and designs

The opening shapes come from `FF_RATIOS` in `js/17-ratio-presets.js`. Generate
offers 1:1, 4:5, 3:4, 2:3 and 9:16; the print-only presets (A-series, 5:7,
11:14) stay in the list so older projects and the AI round trip still resolve
them.

Frame designs are **generated, not stitched from asset PNGs**. A flat 256px
swatch is drawn as four bars mitred at 45 degrees around the opening, so every
ratio gets fresh geometry and nothing is stretched or tiled. Nine built-ins
(white, black, gold, oak, walnut, natural wood, maple, solid oak, natural oak)
plus **Upload texture** — any flat image or colour becomes a frame that meets
correctly at all four corners.

### Why this matters for the AI round trip

**Export for AI** now writes the declared ratio into the scene sidecar, and
**Import AI scene** checks the returned opening's own aspect against it within
2%. The older canvas-aspect check missed wrong-ratio returns because image
models usually keep the canvas size and quietly change the opening inside it —
which is exactly how a "US Letter" opening (0.773) ends up sold as A4 (0.707).

## Creator workflow

**Generate:** pick a shape, click a style, adjust the border width, then
**Export for Pixopik**.

**From image:**

1. **Upload frame image** (or drop it on the canvas). The opening should be
   transparent; if it is white, run **Remove background** first.
2. **Auto-detect opening**. For hand-drawn borders (crayon, watercolour) it
   tucks the photo under the dense strokes so no gaps show. Or **Select
   manually** and click inside the opening (tolerance 25 to 40).
3. Optional: select the opening and **Set image** to check the fit.
4. Leave **Advanced → Auto bleed** at 6px (8px for rough edges). It is a
   ceiling, not a fixed amount.
5. **Export for Pixopik**.

## Export for Pixopik

One dialog, two files. Details: [docs/pixopik-export.md](docs/pixopik-export.md).

| Field | What it does |
| --- | --- |
| Name | The label in Pixopik's Elements → Frames |
| ID | Made from the name; also the file name. Built-in Pixopik ids are refused |
| Group | One of Pixopik's eight frame groups |
| Keywords | For Pixopik's frame search |
| Opening | Only shown when there are several; a Pixopik frame holds one |
| Quality | Longest side of the overlay PNG: 1000, 1600 (default) or 2400 px |

The canvas is cropped for you (no **Trim canvas** needed), the opening gets
Auto bleed and is simplified to Pixopik's limits (at most 400 points), and the
dialog checks the result against the same rule Pixopik validates with before
it lets you export:

- `<id>.png` goes to Pixopik's `public/frames/`
- `<id>.frame.txt` holds the entry to paste into `CUSTOM_FRAMES` in
  `src/lib/customFrames.ts` (**Copy entry** puts it on the clipboard instead)

**Export ▾ · Export overlay PNG** still writes the raw overlay and
`frame-coords.json` in canvas pixels.

## Photoshop PSD export

**Export ▾ · Photoshop PSD (.psd)** writes the mockup as a layered Photoshop
file with the opening as a **smart object**, so a buyer double-clicks one
layer, drops their artwork in and Photoshop re-applies the corner pin itself.

```
FrameForge Mockup.psd          RGB, 8-bit, RLE compressed
├─ Mockup overlay              normal
├─ Shadow                      multiply, at the layer's own opacity
├─ YOUR DESIGN — double-click to replace   smart object, corner-pinned
├─ Scene                       image, shape and text layers, when present
└─ Background                  white, or omitted for a transparent document
```

This is the one thing Canva frames cannot do: Canva clips a dropped image to
the path but cannot keystone it, so an opening photographed at an angle still
looks flat. Photoshop pins the four corners, so the same perspective opening
reads correctly.

- Rect and perspective openings both export; the corners written into the file
  are the opening's own points, not a bounding box.
- An opening that cannot be corner-pinned (zero area, a collapsed edge) is
  exported as a **pre-warped pixel layer** and named as flattened, and the
  toast says how many. A wrong file is never written silently.
- The placeholder art inside the smart object is either the built-in
  "YOUR DESIGN" card or the artwork currently in the frame.
- Detection, bleed and shadow are not touched by this path.

Details and the byte layout: [docs/psd-export.md](docs/psd-export.md).

## Silhouette frames

Select or add an image, then **Silhouette frame**.

- Transparent PNGs are traced from alpha.
- Opaque images have their background cleared inward from the canvas edges,
  so colours enclosed by the subject survive.
- The source layer is hidden, not deleted, and one polygon frame is created.
- Cuts that reach the outside are always preserved. Fully enclosed holes are
  bridged and verified — up to six per contour. Anything that cannot be cut
  is reported rather than silently filled, and Smart Mask gives an exact
  cut-out.
