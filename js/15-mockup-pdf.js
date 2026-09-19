'use strict';
/* =========================================================================
   FrameForge Studio - 15-mockup-pdf.js
   whole-mockup Canva PDF and download fallback
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* ----------------------- whole-mockup Canva PDF -----------------------
   Structure that Canva imports as a real FRAME (same as the Photopea trick):
     - an IMAGE that is CLIPPED by the frame path  -> becomes frame + content
     - the mockup artwork on top as a transparent image (PNG alpha via SMask)
   In Canva: upload -> right-click -> Detach image -> delete the inner picture
   and the clipped shape stays behind as a usable frame. */

function _bin(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return s;
}

async function _flate(u8) {
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('deflate'); // zlib wrapper = PDF FlateDecode
    const stream = new Blob([u8]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    return { data: _bin(new Uint8Array(buf)), filter: '/FlateDecode' };
  }
  return { data: _bin(u8), filter: null }; // uncompressed fallback
}

async function buildMockupPdf(p) {
  const rgb = await _flate(p.rgb);
  const alpha = await _flate(p.alpha);
  const inner = await _flate(p.inner);

  let path = '';
  p.loops.forEach(loop => {
    loop.forEach((pt, i) => {
      path += pt[0].toFixed(2) + ' ' + (p.h - pt[1]).toFixed(2) + (i ? ' l\n' : ' m\n');
    });
    path += 'h\n';
  });

  const box = '[0 0 ' + p.w.toFixed(2) + ' ' + p.h.toFixed(2) + ']';
  const cm = p.w.toFixed(2) + ' 0 0 ' + p.h.toFixed(2) + ' 0 0 cm\n';

  /* page 1: ONLY the clipped picture -> Canva imports this as frame + image.
     page 2: ONLY the mockup artwork (transparent png). Keeping them on
     separate pages stops Canva from flattening the vector clip. */
  const c1 = (path ? 'q\n' + path + 'W n\n' + cm + '/Im1 Do\nQ' : '');
  const c2 = 'q\n' + cm + '/Im0 Do\nQ';

  const bodies = [];
  bodies.push([1, '<< /Type /Catalog /Pages 2 0 R >>']);
  bodies.push([2, '<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 >>']);
  bodies.push([3, '<< /Type /Page /Parent 2 0 R /MediaBox ' + box +
    ' /Resources << /XObject << /Im1 7 0 R >> >> /Contents 4 0 R >>']);
  bodies.push([4, '<< /Length ' + c1.length + ' >>\nstream\n' + c1 + '\nendstream']);
  bodies.push([5, '<< /Type /XObject /Subtype /Image /Width ' + p.iw + ' /Height ' + p.ih +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8' + (rgb.filter ? ' /Filter ' + rgb.filter : '') +
    ' /SMask 6 0 R /Length ' + rgb.data.length + ' >>\nstream\n' + rgb.data + '\nendstream']);
  bodies.push([6, '<< /Type /XObject /Subtype /Image /Width ' + p.iw + ' /Height ' + p.ih +
    ' /ColorSpace /DeviceGray /BitsPerComponent 8' + (alpha.filter ? ' /Filter ' + alpha.filter : '') +
    ' /Length ' + alpha.data.length + ' >>\nstream\n' + alpha.data + '\nendstream']);
  bodies.push([7, '<< /Type /XObject /Subtype /Image /Width ' + p.jw + ' /Height ' + p.jh +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8' + (inner.filter ? ' /Filter ' + inner.filter : '') +
    ' /Length ' + inner.data.length + ' >>\nstream\n' + inner.data + '\nendstream']);
  bodies.push([8, '<< /Type /Page /Parent 2 0 R /MediaBox ' + box +
    ' /Group << /S /Transparency /CS /DeviceRGB >> /Resources << /XObject << /Im0 5 0 R >> >> /Contents 9 0 R >>']);
  bodies.push([9, '<< /Length ' + c2.length + ' >>\nstream\n' + c2 + '\nendstream']);

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

/* the picture that sits inside the frame: whatever the user dropped in, or a
   flat grey placeholder if the frame is empty */
async function _innerImage(frames) {
  const s = 2;
  const c = document.createElement('canvas');
  c.width = Math.round(doc.canvas.w * s);
  c.height = Math.round(doc.canvas.h * s);
  const g = c.getContext('2d');
  g.fillStyle = '#E6E5E3';
  g.fillRect(0, 0, c.width, c.height);
  for (const f of frames) {
    const src = f.content && f.content.src;
    if (!src) continue;
    const img = await loadImg(src);
    const xs = f.points.map(p => p.x), ys = f.points.map(p => p.y);
    const bx = Math.min.apply(null, xs), by = Math.min.apply(null, ys);
    const bw = Math.max.apply(null, xs) - bx, bh = Math.max.apply(null, ys) - by;
    const k = Math.max(bw / img.naturalWidth, bh / img.naturalHeight);
    const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    g.drawImage(img, (bx + (bw - dw) / 2) * s, (by + (bh - dh) / 2) * s, dw * s, dh * s);
  }
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const rgb = new Uint8Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
    rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2];
  }
  return { rgb, w: c.width, h: c.height };
}

