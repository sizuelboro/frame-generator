# Changelog

All notable changes to FrameForge. The three deliverables ship together and
share one version number:

| Component | Path |
| --- | --- |
| Studio (browser) | `index.html` + `js/` |
| Library Worker | `frameforge-worker11/` |
| Canva app | `frameforge-canva-app11/` |

Reference material that is not version history lives in `docs/`.

---

## 7.5.1

Publishing a single frame can no longer destroy an existing one. Studio only;
the Worker and the Canva app are unchanged.

### Fixed

- **Publishing with a name that was already taken replaced that cloud entry.**
  `Publish to Canva Dev` posted without `createOnly`, so the Worker matched on
  the name slug and overwrote the stored frame, its paths and its assets. A
  typo, or simply forgetting that `Floral Arch` had been published last week,
  destroyed the older frame with no warning and no undo - and any Canva
  element already inserted from it kept pointing at the replaced assets.
  Single publish now sends `createOnly: true`, exactly like Bulk 100, so the
  Worker refuses to overwrite and the Studio publishes under a free name
  instead. Only a `201 Created` is accepted as success.

### Added

- **Automatic numbering on collision.** A taken name is published as the next
  free number - `Floral Arch` becomes `Floral Arch 2`, and `Floral Arch 2`
  becomes `Floral Arch 3` rather than `Floral Arch 2 2`. Numbering matches the
  slug rules the Worker uses, fills gaps, and clips the base name before
  appending the suffix so the result stays inside the 120-character limit.
  The success toast names the entry that was created and says the existing
  frame was kept.
- **Live name check in the publish dialog.** `uiForm` fields accept an
  optional `liveHint(value)` callback, debounced and safe against out-of-order
  async answers. The publish dialog uses it to show `Free - a new entry will
  be created` or `"Floral Arch" already exists - this publishes as "Floral
  Arch 2"` while you type, so the rename is never a surprise. If the library
  cannot be read the hint degrades to a warning; it never blocks publishing.
- **Collision retry.** A 409 `NAME_EXISTS` from a name claimed between the
  check and the POST is retried under the next free name, up to six attempts,
  sharing the 429 `Retry-After` handling bulk publishing already had.

### Changed

- The publish dialog reads the manifest once and feeds both the live name
  check and the folder picker from that single response, so opening the dialog
  costs no extra request.
- A name that slugs to nothing - emoji only, punctuation only - is rejected in
  the dialog rather than by the Worker.

### Notes

- The Worker still replaces on a plain name match when `createOnly` is absent.
  That path is unchanged on purpose, so older Studio builds and the
  compatibility suite behave exactly as before.

---

## 7.5.0

Multi-opening auto-detect. A mockup photo with several openings - a room shot
with three posters, a shelf of frames, a phone next to a tablet - now becomes
one frame per opening instead of one frame over the largest one.

### Fixed

- **Every opening but the largest was silently discarded.** `_openingMask()`
  ran `_largest(...)` over the interior background regions and threw the rest
  away, so a three-poster room mockup published a single drop target over the
  biggest poster. Nothing in the UI said so: no warning, no count, no hint
  that two openings had been dropped. `_openingMasks()` now keeps every
  region that passes an area filter, and `detectOpening()` returns them as
  `openings[]` with a `skipped` count for the regions it rejected.
- **Several flat-colour screens collapsed into one giant quad.** The corner
  trackers in `autoScreen()` are global, so three green rectangles produced a
  single quad spanning all three - a frame covering the gaps between them.
  The cleared pixels are now labelled into connected components and each
  screen gets its own quad, exposed as `quads[]`.
- **Bulk 100 could not produce multi-opening frames at all.** The overlay
  branch of `bulkPrepareOne()` used `r.pts` only. It now maps every detected
  opening to its own drop-target path, checks the count against
  `MAX_PATHS_SINGLE`, measures the combined budget, and names the detection
  `opening x3` so the run report shows what was found.

### Changed

- `Pick opening` and `Auto screen` create one frame per opening, named
  `Opening Frame 1..n` / `Screen Frame 1..n`, with the overlay kept on top.
  A single opening keeps its old name and geometry exactly.
