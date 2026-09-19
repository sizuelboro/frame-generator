'use strict';
/* =========================================================================
   FrameForge Studio - 14-wand.js
   click-to-pick opening (magic wand)
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* -------------------- click-to-pick opening (magic wand) --------------------
   Auto detection guesses; this is exact: the user clicks inside the opening,
   the matching region is flood-filled, cleaned, traced and turned into a
   polygon frame. Matched pixels are cleared everywhere so the artwork also
   becomes transparent. */

async function wandOpening(L, p, tol) {
  tol = tol == null ? 40 : tol;
  const img = await loadImg(L.src);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const k = Math.min(1, 1000 / Math.max(w0, h0));
  const w = Math.max(4, Math.round(w0 * k)), h = Math.max(4, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx2 = c.getContext('2d', { willReadFrequently: true });
  ctx2.drawImage(img, 0, 0, w, h);
  const d = ctx2.getImageData(0, 0, w, h).data;

  const sx = Math.round(((p.x - L.x) / L.w) * w);
  const sy = Math.round(((p.y - L.y) / L.h) * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) throw new Error('click inside the artwork');

  const si = (sy * w + sx) * 4;
  const sa = d[si + 3], sr = d[si], sg = d[si + 1], sb = d[si + 2];
  const lim = tol * tol * 3;

  /* if the click landed on a grey/white background (incl. a flattened
     transparency checkerboard) accept every grey shade of that background */
  const sMax = Math.max(sr, sg, sb), sMin = Math.min(sr, sg, sb);
  const seedGrey = sa >= 128 && sMax - sMin <= 8;
  let levels = null;
  if (seedGrey) {
    const found = _checkerBg(d, w, h) || [];
    levels = [...new Set([...found, Math.round((sr + sg + sb) / 3)])];
  }

  const match = (r, g, b, a) => {
    if (sa < 128) return a < 128;                        // clicked a transparent area
    if (a < 96) return true;                             // see-through pixels count as background
    if (levels) {
      if (Math.max(r, g, b) - Math.min(r, g, b) > 8) return false;
      const v = (r + g + b) / 3;
      return levels.some(L2 => Math.abs(v - L2) <= tol);
    }
    const dr = r - sr, dg = g - sg, db = b - sb;
    return dr * dr + dg * dg + db * db <= lim;
  };

  /* flood fill from the click */
  const mask = new Uint8Array(w * h);
  const st = [sy * w + sx];
  mask[sy * w + sx] = 1;
  let n = 0;
  const ok = i => {
    const j = i * 4;
    return match(d[j], d[j + 1], d[j + 2], d[j + 3]);
  };
  if (!ok(sy * w + sx)) throw new Error('nothing to pick there');
  while (st.length) {
    const i = st.pop(), x = i % w, y = (i - x) / w;
    n++;
    if (x > 0 && !mask[i - 1] && ok(i - 1)) { mask[i - 1] = 1; st.push(i - 1) }
    if (x < w - 1 && !mask[i + 1] && ok(i + 1)) { mask[i + 1] = 1; st.push(i + 1) }
    if (y > 0 && !mask[i - w] && ok(i - w)) { mask[i - w] = 1; st.push(i - w) }
    if (y < h - 1 && !mask[i + w] && ok(i + w)) { mask[i + w] = 1; st.push(i + w) }
  }
  if (n < w * h * 0.002) throw new Error('picked area is too small');

  /* also collect the background that touches the image border, so the outside
     checkerboard is cleared too - but nothing else (the frame artwork itself
     can be the same shade, so we only clear connected background) */
  const bg = new Uint8Array(w * h);
  const st2 = [];
  const seed2 = i => { if (!bg[i] && ok(i)) { bg[i] = 1; st2.push(i) } };
  for (let x = 0; x < w; x++) { seed2(x); seed2((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed2(y * w); seed2(y * w + w - 1) }
  while (st2.length) {
    const i = st2.pop(), x = i % w, y = (i - x) / w;
    if (x > 0) seed2(i - 1);
    if (x < w - 1) seed2(i + 1);
    if (y > 0) seed2(i - w);
    if (y < h - 1) seed2(i + w);
  }
  const clear = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) clear[i] = (mask[i] || bg[i]) ? 1 : 0;
  const clearD = _morph(clear, w, h, 1, true);

  /* clean: close small texture gaps, drop specks, fill enclosed bits */
  const r = Math.max(1, Math.round(Math.max(w, h) / 300));
  let m = _morph(mask, w, h, r, true);
  m = _fillHoles(m, w, h);
  m = _morph(m, w, h, r, false);
  m = _largest(m, w, h).mask;
  m = _fillHoles(m, w, h);

  const simp = await _maskOutline(m, w, h);
  if (!simp) throw new Error('could not trace the outline');

  /* clear matched pixels at full resolution so the artwork is transparent */
  const full = document.createElement('canvas');
  full.width = w0; full.height = h0;
  const fc = full.getContext('2d', { willReadFrequently: true });
  fc.drawImage(img, 0, 0);
  const fi = fc.getImageData(0, 0, w0, h0), fd = fi.data;
  const soft = lim * 2.6;
  for (let i = 0; i < w0 * h0; i++) {
    const j = i * 4;
    if (fd[j + 3] === 0) continue;
    const mx = Math.min(w - 1, Math.floor((i % w0) / w0 * w));
    const my = Math.min(h - 1, Math.floor(Math.floor(i / w0) / h0 * h));
    if (!clearD[my * w + mx]) continue;      // only clear connected background
    if (sa < 128) { if (fd[j + 3] < 128) fd[j + 3] = 0; continue }
    if (levels) {
      if (Math.max(fd[j], fd[j + 1], fd[j + 2]) - Math.min(fd[j], fd[j + 1], fd[j + 2]) > 8) continue;
      const v = (fd[j] + fd[j + 1] + fd[j + 2]) / 3;
      let best = 999;
      levels.forEach(L2 => { best = Math.min(best, Math.abs(v - L2)) });
      if (best <= tol) fd[j + 3] = 0;
      else if (best <= tol * 1.8) fd[j + 3] = Math.round(fd[j + 3] * ((best - tol) / (tol * 0.8)));
      continue;
    }
    const dr = fd[j] - sr, dg = fd[j + 1] - sg, db = fd[j + 2] - sb;
    const dd = dr * dr + dg * dg + db * db;
    if (dd <= lim) fd[j + 3] = 0;
    else if (dd <= soft) fd[j + 3] = Math.round(fd[j + 3] * ((dd - lim) / (soft - lim)));
  }
  fc.putImageData(fi, 0, 0);

  const ax = L.w / w, ay = L.h / h;
  return {
    src: full.toDataURL('image/png'),
    pts: simp.map(q => ({ x: +(L.x + q[0] * ax).toFixed(1), y: +(L.y + q[1] * ay).toFixed(1) }))
  };
}

async function wandApply(L, p, tol) {
  const res = await wandOpening(L, p, tol);
  L.src = res.src;
  imgCache.delete(res.src);
  L.type = 'overlay';
  L.locked = true;
  if (!/overlay|mockup/i.test(L.name || '')) L.name = (L.name || 'Artwork') + ' Overlay';

  const pts = res.pts;
  const fr = {
    id: uid(), type: 'frame', name: 'Opening Frame',
    frameType: pts.length === 4 ? (isAxisRect(pts) ? 'rect' : 'perspective') : 'polygon',
    visible: true, locked: false, opacity: 1, points: pts, content: null
  };
  doc.layers = doc.layers.filter(x => x.id !== L.id);
  doc.layers.push(fr);
  doc.layers.push(L);
  sel = fr.id;
  contentCache.clear();
  sync();
  toast('Opening picked \u00b7 ' + pts.length + '-point frame created \u00b7 drop an image in');
  return true;
}

/* ---- pick mode ---- */
let _wandTol = 25;
let _wandOn = false;

function wandMode(on) {
  _wandOn = on;
  cv.style.cursor = on ? 'crosshair' : 'default';
  $('#stageMsg').textContent = on
    ? 'Click inside the opening you want to turn into a frame (Esc to cancel)'
    : 'Click a frame to select \u00b7 double-click to edit the image inside';
  const b = $('#btnPickOpening');
  if (b) b.classList.toggle('primary', on);
}

cv.addEventListener('pointerdown', async (ev) => {
  if (!_wandOn) return;
  ev.stopImmediatePropagation();
  ev.preventDefault();
  const p = toScene(ev);
  let L = null;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const x = doc.layers[i];
    if ((x.type !== 'image' && x.type !== 'overlay') || !x.visible) continue;
    if (p.x >= x.x && p.x <= x.x + x.w && p.y >= x.y && p.y <= x.y + x.h) { L = x; break }
  }
  wandMode(false);
  if (!L) { toast('No artwork layer under that click'); return }
  try {
    toast('Picking\u2026');
    await wandApply(L, p, _wandTol);
  } catch (e) {
    toast(String(e.message || e));
  }
}, true);

window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _wandOn) wandMode(false) });

if ($('#btnPickOpening')) {
  $('#btnPickOpening').onclick = async () => {
    const raw = await uiPrompt('Pick opening \u2014 colour tolerance',
      String(_wandTol),
      'Then click inside the opening. Higher tolerance grabs more shades (useful for textured or watermarked backgrounds).');
    if (raw == null) return;
    const t = parseInt(raw, 10);
    _wandTol = isFinite(t) ? Math.max(5, Math.min(160, t)) : 40;
    wandMode(true);
  };
}