async function mockupPdf() {
  const frames = doc.layers.filter(l => l.type === 'frame' && l.visible !== false);
  if (!frames.length) throw new Error('no frame');
  const art = doc.layers.filter(l => l.type === 'overlay' && l.visible !== false);
  if (!art.length) throw new Error('no overlay');

  // mockup artwork only, transparent background, at canvas resolution
  const off = exportCanvas({ scale: 2, only: ['overlay','shadow'], bg: false });
  const c = off.getContext('2d');
  const iw = off.width, ih = off.height;
  const d = c.getImageData(0, 0, iw, ih).data;
  const rgb = new Uint8Array(iw * ih * 3);
  const alpha = new Uint8Array(iw * ih);
  for (let i = 0, j = 0, k = 0; i < d.length; i += 4, j += 3, k++) {
    rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2];
    alpha[k] = d[i + 3];
  }

  const innr = await _innerImage(frames);
  const loops = frames.map(f => f.points.map(p => [p.x, p.y]));
  return {
    blob: await buildMockupPdf({
      w: doc.canvas.w, h: doc.canvas.h,
      iw, ih, rgb, alpha,
      inner: innr.rgb, jw: innr.w, jh: innr.h,
      loops
    }),
    frames: frames.length
  };
}

if ($('#btnMockupPdf')) {
  $('#btnMockupPdf').onclick = async () => {
    try {
      toast('Building mockup PDF\u2026');
      const r = await mockupPdf();
      const nm = (doc.layers.find(l => l.type === 'overlay') || {}).name || 'mockup';
      download(r.blob, nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-canva-mockup.pdf');
      toast('Mockup PDF ready (2 pages) \u00b7 page 1 = frame, page 2 = artwork');
    } catch (e) {
      toast(String(e.message || e) === 'no frame' ? 'Draw a frame first' :
            String(e.message || e) === 'no overlay' ? 'Add a mockup overlay first' : 'Export failed: ' + e.message);
    }
  };
}

/* --------------------------- download fallback ---------------------------
   Preview panes and sandboxed iframes (Notion file preview, Edge/Chrome file
   preview) silently block programmatic downloads. We still hand the user a
   real link they can click, and tell them what happened. */

const _embedded = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();

function showDownloadCard(url, name) {
  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);z-index:10000;display:flex;align-items:center;justify-content:center;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:18px;width:380px;max-width:calc(100vw - 32px)';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;font-size:14px;color:#16181d;margin-bottom:6px';
  title.textContent = 'Your file is ready';
  const msg = document.createElement('div');
  msg.style.cssText = 'color:#6b7280;margin-bottom:14px';
  msg.textContent = 'This preview pane blocks automatic downloads. Click the button below — or open FrameForge.html in a normal browser tab for one-click saving.';
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#f5f6f8;border-radius:7px;padding:7px 9px;margin-bottom:14px;color:#2b2f36;word-break:break-all';
  nameRow.textContent = name;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;align-items:center';
  const open = document.createElement('a');
  open.href = url; open.target = '_blank'; open.rel = 'noopener';
  open.textContent = 'Open in new tab';
  open.style.cssText = 'padding:7px 12px;border-radius:8px;border:1px solid #d9dce1;color:#2b2f36;text-decoration:none;font-weight:500';
  const save = document.createElement('a');
  save.href = url; save.download = name;
  save.textContent = 'Save ' + (name.split('.').pop() || 'file').toUpperCase();
  save.style.cssText = 'padding:7px 14px;border-radius:8px;border:1px solid #2f6fed;background:#2f6fed;color:#fff;text-decoration:none;font-weight:500';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.style.cssText = 'padding:7px 12px;border-radius:8px;border:1px solid #d9dce1;background:#fff;color:#2b2f36;font:inherit;font-weight:500;cursor:pointer';
  close.onclick = () => back.remove();
  back.onmousedown = (e) => { if (e.target === back) back.remove(); };
  row.appendChild(close); row.appendChild(open); row.appendChild(save);
  card.appendChild(title); card.appendChild(msg); card.appendChild(nameRow); card.appendChild(row);
  back.appendChild(card);
  document.body.appendChild(back);
  save.focus();
}

download = function (blobOrUrl, name) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  let clicked = false;
  try {
    const a = document.createElement('a');
    a.download = name;
    a.href = url;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    clicked = true;
  } catch (e) { clicked = false; }
  // In a preview pane the click above is swallowed, so always offer a real link.
  if (_embedded || !clicked) showDownloadCard(url, name);
  else setTimeout(() => { if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(url); }, 20000);
};

if (_embedded) {
  setTimeout(() => toast('Preview pane detected · downloads will open a Save link. Open the file in a browser tab for direct saving.'), 1600);
}