- Frames are created in reading order - top row left to right - not in the
  largest-first order the detector returns, so `Opening Frame 1` is the
  top-left opening. Rows are grouped with a tolerance of half the shortest
  opening, so an uneven gallery wall still reads row by row.
- Openings smaller than 0.3% of the image are treated as dust and skipped,
  capped at 12 openings per mockup. Skipped regions are reported in the
  toast and in the bulk detection label rather than being hidden.
- Near-rectangular openings are emitted as clean 4-point rect frames; the
  rest are traced, matching how the primary opening was already handled.
- The morphology close is computed once in `_holeMask()` and shared. A
  single-opening mockup costs the same four morphology passes it always did;
  each extra opening adds two. Proved by counting passes in the test suite.

### Notes

- Openings share one element and therefore one combined 1980-byte budget.
  Three rect openings measure about 190 bytes in total, so the practical
  ceiling is the 29-path limit, not the budget.
- Canva clips a dropped image to the path but cannot keystone it. Openings
  photographed at a strong side angle still look flat inside the frame; that
  is a platform limit, not a detection one.

---

## 7.4.0

Consistency, hardening and maintainability pass. No change to the creator
workflow: build a mockup, fit the canvas, publish, refresh the library, add.

### Fixed

- **Path budget disagreement between layers.** The Worker rejected publishes
  above 1980 bytes while the Canva app and the Studio validated against
  Canva's raw 2048-byte ceiling, so a frame could pass locally and then fail
  in the cloud. All three layers now read one budget from
  `shared/frameforge-limits.js`. `npm run check:limits` fails if they drift.
- **Exact-multi frames measured with the wrong rule.** An exact-multi
  silhouette inserts one element per path, so each path has its own budget.
  The Worker and the Studio's bulk-publish path both measured the combined
  string instead, rejecting valid multi-object silhouettes.
- **`multiElement` was not persisted.** It was documented as fixed in
  `VALIDATION.txt` but was dropped from the stored manifest entry, so the
  Canva app had to guess the insert mode from `paths.length`. It is now
  stored, and older manifest rows have it derived on read.
- **Remove background did nothing.** `removeBg` is a pure function that
  returns new image data. A later rebind of `#btnRemoveBg` replaced the
  original handler but discarded the return value, so the button ran the work
  and then threw the result away.
- **Three dead duplicate handlers.** `#btnNew`, `#btnSaveTpl` and
  `#btnRemoveBg` were each assigned twice. The first assignment was
  unreachable, which is how the background-removal regression went unnoticed.
- **Enclosed holes beyond the tracer cap were silently filled.** A contour
  carries at most six knockouts. Holes past that cap, or under the minimum
  area, were dropped without being counted, so a frame could publish with
  filled holes and no warning.

### Added

- **Origin allowlist on the Worker.** Set `ALLOWED_ORIGINS` to restrict admin
  routes. Reads stay public so inserted frames keep loading their assets. An
  admin write from an origin outside the list is refused with 403 even when
  the caller holds a valid token. Leaving it empty preserves the old open
  behaviour.
- **Rate limiting.** `ADMIN_LIMIT` (150/min) and `READ_LIMIT` (300/min)
  bindings use the Workers Rate Limiting API, with an in-isolate token-bucket
  fallback if the bindings are missing, and an early 413 on an oversized
  `Content-Length` so a large body is refused before it is buffered. The
  admin quota is sized so a full "Bulk 100" run fits, and bulk publishing now
  treats a 429 as a wait: it honours `Retry-After` and resumes the same frame
  instead of aborting the batch.
- **Enclosed-hole verification.** Inner rings get explicit opposite winding,
  then the finished path is probed with `isPointInPath` under the nonzero fill
  rule to confirm each hole really is a hole. Whatever cannot be cut is
  counted as `unbridgedHoles`, stored on the cloud entry, surfaced as a toast
  at publish time, and shown as a warning badge in the Canva app with a
  pointer to Smart Mask.
- **`GET /api/health`** reporting version, active path budget, and whether
  origin locking and rate limiting are configured.
