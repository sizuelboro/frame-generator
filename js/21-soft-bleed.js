/* =========================================================================
   21-soft-bleed.js - hand-drawn artwork gets a drop target that fits it
   -------------------------------------------------------------------------
   Hand-drawn frames are not cut-out cards, and they fail 11-detect.js in two
   opposite ways. Both are fixed here, as a pass over the traced result, so
   hard-cut mockups keep the exact code path - and geometry - they always had.

   1. DENSE artwork (crayon, marker, watercolour). The strokes are solid
      enough to hide a photo, but the hatching leaves gaps everywhere and the
      opening is a ragged curve. Tracing that opening exactly means Canva's
      white page shows through every gap. Because the overlay is painted on
      top of the photo, the drop target can instead cover the whole body of
      the frame: the strokes still hide the photo and the gaps are filled.

   2. SPARSE artwork (pen or pencil outlines, the "sketchy rectangle" style).
      Here the strokes are thin and wobbly, so the inside of the frame leaks
      out to the page through the gaps between them and there is no enclosed
      opening to find at all: detectOpening returns null, or returns one
      broken loop per drawn line. The gaps have to be bridged before the
      opening can be found - and bleeding is exactly the wrong answer, since
      a few thin lines cannot hide a photo behind them.

   Which branch runs is decided by ink density inside the artwork's bounding
   box, measured below. Crayon frames score around 0.44; pen outlines score
   around 0.04. Everything denser than FF_SKETCH_INK_MAX is treated as solid
   artwork, which is also what every hard-cut mockup is.

   Adding a numbered script is safe; the bundle shares one global scope and
   this file must load after 11-detect.js.
   ========================================================================= */

const FF_SOFT_ALPHA_MIN = 24;      // faintest stroke pixel still counted as artwork
const FF_SOFT_OPAQUE_MIN = 248;    // from here up a pixel is "solid" artwork
const FF_SOFT_EDGE_RATIO = 0.15;   // semi-transparent share that means "hand drawn"

/* Ink density inside the artwork's own bounding box, below which the frame is
   a line drawing rather than a body of colour. Measured: crayon 0.45 / 0.43,
   pen outlines 0.03 / 0.05. */
const FF_SKETCH_INK_MAX = 0.15;

/* How far to reach across a gap between two strokes, richest detail first.
   The smallest radius that closes the outline wins, so a tight drawing is not
   blurred by a radius chosen for a loose one. */
const FF_SKETCH_CLOSE_STEPS = [3, 5, 8, 12, 18, 26];

/* An opening has to be a real window, not a puddle between two strokes. */
const FF_SKETCH_MIN_AREA = 0.02;

/* Point counts to try for the outline, richest first. A hand-drawn border
   needs more points than a rectangular window, but the published path still
   has to fit the shared native budget, so the first cap that fits wins. The
   budget itself is never hardcoded here - it comes from FF_LIMITS. */
const FF_BLEED_POINT_CAPS = [200, 150, 110, 90, 70];

/* The artwork at detection scale: the same 1000px cap 11-detect.js uses, so
   both passes measure the same pixels. */
async function ffArtPixels(L) {
  const img = await loadImg(L.src);
  const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(4, Math.round(img.naturalWidth * k));
  const h = Math.max(4, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  return { data: x.getImageData(0, 0, w, h).data, w: w, h: h };
}

function ffArtMask(data, w, h) {
  const art = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) art[i] = data[i * 4 + 3] >= FF_SOFT_ALPHA_MIN ? 1 : 0;
  return art;
}

/* Share of the artwork that is neither solid nor clear. A card with a window
   knocked out of it only has antialiasing here and scores near zero; crayon
   artwork scores around 0.6, because almost every stroke is translucent. */
function ffSoftEdgeRatio(data, w, h) {
  let art = 0, soft = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a < FF_SOFT_ALPHA_MIN) continue;
    art++;
    if (a < FF_SOFT_OPAQUE_MIN) soft++;
  }
  return art ? soft / art : 0;
}

/* How much of the space the drawing occupies is actually inked. Measured
   inside the artwork's own bounding box, so it does not change when the same
   frame is exported on a roomier canvas. */
function ffInkRatio(data, w, h) {
  let ink = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < FF_SOFT_ALPHA_MIN) continue;
      ink++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return 0;
  return ink / ((maxX - minX + 1) * (maxY - minY + 1));
}

/* Trace a mask into document points, as rich as the shared path budget
   allows. Returns null when even the coarsest outline would not publish. */
async function ffFitOutline(mask, w, h, L) {
  const cw = doc.canvas.w, ch = doc.canvas.h;
  const frame = framePath([{ x: 0, y: 0 }, { x: cw, y: 0 }, { x: cw, y: ch }, { x: 0, y: ch }], true);
  const room = FF_LIMITS.PATH_BUDGET - new TextEncoder().encode(frame).length;
  const sx = L.w / w, sy = L.h / h;
  for (const cap of FF_BLEED_POINT_CAPS) {
    const loop = await _maskOutline(mask, w, h, cap);
    if (!loop || loop.length < 3) continue;
    const pts = loop.map((p) => ({
      x: +(L.x + p[0] * sx).toFixed(1),
      y: +(L.y + p[1] * sy).toFixed(1),
    }));
    if (new TextEncoder().encode(framePath(pts, false)).length <= room) return pts;
  }
  return null;
}

/* ---------- 1. dense artwork: bleed under the border -------------------- */

/* The opening grown out under the artwork: the filled body of the frame that
   owns the opening, then eroded so the photo stays behind the outer edge.

   Detached decorations - a star floating off the wreath, a bat above the roof -
   are separate components and are deliberately excluded. Bleeding under those
   would put photo in the empty space between them and the frame, which reads
   as a leak rather than a fix. */
