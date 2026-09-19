# Validation

Reproduce with `npm test` from the repository root.

```
npm run build:limits   regenerate js/01-limits.js from the source of truth
npm run check:limits   limit drift guard
npm run test:worker    Worker regression tests
npm run test:compat    backward-compatibility checks
npm run test:studio    Studio browser suite (headless Chromium)
```

## Automated results — 7.4.0

### Limit drift guard

```
Limits are consistent across all layers:
  PATH_BUDGET = 1980
  CANVA_HARD_PATH_LIMIT = 2048
  MAX_PATHS_SINGLE = 29
  MAX_PATHS_MULTI = 12
  MAX_DIMENSION = 16384
  MAX_COORDINATE = 10000000
```

Also verified to fail correctly: setting `PATH_BUDGET` to 2048 in the Canva
app mirror exits non-zero with a drift report.

### Worker — 27 passed, 0 failed

Against an in-memory R2 stub:

- shared path budget enforced, error text names the budget
- exact-multi accepted on a per-object budget; the same paths rejected as one
  combined element
- `multiElement` persisted and returned by `GET /api/frames`
- unconfigured Worker stays wide open (backward compatible)
- allowlisted origin echoed, other origins get no CORS header, `Vary: Origin`
  set
- admin write from a non-allowlisted origin refused with 403 **even with a
  valid token**; originless server-to-server clients still allowed
- rate-limit binding returns 429 with `RATE_LIMITED` and `Retry-After`;
  in-isolate fallback throttles when the binding is absent
- oversized `Content-Length` refused with 413 `BODY_TOO_LARGE`
- pre-existing protections intact: 401 without a token, two-`M` path
  rejected, `Q` command rejected, oversized dimension rejected, PNG bytes
  that do not match the declared type rejected

### Backward compatibility — 33 passed, 0 failed

- all seven Studio storage keys unchanged, plus both Canva app keys
- legacy manifest rows load with every field intact; `multiElement` derived
  for old rows; republishing a legacy name replaces (200) rather than
  duplicates
- old Canva app response contract intact (`folderSystem`, `bulkCreateOnly`,
  `frames`, `folders`, `count`); publish without `multiElement` accepted
- admin write from any origin still succeeds while `ALLOWED_ORIGINS` is unset
- a full 100-frame Bulk run completes inside the admin quota, and the bulk
  loop treats 429 as retryable and honours `Retry-After`
- route surface unchanged: `/api/frames`, `/assets/*` 404 and 400 cases,
  `OPTIONS` 204, root 200, unknown delete 404

### Studio — 70 passed, 0 failed

Loads the real bundle in headless Chromium.

**Bundle integrity.** No script errors; `FF_LIMITS` present with
`PATH_BUDGET = 1980`; demo overlay loaded from its split-out file; state,
renderer, dialogs, `removeBg`, `detectSilhouette` and `bulkPrepareOne` all
defined; all seven toolbar handlers bound; budget measured combined for
single frames and per object for multi.

**Dialogs.** Auto-bleed dialog opens with a number input, keeps itself open
on an out-of-range value and shows the inline message `Must be 20 or less.`,
then applies a valid value. Library settings asks for URL and token together,
masks the token, rejects a non-HTTPS Worker URL, and cancels on Escape.

**Features that already worked.** Canvas property inputs render and drive
the document, demo layers load, selecting a frame renders its properties, the
layer list renders, `fit()` recomputes zoom, `exportCanvas` produces
non-blank pixels, and Save as mockup round-trips through the same
`localStorage` key with its thumbnail and with frame content stripped.

**Enclosed holes.** Proved geometrically with `isPointInPath` under the
nonzero fill rule rather than by trusting internal counters:

| Case | Result |
| --- | --- |
| Single centred hole (donut) | ring filled, hole centre **not** filled |
| Two separate holes | both holes clear, solid area between them filled |
| Path shape | exactly one `M`, closed with `Z`, 1979 bytes (within 1980) |
| Nine holes, cap is six | 9 accounted for, 3 reported unbridged, **3 measurably filled — report matches reality** |

### Regression check against the previous build

The Studio refactor was verified non-behavioural by screenshotting the old
single-file build and the new bundle at 1440x900 and differencing them:

```
differing pixels: 0/1296000 = 0.0000%
diff bbox: None
```

### Builds

- `frameforge-canva-app11`: `npm install` (785 packages), `tsc --noEmit`
  clean, `canva apps build` produced `dist/app.js` at 257 KB against a 5 MB
  limit. The previous audit could not verify this because its sandbox had no
  network access.
- `frameforge-worker11`: `npm install` (40 packages) clean; `wrangler.jsonc`
  parses.

## Still requires a real Canva account

Automated tests cannot reach these. See `docs/buyer-test.md`.

- Preview inserts the element in your chosen design type.
- Locked-overlay / unlocked-frame drag and drop is reliable.
- Crop, zoom, reposition, Replace, save and reopen, export.
- A template copy opened from a separate Canva Free account, without the app
  installed.
- Any promised mobile behaviour.
- The Worker hostname is allowed in the Developer Portal's network settings.
