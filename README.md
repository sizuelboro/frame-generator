# FrameForge

Turn a mockup image into a **native Canva frame** — a real Canva shape with a
`dropTarget` path. The buyer needs nothing installed, and the element behaves
like any other Canva frame.

Version **7.5.0**. See [CHANGELOG.md](CHANGELOG.md).

## Layout

| Path | What it is |
| --- | --- |
| `index.html` + `js/` | FrameForge Studio, the browser editor. Deploys to Cloudflare Pages. |
| `frameforge-worker11/` | Cloudflare Worker + R2 frame library. |
| `frameforge-canva-app11/` | Canva side-panel app. |
| `shared/frameforge-limits.js` | **Single source of truth** for Canva platform limits. |
| `tools/` | Limits generator, drift guards, deploy sync, test runners. |
| `tests/` | Studio browser suite. |
| `docs/` | Architecture, deploy, cloud library, buyer checklist, validation. |
| `docs/archive/` | Superseded release notes. History only — do not treat as current. |
| `mockups/` | Sample overlay and thumbnail assets. |
| `repo/` | **Generated** Cloudflare Pages deploy mirror. Never edit by hand. |

## Quick start

```bash
npm install          # root has no runtime deps; installs nothing to ship
npm test             # limits + script order + deploy mirror guards, then all tests
```

Per package:

```bash
cd frameforge-worker11     && npm install && npx wrangler deploy
cd frameforge-canva-app11  && npm install && npm run build
```

Full instructions: [docs/deploy.md](docs/deploy.md).

## Working on this

**Never hardcode a Canva path budget.** Edit
`shared/frameforge-limits.js`, then:

```bash
npm run build:limits   # regenerates js/01-limits.js for the Studio
npm run check:limits   # fails if any layer drifted
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

0. Pick a **ratio preset** and orientation, hit **Add opening**, then choose a
   **frame design**. Skip this if you are starting from an existing mockup
   photo.
1. Build or open the mockup in the Studio.
2. Leave **Auto bleed** at 6px (8px for rough edges). It is a ceiling, not a
   fixed amount — overlay opacity is measured per opening vertex and thin
   borders get less automatically.
3. **Fit canvas.**
4. **Publish to Canva Dev.** Reusing a name replaces that cloud entry.
5. **Refresh library** in the Canva app.
6. Insert a **new** copy to test — already-inserted elements never update.

## Silhouette frames

Select or add an image, then **Silhouette frame**.

- Transparent PNGs are traced from alpha.
- Opaque images have their background cleared inward from the canvas edges,
  so colours enclosed by the subject survive.
- The source layer is hidden, not deleted, and one polygon frame is created.
- Publish that frame; no source photo or overlay is baked into the element.
- Cuts that reach the outside are always preserved. Fully enclosed holes are
  bridged and verified — up to six per contour. Anything that cannot be cut
  is reported rather than silently filled, and Smart Mask gives an exact
  cut-out.

## Before you sell

`npm test` covers the code. Canva account behaviour it cannot reach:
work through [docs/buyer-test.md](docs/buyer-test.md).