- **Test suites.** `npm test` runs the limit-drift guard, 27 Worker
  regression tests against an in-memory R2 stub, and 51 browser checks that
  load the real Studio bundle in headless Chromium, including geometric
  proofs that donut holes are cut out.

### Changed

- **Native dialogs replaced everywhere.** The Studio's remaining
  `prompt()`/`confirm()` calls are gone. `uiForm` and `uiNumber` provide
  multi-field dialogs with a masked admin-token field, inline range
  validation, and Escape/backdrop cancel. Native dialogs are blocked outright
  in several embedded viewers, which made those buttons look dead.
- **Studio split into modules.** `index.html` went from 3,826 lines to 325
  and is now markup only. Logic lives in 17 ordered classic scripts under
  `js/`. They share one global scope exactly as the single inline script did,
  so the order in `index.html` is load-bearing. The 407 KB base64 demo
  overlay moved to `js/00-demo-overlay.js`, which makes the markup
  diffable. Verified pixel-identical to the previous build.
- **Smart Mask validates before decoding.** File type and size were checked
  after the photo had already been read and decoded into memory.
- **Documentation consolidated.** Seven scattered version files became this
  changelog plus `docs/`.

### Compatibility

Verified by `npm run test:compat` (33 checks):

- Every `localStorage`/`sessionStorage` key is unchanged, so saved mockups,
  Worker URL, admin token and bleed settings all survive the upgrade.
- Manifest rows written by 7.0-7.3 still load, keep every original field, and
  have `multiElement` derived on read. Republishing an existing name still
  replaces rather than duplicates.
- An already-installed Canva app build keeps working against the new Worker:
  `folderSystem`, `bulkCreateOnly`, `frames`, `folders` and `count` are
  unchanged and all new fields are additive.
- With `ALLOWED_ORIGINS` unset, admin writes from any origin still succeed, so
  upgrading the Worker alone changes nothing.
- The Studio refactor lost nothing: all 121 original functions are still
  defined, all 43 referenced element ids resolve, and the static markup has
  the same 39 ids.

### Known limitations

- Enclosed holes are supported up to six knockouts per contour, bounded by
  the path byte budget. Beyond that they are reported rather than cut; use
  Smart Mask for an exact cut-out.
- `manifest.json` and `folders.json` are single R2 objects. Keep publishing to
  one creator session at a time, or introduce a Durable Object before
  concurrent multi-user publishing.
- Canva account-bound behaviour (Preview insertion, drag and drop, template
  copies opened from a separate account, mobile) still has to be verified
  manually. See `docs/buyer-test.md`.

---

## 7.3.1

Backward-compatible hardening of the Worker and the Canva app.

- JSON responses made non-cacheable with content-sniffing and referrer
  protections; asset responses given content-sniffing protection.
- Frame, asset and Smart Mask dimensions capped at 16384 px and required to
  be finite.
- PNG/JPEG data URLs verified against their real file signatures rather than
  their declared MIME type.
- Native paths required to have one `M`, supported commands only, finite
  coordinates, and a closing `Z`.
- Worker URLs required to be HTTPS, with localhost HTTP kept for development.
- Smart Mask photo uploads restricted to images of at most 25 MB.
- Admin-token UI explained as session-only and given a Clear token action.
- Active folder buttons exposed their selected state to assistive technology.

## 7.2.0

Folder visibility fix.

- A created folder appears in the sidebar immediately via a functional state
  update, then the app reloads `/api/frames` and verifies it exists in Worker
  storage. Success is shown only after that verification, so an old Worker
  now produces a clear error instead of a false success.
- Search is cleared and the new folder becomes active.

## 7.0.0

Folder system and bulk publishing.

- Folder CRUD on the Worker, with frames in a deleted folder moved to
  Uncategorized rather than deleted.
- Bulk publish with auto-rename, and create-only publishing that refuses to
  overwrite an existing name.

## 6.3.0

Multi-fidelity silhouette correction.

- Preserved open gaps between legs and between arms and body.
- Preserved small light cut-outs and separated hair strands.
- Dedicated aligned path budgets for upper hair/body and lower legs.
- Packed water into more native paths without aggressive straight-line
  simplification.
