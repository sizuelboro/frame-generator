# FrameForge

Turn a mockup image into a photo frame: a transparent overlay plus the
opening a photo drops into. Being repurposed as the frame generator for
Pixopik; the Canva publishing path (Worker, Canva app, PDFs, Bulk publish)
has been removed.

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

## Print ratios and frame designs

The toolbar opens with a **ratio picker**, a portrait/landscape toggle, **Add
opening**, and a **frame design** picker. Pick the print size first, then the
moulding; everything downstream inherits that choice.

Seven presets, covering what actually sells:

| Ratio | Common sizes |
| --- | --- |
| A-series | A5, A4, A3, A2, A1 |
| 2:3 | 12×18, 16×24, 20×30, 24×36 |
| 3:4 | 9×12, 12×16, 18×24 |
| 4:5 | 8×10, 16×20 |
| 5:7 | 5×7, 10×14 |
| 11:14 | 11×14 |
| 1:1 | Square prints |

The chosen ratio is **recorded on the layer**, not measured back off the
geometry. 5:7 (0.7143) and A-series (0.7071) sit about 1% apart, which is
inside the noise of a traced opening, so measurement alone cannot tell an A4
listing from a 5×7 one.

Frame designs are **generated, not stitched from asset PNGs**. A flat 256px
swatch is drawn as four bars mitred at 45 degrees around the opening, so every
ratio gets fresh geometry and nothing is stretched or tiled. Six built-ins
(white, black, gold, oak, walnut, natural) plus **custom swatch upload** — any
flat image or colour becomes a frame that meets correctly at all four corners.

### Why this matters for the AI round trip

**Export for AI** now writes the declared ratio into the scene sidecar, and
**Import AI scene** checks the returned opening's own aspect against it within
2%. The older canvas-aspect check missed wrong-ratio returns because image
models usually keep the canvas size and quietly change the opening inside it —
which is exactly how a "US Letter" opening (0.773) ends up sold as A4 (0.707).

## Creator workflow

0. Pick a **ratio preset** and orientation, hit **Add design area**, then choose a
   **frame design**. Skip this if you are starting from an existing mockup
   photo.
1. Build or open the mockup in the Studio.
2. Leave **Advanced → Auto bleed** at 6px (8px for rough edges). It is a ceiling, not a
   fixed amount — overlay opacity is measured per opening vertex and thin
   borders get less automatically.
3. **Trim canvas.**
4. **Export ▾ · Export overlay PNG** — writes the transparent overlay and
   `frame-coords.json` (the opening points, with bleed applied).

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
