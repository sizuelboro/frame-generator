'use strict';
/* =========================================================================
   FrameForge Studio - 09-trace-pdf.js
   alpha tracer, simplifier, PDF writer, background removal
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* =====================================================================
   CANVA FRAME PDF — replaces the whole Photopea route
   (Select Pixels -> Selection to Path -> Vector Mask -> Export PDF)

   We read the alpha channel, trace real vector contours (marching
   squares + Douglas-Peucker), and write a PDF where the bitmap is
   clipped by those contours. Canva reads that clip as a vector shape,
   so "Detach image" + delete image leaves a native Canva frame.
   ===================================================================== */

let pdfBundle = [];   // queued pages for a multi-frame PDF

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

/* ---------------------- PDF writer ---------------------- */
function buildPdf(pages) {
  const bodies = [];
  let num = 3;
  const kids = [];
  pages.forEach(p => {
    const pageNum = num++, contNum = num++, imgNum = num++;
    kids.push(pageNum + ' 0 R');
    let path = '';
    p.loops.forEach(loop => {
      loop.forEach((pt, i) => {
        path += pt[0].toFixed(2) + ' ' + (p.h - pt[1]).toFixed(2) + (i ? ' l\n' : ' m\n');
      });
      path += 'h\n';
    });
    const content = 'q\n' + path + 'W* n\n' +
      p.w.toFixed(2) + ' 0 0 ' + p.h.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ';
    bodies.push([pageNum, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + p.w.toFixed(2) + ' ' + p.h.toFixed(2) +
      '] /Resources << /XObject << /Im0 ' + imgNum + ' 0 R >> >> /Contents ' + contNum + ' 0 R >>']);
    bodies.push([contNum, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream']);
    bodies.push([imgNum, '<< /Type /XObject /Subtype /Image /Width ' + p.iw + ' /Height ' + p.ih +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length +
      ' >>\nstream\n' + p.jpeg + '\nendstream']);
  });
  bodies.unshift([2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>']);
  bodies.unshift([1, '<< /Type /Catalog /Pages 2 0 R >>']);
  bodies.sort((a, b) => a[0] - b[0]);

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const off = [];
  bodies.forEach(([n, body]) => { off[n] = out.length; out += n + ' 0 obj\n' + body + '\nendobj\n'; });
  const xref = out.length;
  const size = bodies.length + 1;
  out += 'xref\n0 ' + size + '\n0000000000 65535 f \n';
  for (let i = 1; i < size; i++) out += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + size + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

function jpegBinary(canvas, q) {
  const url = canvas.toDataURL('image/jpeg', q || 0.92);
  return atob(url.split(',')[1]);
}

/* ---------------------- page builders ---------------------- */

/* A frame layer -> page whose vector shape is exactly the frame area */
async function framePage(L) {
  const pts = L.points.map(p => [p.x, p.y]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(2, Math.round(Math.max(...xs) - x0));
  const h = Math.max(2, Math.round(Math.max(...ys) - y0));

  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const c = off.getContext('2d');
  c.fillStyle = '#E6E5E3'; c.fillRect(0, 0, w, h);
  const src = L.content && L.content.src;
  if (src) {
    const img = await loadImg(src);
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  return {
    w, h, iw: w, ih: h,
    loops: [pts.map(p => [p[0] - x0, p[1] - y0])],
    jpeg: jpegBinary(off)
  };
}

/* An image/overlay layer -> page whose vector shape is the traced silhouette */
async function silhouettePage(L) {
  const img = await loadImg(L.src);
  const { loops, scale } = traceAlpha(img, 128, 900);
  if (!loops.length) throw new Error('no transparency found');
  const simplified = loops.map(lp => simplify(lp, 0.7).map(p => [p[0] * scale, p[1] * scale]));
  const all = simplified.flat();
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys));
  const w = Math.max(2, Math.round(Math.min(img.naturalWidth, Math.max(...xs)) - x0));
  const h = Math.max(2, Math.round(Math.min(img.naturalHeight, Math.max(...ys)) - y0));

  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const c = off.getContext('2d');
  c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, w, h);
  c.drawImage(img, -x0, -y0);
  return {
    w, h, iw: w, ih: h,
    loops: simplified.map(lp => lp.map(p => [p[0] - x0, p[1] - y0])),
    jpeg: jpegBinary(off)
  };
}

async function pageForSelection() {
  const L = sel ? layer(sel) : null;
  const target = L || doc.layers.find(l => l.type === 'frame') || doc.layers.find(l => l.src);
  if (!target) throw new Error('nothing to export');
  if (target.type === 'frame') return { page: await framePage(target), name: target.name, kind: 'frame area' };
  if (target.src) return { page: await silhouettePage(target), name: target.name, kind: 'silhouette' };
  throw new Error('select a frame, image or overlay layer');
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

/* ---------------------- wiring ---------------------- */
function bundleLabel() {
  const b = $('#btnBundleExport');
  if (!b) return;
  b.textContent = pdfBundle.length ? 'Bundle PDF (' + pdfBundle.length + ')' : 'Bundle PDF';
  b.disabled = !pdfBundle.length;
}

$('#btnCanvaPdf').onclick = async () => {
  try {
    toast('Tracing vector path…');
    const { page, name, kind } = await pageForSelection();
    download(buildPdf([page]), (name || 'frame').replace(/[^\w-]+/g, '-').toLowerCase() + '-canva-frame.pdf');
    toast('PDF ready (' + kind + ') · in Canva: upload → right-click → Detach image → delete image');
  } catch (e) {
    toast(e.message === 'no transparency found'
      ? 'That image has no transparent background — run Remove bg first'
      : 'Select a frame, image or overlay layer first');
  }
};

$('#btnBundleAdd').onclick = async () => {
  try {
    const { page, name } = await pageForSelection();
    pdfBundle.push(page);
    bundleLabel();
    toast('Added "' + (name || 'shape') + '" · ' + pdfBundle.length + ' frame(s) queued');
  } catch (e) { toast('Select a frame, image or overlay layer first'); }
};

$('#btnBundleExport').onclick = () => {
  if (!pdfBundle.length) return;
  download(buildPdf(pdfBundle), 'canva-frames-bundle.pdf');
  toast(pdfBundle.length + '-page PDF exported · one upload = ' + pdfBundle.length + ' frames');
  pdfBundle = [];
  bundleLabel();
};


bundleLabel();
