'use strict';
/* =========================================================================
   GENERATED FILE - DO NOT EDIT
   Source: shared/frameforge-limits.js
   Rebuild: node tools/build-studio-limits.mjs
   ========================================================================= */

/* =========================================================================
   FrameForge — canonical platform limits (SINGLE SOURCE OF TRUTH)
   =========================================================================
   The Studio's tracers and simplifiers size every opening path against
   these numbers. Do not hardcode budgets anywhere else.

   Run `node tools/check-limits.mjs` to verify nothing hardcodes them.

   Canva platform facts (Apps SDK, shape elements):
     - A shape element accepts 1..30 paths.
     - Each path is limited to 2048 bytes of UTF-8 path data.
     - Paths must be closed (Z) and contain exactly one M.
     - Q (quadratic) curves are not supported.

   Why 1980 and not 2048:
     Canva counts the serialised path payload, which carries a small amount
     of structural overhead beyond the raw `d` string. 1980 is the official
     safe budget we publish against, leaving 68 bytes of headroom. Rejecting
     at 1980 on every layer guarantees a frame that validates locally also
     validates in the cloud and inserts in Canva.
   ========================================================================= */

/** Safe UTF-8 byte budget for path data. Applies to every mode. */
const PATH_BUDGET = 1980;

/** Hard Canva ceiling, kept for diagnostics only. Never validate against this. */
const CANVA_HARD_PATH_LIMIT = 2048;

/** Max opening paths in a single combined-budget frame (overlay / single silhouette). */
const MAX_PATHS_SINGLE = 29;

/** Max separate aligned elements in an "exact multi" silhouette. */
const MAX_PATHS_MULTI = 12;

/** Max pixel dimension accepted for any asset. */
const MAX_DIMENSION = 16384;

/** Max decoded bytes for a published overlay/thumb/mask image. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Max decoded bytes for a user photo loaded in the browser for Smart Mask. */
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Absolute value ceiling for any single path coordinate. */
const MAX_COORDINATE = 1e7;

/* Pixopik's frame library (Export for Pixopik). A Pixopik frame opening is a
   `SiteFrame.clip`: one closed polygon of integer points in a 0-1000 box,
   validated by `isFrameClip` in Pixopik's src/lib/siteDocument.ts. Keep these
   in step with that function. */

/** Most points `isFrameClip` accepts in one opening (M plus up to 399 L). */
const PIXOPIK_MAX_POINTS = 400;

/** Longest clip string `isFrameClip` accepts, in characters. */
const PIXOPIK_MAX_CLIP_CHARS = 6000;

/** Clip coordinates are integers from 0 to this value on each axis. */
const PIXOPIK_CLIP_UNITS = 1000;

/**
 * True when a frame is an "exact multi" silhouette, i.e. inserted as several
 * aligned full-viewBox elements that each get their own path budget.
 *
 * A multi frame is measured per path, a single frame is measured combined.
 */
function isExactMulti(frame) {
  if (!frame || frame.mode !== 'silhouette') return false;
  if (frame.multiElement === true) return true;
  return Array.isArray(frame.paths) && frame.paths.length > 1;
}

/** UTF-8 byte length of a string. */
function utf8Bytes(value) {
  return new TextEncoder().encode(String(value == null ? '' : value)).length;
}

/**
 * The single budget rule, shared by every layer.
 *
 * @returns {{ ok: boolean, mode: 'multi'|'single', budget: number,
 *             used: number, worstIndex: number, reason: string }}
 */
function measurePathBudget(frame) {
  const paths = Array.isArray(frame && frame.paths) ? frame.paths.map(String) : [];
  const multi = isExactMulti(frame);

  if (multi) {
    const sizes = paths.map(utf8Bytes);
    let worstIndex = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[worstIndex]) worstIndex = i;
    const used = sizes.length ? sizes[worstIndex] : 0;
    return {
      ok: used <= PATH_BUDGET,
      mode: 'multi',
      budget: PATH_BUDGET,
      used,
      worstIndex,
      reason: used <= PATH_BUDGET
        ? ''
        : `Object ${worstIndex + 1} is ${used} bytes; the safe native budget is ${PATH_BUDGET} bytes per object.`,
    };
  }

  // Overlay-backed frames also ship a full-canvas overlay rectangle in the
  // same element, so it is counted against the combined budget.
  const overlayPath = frame && frame.mode === 'silhouette'
    ? ''
    : `M 0 0 H ${Number(frame && frame.w) || 0} V ${Number(frame && frame.h) || 0} H 0 Z`;
  const used = utf8Bytes([overlayPath, ...paths].join(''));
  return {
    ok: used <= PATH_BUDGET,
    mode: 'single',
    budget: PATH_BUDGET,
    used,
    worstIndex: -1,
    reason: used <= PATH_BUDGET
      ? ''
      : `Combined path data is ${used} bytes; the safe native budget is ${PATH_BUDGET} bytes.`,
  };
}

/** Max number of paths allowed for a given frame shape. */
function maxPathsFor(frame) {
  return isExactMulti(frame) ? MAX_PATHS_MULTI : MAX_PATHS_SINGLE;
}

/* Classic-script consumers (the browser Studio loads plain <script> files)
   read these off the global object. */
if (typeof globalThis !== 'undefined') {
  globalThis.FF_LIMITS = {
    PATH_BUDGET,
    CANVA_HARD_PATH_LIMIT,
    MAX_PATHS_SINGLE,
    MAX_PATHS_MULTI,
    MAX_DIMENSION,
    MAX_IMAGE_BYTES,
    MAX_PHOTO_BYTES,
    MAX_COORDINATE,
    PIXOPIK_MAX_POINTS,
    PIXOPIK_MAX_CLIP_CHARS,
    PIXOPIK_CLIP_UNITS,
    isExactMulti,
    utf8Bytes,
    measurePathBudget,
    maxPathsFor,
  };
}