function ffBleedMask(data, w, h, openingMask) {
  const art = ffArtMask(data, w, h);

  const close = Math.max(2, Math.round(Math.max(w, h) / 200));
  let body = _morph(art, w, h, close, true);     // bridge the hatching gaps
  body = _morph(body, w, h, close, false);
  body = _fillHoles(body, w, h);                 // the opening joins the body

  // keep only the blob the detected opening actually sits in
  const parts = _components(body, w, h);
  let bestId = 0, bestHit = 0;
  for (const part of parts.items) {
    let hit = 0;
    for (let i = 0; i < w * h; i++) if (parts.labels[i] === part.id && openingMask[i]) hit++;
    if (hit > bestHit) { bestHit = hit; bestId = part.id }
  }
  if (!bestId) return null;

  const inset = Math.max(3, Math.round(Math.max(w, h) / 100));
  const mask = _morph(_componentMask(parts.labels, bestId), w, h, inset, false);
  let size = 0;
  for (let i = 0; i < w * h; i++) if (mask[i]) size++;
  return size ? { mask, size } : null;
}

/* Paint the opening polygon back into mask space so the bleed can be seeded
   from whatever detectOpening decided the opening was. */
function ffOpeningMaskFromPoints(pts, L, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#000';
  x.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const px = (pts[i].x - L.x) * w / L.w, py = (pts[i].y - L.y) * h / L.h;
    if (i) x.lineTo(px, py); else x.moveTo(px, py);
  }
  x.closePath();
  x.fill();
  const d = x.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return mask;
}

/* ---------- 2. sparse artwork: bridge the outline, then stay inside ----- */

/* The window a line drawing means to enclose.

   The strokes are closed up until the inside of the frame stops leaking out
   to the page, which turns the drawing into a ring with a hole in it. The
   hole is the opening. It is then grown by roughly half a stroke width, so
   the photo tucks just under the innermost line and no white seam is left
   between them - but no further, because a line drawing has no body to hide
   a photo behind. The result is intersected with the filled drawing, so the
   photo can never reach past the outermost line either. */
function ffSketchOpening(data, w, h) {
  const art = ffArtMask(data, w, h);
  const tuck = Math.max(2, Math.round(Math.max(w, h) / 300));

  for (const r of FF_SKETCH_CLOSE_STEPS) {
    const closed = _morph(_morph(art, w, h, r, true), w, h, r, false);
    const body = _fillHoles(closed, w, h);

    const holes = new Uint8Array(w * h);
    let any = 0;
    for (let i = 0; i < w * h; i++) if (body[i] && !closed[i]) { holes[i] = 1; any++ }
    if (!any) continue;

    const parts = _components(holes, w, h);
    let best = null;
    for (const part of parts.items) if (!best || part.size > best.size) best = part;
    if (!best || best.size < w * h * FF_SKETCH_MIN_AREA) continue;

    const grown = _morph(_componentMask(parts.labels, best.id), w, h, tuck, true);
    const mask = new Uint8Array(w * h);
    let size = 0;
    for (let i = 0; i < w * h; i++) if (grown[i] && body[i]) { mask[i] = 1; size++ }
    if (size) return { mask, size, close: r };
  }
  return null;
}

/* ---------- the pass ---------------------------------------------------- */

const _ffDetectOpeningTraced = detectOpening;

/**
 * detectOpening plus the hand-drawn passes.
 *
 * opts.bleed
 *   undefined - decide from the artwork (the default)
 *   true      - bleed whenever an alpha opening was found
 *   false     - no hand-drawn handling at all: the traced result, unchanged
 *
 * opts.sketch
 *   false     - skip the line-drawing pass only
 *
 * The result gains three fields: `bleed` (the drop target was grown under a
 * dense border), `sketch` (the opening was recovered from a line drawing) and
 * `softRatio` (how soft the artwork measured).
 */
detectOpening = async function (L, opts) {
  opts = opts || {};
  const res = await _ffDetectOpeningTraced(L);
  if (res) { res.bleed = false; res.sketch = false; res.softRatio = 0 }
  if (opts.bleed === false) return res;

  const art = await ffArtPixels(L);
  const { data, w, h } = art;

  /* A line drawing: recover the window the strokes enclose. This runs even
     when nothing was traced at all, which is the usual outcome for these. */
  if (opts.sketch !== false && ffInkRatio(data, w, h) <= FF_SKETCH_INK_MAX) {
    const sketch = ffSketchOpening(data, w, h);
    const pts = sketch && await ffFitOutline(sketch.mask, w, h, L);
    if (pts) {
      const out = res || { mode: 'alpha', src: L.src, pts: pts, openings: [pts], skipped: 0, bleed: false, softRatio: 0 };
      out.pts = pts;
      out.openings = [pts];
      out.coverage = sketch.size / (w * h);
      out.sketch = true;
      return out;
    }
    return res;
  }

  if (!res || res.mode !== 'alpha' || res.openings.length !== 1) return res;

  res.softRatio = ffSoftEdgeRatio(data, w, h);
  if (opts.bleed !== true && res.softRatio < FF_SOFT_EDGE_RATIO) return res;

  const bleed = ffBleedMask(data, w, h, ffOpeningMaskFromPoints(res.pts, L, w, h));
  if (!bleed) return res;

  const pts = await ffFitOutline(bleed.mask, w, h, L);
  /* Nothing fitted the budget: keep the traced opening rather than publish a
     shape Canva would reject. */
  if (!pts) return res;

  res.pts = pts;
  res.openings = [pts];
  res.coverage = bleed.size / (w * h);
  res.bleed = true;
  return res;
};
