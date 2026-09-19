'use strict';
/* =========================================================================
   FrameForge Studio - 03-geometry.js
   homography, triangle warp, quad warp, polygon maths
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* =========================================================================
   GEOMETRY — homography
   ========================================================================= */
function gauss(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-12;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / d;
      if (!f) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / (A[i][i] || 1e-12);
  }
  return x;
}
// src quad -> dst quad, 3x3 homography (h8 = 1)
function solveH(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], u = dst[i].x, v = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = gauss(A, b); h.push(1);
  return h;
}
function applyH(h, x, y) {
  const d = h[6] * x + h[7] * y + h[8] || 1e-12;
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
}

/* Draw one source triangle into a destination triangle via exact affine map. */
function drawTri(c, img, s0, s1, s2, d0, d1, d2, pad) {
  const v1x = s1.x - s0.x, v1y = s1.y - s0.y, v2x = s2.x - s0.x, v2y = s2.y - s0.y;
  const det = v1x * v2y - v2x * v1y;
  if (!det) return;
  const w1x = d1.x - d0.x, w1y = d1.y - d0.y, w2x = d2.x - d0.x, w2y = d2.y - d0.y;
  const a = (w1x * v2y - w2x * v1y) / det;
  const cc = (-w1x * v2x + w2x * v1x) / det;
  const b = (w1y * v2y - w2y * v1y) / det;
  const d = (-w1y * v2x + w2y * v1x) / det;
  const e = d0.x - a * s0.x - cc * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;

  // expand clip slightly from centroid so adjacent triangles have no hairline seams
  const gx = (d0.x + d1.x + d2.x) / 3, gy = (d0.y + d1.y + d2.y) / 3;
  const out = (p) => {
    const dx = p.x - gx, dy = p.y - gy, L = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / L) * pad, y: p.y + (dy / L) * pad };
  };
  const q0 = out(d0), q1 = out(d1), q2 = out(d2);

  c.save();
  c.beginPath();
  c.moveTo(q0.x, q0.y); c.lineTo(q1.x, q1.y); c.lineTo(q2.x, q2.y); c.closePath();
  c.clip();
  c.transform(a, b, cc, d, e, f);
  c.drawImage(img, 0, 0);
  c.restore();
}

/* Warp a source canvas/image into an arbitrary quad using a triangle mesh. */
function warpQuad(c, img, quad, steps, pad) {
  const W = img.width, H = img.height;
  const h = solveH(
    [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    quad
  );
  const N = steps, grid = [];
  for (let j = 0; j <= N; j++) {
    const row = [];
    for (let i = 0; i <= N; i++) row.push(applyH(h, (W * i) / N, (H * j) / N));
    grid.push(row);
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const sx0 = (W * i) / N, sx1 = (W * (i + 1)) / N;
      const sy0 = (H * j) / N, sy1 = (H * (j + 1)) / N;
      const s00 = { x: sx0, y: sy0 }, s10 = { x: sx1, y: sy0 },
            s11 = { x: sx1, y: sy1 }, s01 = { x: sx0, y: sy1 };
      const d00 = grid[j][i], d10 = grid[j][i + 1], d11 = grid[j + 1][i + 1], d01 = grid[j + 1][i];
      drawTri(c, img, s00, s10, s11, d00, d10, d11, pad);
      drawTri(c, img, s00, s11, s01, d00, d11, d01, pad);
    }
  }
}

function isAxisRect(p) {
  if (p.length !== 4) return false;
  const t = 0.4;
  return Math.abs(p[0].y - p[1].y) < t && Math.abs(p[2].y - p[3].y) < t &&
         Math.abs(p[0].x - p[3].x) < t && Math.abs(p[1].x - p[2].x) < t &&
         p[1].x > p[0].x && p[3].y > p[0].y;
}
function bbox(p) {
  const xs = p.map(q => q.x), ys = p.map(q => q.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// natural content size of a frame quad (average of opposite edge lengths)
function frameSpace(p) {
  if (p.length === 4) {
    return {
      w: Math.max(8, (dist(p[0], p[1]) + dist(p[3], p[2])) / 2),
      h: Math.max(8, (dist(p[0], p[3]) + dist(p[1], p[2])) / 2)
    };
  }
  const b = bbox(p);
  return { w: Math.max(8, b.w), h: Math.max(8, b.h) };
}
function inPoly(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) &&
        pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/* =========================================================================
   FRAME CONTENT — render inner image into frame-local space, then warp
   ========================================================================= */
const contentCache = new Map();
function frameContentCanvas(L, res) {
  const c0 = L.content;
  if (!c0 || !c0.src) return null;
  const img = getImg(c0.src);
  if (!img) return null;
  const sp = frameSpace(L.points);
  const key = [L.id, c0.src, c0.offsetX, c0.offsetY, c0.scale, c0.rotation, c0.fit,
               Math.round(sp.w), Math.round(sp.h), res].join('|');
  const hit = contentCache.get(key);
  if (hit) return hit;

  const cw = Math.max(2, Math.round(sp.w * res)), ch = Math.max(2, Math.round(sp.h * res));
  const off = document.createElement('canvas');
  off.width = cw; off.height = ch;
  const c = off.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.save();
  c.scale(res, res);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const base = c0.fit === 'contain'
    ? Math.min(sp.w / nw, sp.h / nh)
    : Math.max(sp.w / nw, sp.h / nh);
  const s = base * (c0.scale || 1);
  c.translate(sp.w / 2 + (c0.offsetX || 0) * sp.w, sp.h / 2 + (c0.offsetY || 0) * sp.h);
  c.rotate(((c0.rotation || 0) * Math.PI) / 180);
  c.drawImage(img, (-nw * s) / 2, (-nh * s) / 2, nw * s, nh * s);
  c.restore();

  if (contentCache.size > 24) contentCache.clear();
  contentCache.set(key, off);
  return off;
}
