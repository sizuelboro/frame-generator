/* =========================================================================
   21-soft-bleed.js - hand-drawn artwork bleeds the drop target under the border
   -------------------------------------------------------------------------
   Crayon, watercolour and marker frames are not cut-out cards. Their strokes
   are semi-transparent, the hatching leaves gaps everywhere, and the opening
   is a ragged curve rather than a clean window. 11-detect.js traces that
   ragged opening exactly, which is right for a poster mockup and wrong here:
   once the frame is published, Canva's white page shows through every gap
   between the strokes, and users see white patches all around the photo.

   The overlay is always painted on top of the photo, so the drop target does
   not have to stop at the opening. It can cover the whole body of the frame:
   opaque strokes still hide the photo, and the gaps that used to be white are
   filled by it. The only hard rule is that the photo must never reach past the
   outer edge of the artwork, so the mask is eroded before it is traced.

   This runs as a pass over the result of detectOpening rather than inside it,
   so hard-cut mockups keep the exact code path - and geometry - they always
   had. Two guards keep it that way:
     - it only fires on alpha mode with a single opening;
     - it only fires when the artwork actually is soft-edged (see below).

   Adding a numbered script is safe; the bundle shares one global scope and
   this file must load after 11-detect.js.
   ========================================================================= */

const FF_SOFT_ALPHA_MIN = 24;      // faintest stroke pixel still counted as artwork
const FF_SOFT_OPAQUE_MIN = 248;    // from here up a pixel is "solid" artwork
const FF_SOFT_EDGE_RATIO = 0.15;   // semi-transparent share that means "hand drawn"

/* Point counts to try for the bleed outline, richest first. A hand-drawn
   border needs more points than a rectangular window, but the published path
   still has to fit the shared native budget, so the first cap that fits wins.
   The budget itself is never hardcoded here - it comes from FF_LIMITS. */
const FF_BLEED_POINT_CAPS = [200, 150, 110, 90, 70];

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

/* The opening grown out under the artwork: the filled body of the frame that
   owns the opening, then eroded so the photo stays behind the outer edge.

   Detached decorations - a star floating off the wreath, a bat above the roof -
   are separate components and are deliberately excluded. Bleeding under those
   would put photo in the empty space between them and the frame, which reads
   as a leak rather than a fix. */
function ffBleedMask(data, w, h, openingMask) {
  const art = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) art[i] = data[i * 4 + 3] >= FF_SOFT_ALPHA_MIN ? 1 : 0;

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

/* The published shape carries the overlay rectangle alongside the drop path,
   so the outline has to leave that rectangle room inside the shared budget. */
function ffBleedPathRoom() {
  const w = doc.canvas.w, h = doc.canvas.h;
  const frame = framePath([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], true);
  return FF_LIMITS.PATH_BUDGET - new TextEncoder().encode(frame).length;
}

const _ffDetectOpeningTraced = detectOpening;

/**
 * detectOpening plus the soft-edge pass.
 *
 * opts.bleed
 *   undefined - bleed when the artwork looks hand drawn (the default)
 *   true      - bleed whenever an alpha opening was found
 *   false     - never bleed, i.e. the traced opening exactly as before
 *
 * The result gains two fields: `bleed` (whether the drop target was grown)
 * and `softRatio` (how soft the artwork measured).
 */
detectOpening = async function (L, opts) {
  opts = opts || {};
  const res = await _ffDetectOpeningTraced(L);
  if (!res) return res;
  res.bleed = false;
  res.softRatio = 0;
  if (opts.bleed === false || res.mode !== 'alpha' || res.openings.length !== 1) return res;

  const img = await loadImg(L.src);
  const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(4, Math.round(img.naturalWidth * k));
  const h = Math.max(4, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const data = x.getImageData(0, 0, w, h).data;

  res.softRatio = ffSoftEdgeRatio(data, w, h);
  if (opts.bleed !== true && res.softRatio < FF_SOFT_EDGE_RATIO) return res;

  const bleed = ffBleedMask(data, w, h, ffOpeningMaskFromPoints(res.pts, L, w, h));
  if (!bleed) return res;

  const room = ffBleedPathRoom();
  const sx = L.w / w, sy = L.h / h;
  for (const cap of FF_BLEED_POINT_CAPS) {
    const loop = await _maskOutline(bleed.mask, w, h, cap);
    if (!loop || loop.length < 3) continue;
    const pts = loop.map((p) => ({
      x: +(L.x + p[0] * sx).toFixed(1),
      y: +(L.y + p[1] * sy).toFixed(1),
    }));
    if (new TextEncoder().encode(framePath(pts, false)).length > room) continue;
    res.pts = pts;
    res.openings = [pts];
    res.coverage = bleed.size / (w * h);
    res.bleed = true;
    return res;
  }

  /* Nothing fitted the budget: keep the traced opening rather than publish a
     shape Canva would reject. */
  return res;
};
