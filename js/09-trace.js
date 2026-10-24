'use strict';
/* =========================================================================
   FrameForge Studio - 09-trace.js
   alpha tracer, simplifier, background removal
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('image failed'));
    i.src = src;
  });
}

/* ---------------------- marching-squares alpha tracer ---------------------- */
function traceAlpha(img, threshold, maxSide) {
  const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(nw, nh));
  const w = Math.max(2, Math.round(nw * k)), h = Math.max(2, Math.round(nh * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const v = (i, j) => (i < 0 || j < 0 || i >= w || j >= h) ? 0 : (d[(j * w + i) * 4 + 3] > threshold ? 1 : 0);

  const segs = [];
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const a = v(i, j), b = v(i + 1, j), cc = v(i + 1, j + 1), dd = v(i, j + 1);
      const code = a | (b << 1) | (cc << 2) | (dd << 3);
      if (code === 0 || code === 15) continue;
      const T = [i + 0.5, j], R = [i + 1, j + 0.5], B = [i + 0.5, j + 1], L = [i, j + 0.5];
      switch (code) {
        case 1: segs.push([L, T]); break;
        case 2: segs.push([T, R]); break;
        case 3: segs.push([L, R]); break;
        case 4: segs.push([R, B]); break;
        case 5: segs.push([L, T], [R, B]); break;
        case 6: segs.push([T, B]); break;
        case 7: segs.push([L, B]); break;
        case 8: segs.push([B, L]); break;
        case 9: segs.push([B, T]); break;
        case 10: segs.push([T, R], [B, L]); break;
        case 11: segs.push([B, R]); break;
        case 12: segs.push([R, L]); break;
        case 13: segs.push([R, T]); break;
        case 14: segs.push([T, L]); break;
      }
    }
  }
  if (!segs.length) return { loops: [], scale: 1 / k };

  /* link segments into closed loops */
  const key = p => p[0].toFixed(1) + ':' + p[1].toFixed(1);
  const from = new Map();
  segs.forEach((s, idx) => {
    const kk = key(s[0]);
    if (!from.has(kk)) from.set(kk, []);
    from.get(kk).push(idx);
  });
  const used = new Array(segs.length).fill(false);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const loop = [segs[i][0]];
    let cur = i;
    used[i] = true;
    for (let guard = 0; guard < 400000; guard++) {
      const end = segs[cur][1];
      loop.push(end);
      const cand = (from.get(key(end)) || []).find(ix => !used[ix]);
      if (cand === undefined) break;
      used[cand] = true;
      cur = cand;
    }
    if (loop.length > 8) loops.push(loop);
  }
  return { loops, scale: 1 / k };
}

/* ---------------------- Douglas-Peucker simplify ---------------------- */
function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    if (!L) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L;
    t = Math.max(0, Math.min(1, t));
    return (p[0] - (a[0] + t * dx)) ** 2 + (p[1] - (a[1] + t * dy)) ** 2;
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  const e2 = eps * eps;
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) {
      const dd = d2(pts[i], pts[a], pts[b]);
      if (dd > bd) { bd = dd; best = i; }
    }
    if (best > 0 && bd > e2) { keep[best] = true; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ---------------------- background removal ---------------------- */
async function removeBg(L, tol) {
  const img = await loadImg(L.src);
  const w = img.naturalWidth, h = img.naturalHeight;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const c = off.getContext('2d');
  c.drawImage(img, 0, 0);
  const id = c.getImageData(0, 0, w, h), d = id.data;

  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
    const i = (y * w + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  });
  const ref = corners[0];
  const t2 = tol * tol * 3;
  const near = i => {
    for (const cc of corners) {
      const dr = d[i] - cc[0], dg = d[i + 1] - cc[1], db = d[i + 2] - cc[2];
      if (dr * dr + dg * dg + db * db <= t2) return true;
    }
    return false;
  };

  /* flood fill inward from every border pixel so inner colours survive */
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, x + (h - 1) * w); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop();
    if (p < 0 || p >= w * h || seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (d[i + 3] === 0) { /* already transparent, keep spreading */ }
    else if (!near(i)) continue;
    else { d[i + 3] = 0; cleared++; }
    const x = p % w;
    stack.push(p - w, p + w);
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
  }
  if (!cleared) return null;
  c.putImageData(id, 0, 0);
  return { src: off.toDataURL('image/png'), cleared, ref };
}
