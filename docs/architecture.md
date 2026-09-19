# Architecture

FrameForge turns a mockup image into a **native Canva frame**: a real Canva
shape element with a `dropTarget: true` path. Because the output is native,
a buyer needs no app installed and the element behaves like any Canva frame.

```
  Studio (browser)                Worker + R2                Canva app
  index.html + js/       ──▶      /api/frames        ──▶     side panel
  trace / bleed / fit            manifest.json               addElementAtPoint
  publish                        assets/*.png                native frame
```

## Single-element frame model

The build creates no Canva group. It creates one shape with several paths:

1. A full-canvas path filled with the transparent mockup overlay image.
2. The traced opening path, marked `dropTarget: true`.

Canva shows one element. A user drags a photo into the opening and adjusts
that image fill. There is no separate overlay layer to lock or hide.

An **exact multi** silhouette is the exception: it inserts one aligned
full-viewBox element per object so each object gets its own path budget, all
sharing a single uploaded starter photo. Replacing one of those frames does
not replace its siblings.

## Path budget

Canva allows 1..30 paths per shape, each up to 2048 bytes, closed with `Z`,
with exactly one `M` and no `Q` curves.

FrameForge publishes against **1980 bytes**, leaving headroom for the
structural overhead Canva counts on top of the raw `d` string. The budget
lives in `shared/frameforge-limits.js` and is the only place it is defined:

- the Worker imports it,
- the Canva app mirrors it in `src/limits.ts`,
- the Studio consumes the generated `js/01-limits.js`.

`npm run check:limits` fails the build if these disagree, and also fails if
any Studio module hardcodes a budget literal.

Measurement depends on the shape:

| Frame | Rule |
| --- | --- |
| Overlay or single silhouette | Combined bytes of the overlay rect plus every opening path |
| Exact multi silhouette | Each path measured on its own |

## Native optimizer

- Native drop-zone output only; Smart Mask is a deliberate fallback, not
  automatic.
- Relative integer coordinates derived from quantized absolute points.
- The encoder picks the most compact of `l`/`h`/`v` and drops optional
  separators.
- The simplifier strongly protects concave notches and inner contours, so
  hands, hair and knockouts survive byte reduction.
- Publishing is blocked when the path data exceeds the safe budget.

## Enclosed holes

A Canva path allows exactly one `M`, so a fully enclosed hole cannot be a
separate subpath. FrameForge stitches inner rings into the outer ring with
zero-width bridges, giving one `M` that still describes the hole. The hole
reads as a hole only if its ring winds opposite to the ring containing it, so
winding is normalised explicitly and then **verified** by probing the finished
path with `isPointInPath` under the nonzero fill rule.

Limits: at most six knockouts per contour, bounded by the byte budget. Holes
beyond that are counted in `unbridgedHoles`, stored on the cloud entry,
reported at publish time, and shown as a warning in the Canva app. Cuts that
reach the outside are unaffected and always preserved.

## Studio bundle

`index.html` is markup only. Logic is 17 ordered classic scripts in `js/`.
They deliberately share one global scope, mirroring the original single
inline script, so **the order in `index.html` is load-bearing**. Adding a file
at the end is safe; reordering is not.

`js/01-limits.js` is generated - run `npm run build:limits` after editing
`shared/frameforge-limits.js`.

## Storage

`manifest.json` and `folders.json` are single R2 objects. There is no
locking, so publish from one creator session at a time. Concurrent
multi-user publishing needs a Durable Object first.
