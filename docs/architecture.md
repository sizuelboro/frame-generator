# Architecture

FrameForge Studio turns a mockup image into a photo frame: a transparent
overlay plus the opening (one or more polygons) a photo drops into. It was
first built to publish native Canva frames; that path (Cloudflare Worker,
Canva app, PDFs, Bulk publish) has been removed while the Studio is
repurposed as Pixopik's frame generator. Tracing, bleed and hole handling
below still follow the Canva-era path rules, because the detectors simplify
against them.

```
  Studio (browser)
  index.html + js/   ──▶  overlay PNG + frame-coords.json
  trace / bleed / fit
```

A mockup can have several openings - a room shot with three posters, a shelf
of frames. Each opening becomes its own frame layer. All the openings share
one combined path budget; in practice the binding limit is the 29-path
ceiling, not the bytes.

`detectOpening()` returns `openings[]` (largest first, `pts` kept as an alias
for the first one) plus a `skipped` count of regions rejected by the 0.3%
area filter. `autoScreen()` does the same with `quads[]` for flat-colour
screens. Openings are capped at 12 per mockup.

An **exact multi** silhouette is the exception: each traced object gets its
own path budget.

## Path budget

The tracers simplify every opening to at most **1980 bytes** of path data,
one `M` per path, no `Q` curves (originally Canva's shape limits). The budget
lives in `shared/frameforge-limits.js` and is the only place it is defined;
the Studio consumes the generated `js/01-limits.js`.

`npm run check:limits` fails if any Studio module hardcodes a budget literal.

Measurement depends on the shape:

| Frame | Rule |
| --- | --- |
| Overlay or single silhouette | Combined bytes of the overlay rect plus every opening path |
| Exact multi silhouette | Each path measured on its own |

## Native optimizer

- Relative integer coordinates derived from quantized absolute points.
- The encoder picks the most compact of `l`/`h`/`v` and drops optional
  separators.
- The simplifier strongly protects concave notches and inner contours, so
  hands, hair and knockouts survive byte reduction.

## Enclosed holes

A path allows exactly one `M`, so a fully enclosed hole cannot be a
separate subpath. FrameForge stitches inner rings into the outer ring with
zero-width bridges, giving one `M` that still describes the hole. The hole
reads as a hole only if its ring winds opposite to the ring containing it, so
winding is normalised explicitly and then **verified** by probing the finished
path with `isPointInPath` under the nonzero fill rule.

Limits: at most six knockouts per contour, bounded by the byte budget. Holes
beyond that are counted in `unbridgedHoles` and reported. Cuts that
reach the outside are unaffected and always preserved.

## Studio bundle

`index.html` is markup only. Logic is ordered classic scripts in `js/`.
They deliberately share one global scope, mirroring the original single
inline script, so **the order in `index.html` is load-bearing**. Adding a file
at the end is safe; reordering is not.

`js/01-limits.js` is generated - run `npm run build:limits` after editing
`shared/frameforge-limits.js`.
