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
| `tools/` | Limits generator, drift guard, test runners. |
| `tests/` | Studio browser suite. |
| `docs/` | Architecture, deploy, cloud library, buyer checklist, validation. |
| `mockups/` | Sample overlay and thumbnail assets. |

## Quick start

```bash
npm install          # root has no runtime deps; installs nothing to ship
npm test             # limits guard + Worker tests + Studio browser tests
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

Read [docs/architecture.md](docs/architecture.md) before changing tracing,
bleed or path encoding.

## Creator workflow

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
