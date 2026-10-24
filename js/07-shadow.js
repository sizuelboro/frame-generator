'use strict';
/* =========================================================================
   FrameForge Studio - 07-shadow.js
   shadow layer, export, fit-canvas, bleed
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* =========================================================================
   ADD / FILE ACTIONS
   ========================================================================= */
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => actions[b.dataset.act]()));

let ffShadowStrength = 0.35;

/* ---------------- shadow layer (natural light on the artwork) ----------------
   Shadow layers are no longer added by hand: Pixopik frames are flat
   artwork, and an uploaded picture turned into a grey cast over the whole
   frame. They still arrive from Import AI scene (13-scene.js), and older
   projects may carry one, so building, drawing and restyling stay.

   A shadow layer is pure black with a derived alpha channel. It sits above the
   drop-target frame, so whatever the buyer drops in is tinted by it and the
   mockup reads as real room light.

   Alpha is hard-capped below the 128 "this pixel is artwork" threshold used by
   detectOpening() and the auto-bleed alpha map, so a shadow can never be
   mistaken for a frame border. */
const SHADOW_MAX_ALPHA = 115;
/* A shadow harvested from an AI scene is a measurement of real light, not a
   decorative drop shadow, so flattening it to 115 throws away most of the
   depth the model actually rendered. The opening is already known by then,
   so the "never look like a border" ceiling does not apply and it gets its
   own, much higher cap. */
const SHADOW_SCENE_MAX_ALPHA = 230;
async function buildShadowSource(src, strength, maxAlpha) {
  const img = await loadImg(src);
  const w = Math.max(1, img.naturalWidth), h = Math.max(1, img.naturalHeight);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const im = x.getImageData(0, 0, w, h), d = im.data, n = w * h;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) clear++;
  const useAlpha = clear > n * 0.02;            // already a transparent shadow PNG
  let reference = 255;
  if (!useAlpha) {
    // Treat the brightest part of the plate as "no shadow" so a light wall does
    // not tint the whole artwork. 95th percentile ignores specular highlights.
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[Math.min(255, Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]))]++;
    let seen = 0; const target = n * 0.95;
    for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= target) { reference = Math.max(1, v); break } }
  }
  const lid = Math.max(1, Math.min(255, maxAlpha || SHADOW_MAX_ALPHA));
  const cap = Math.round(lid * Math.max(0, Math.min(1, strength / 0.45)));
  for (let i = 0; i < d.length; i += 4) {
    let amount;
    if (useAlpha) amount = d[i + 3] / 255;
    else { const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; amount = Math.max(0, Math.min(1, (reference - lum) / reference)); }
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = Math.min(lid, Math.round(amount * cap));
  }
  x.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}
function shadowLayer() {
  const picked = doc.layers.find(L => L.id === sel && L.type === 'shadow');
  if (picked) return picked;
  const all = doc.layers.filter(L => L.type === 'shadow');
  return all[all.length - 1] || null;
}
async function restyleShadowLayer(L, strength) {
  L.strength = Math.max(0.02, Math.min(0.45, strength));
  L.shadowSrc = await buildShadowSource(L.src, L.strength, L.maxAlpha);
  contentCache.clear(); sync(); updateShadowButton();
}
function updateShadowButton() {
  const button = $('#btnShadowStrength');
  if (button) button.textContent = `Shadow: ${Math.round(ffShadowStrength * 100)}%`;
}

const actions = {
  async addImage() {
    const f = await pickFile(); if (!f) return;
    const m = await loadMeta(f.src);
    const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h, 1);
    addLayerTop({ id: uid(), type: 'image', name: ffNiceName(f.name, 'Image'), visible: true, locked: false, opacity: 1,
      src: f.src, x: (doc.canvas.w - m.w * s) / 2, y: (doc.canvas.h - m.h * s) / 2, w: m.w * s, h: m.h * s, rotation: 0 });
  },
  async addOverlay() {
    const f = await pickFile(); if (!f) return;
    const m = await loadMeta(f.src);
    const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h);
    addLayerTop({ id: uid(), type: 'overlay', name: ffNiceName(f.name, 'Artwork'), visible: true, locked: true, opacity: 1,
      src: f.src, x: (doc.canvas.w - m.w * s) / 2, y: (doc.canvas.h - m.h * s) / 2, w: m.w * s, h: m.h * s, rotation: 0 });
    toast('Overlay added and locked on top');
  }
};

function sizePill() { $('#sizePill').textContent = `${doc.canvas.w} × ${doc.canvas.h}`; }

function download(blobOrUrl, name) {
  const a = document.createElement('a');
  a.download = name;
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.click();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportCanvas(opts) {
  const scale = opts.scale || 2;
  const off = document.createElement('canvas');
  off.width = Math.round(doc.canvas.w * scale);
  off.height = Math.round(doc.canvas.h * scale);
  const c = off.getContext('2d');
  contentCache.clear();
  render(c, { scale, chrome: false, quality: 'export', only: opts.only || null, bg: opts.bg !== false });
  contentCache.clear();
  render();
  return off;
}

/* Tighten the document around visible overlay pixels and frame geometry. */
$('#btnFitCanvas').onclick = async () => {
  const overlays = doc.layers.filter(l => l.visible && l.type === 'overlay');
  const frames = doc.layers.filter(l => l.visible && l.type === 'frame');
  if (!overlays.length) { toast('Add a transparent mockup overlay first'); return; }

  const pad = await uiNumber({
    title: 'Trim canvas to mockup',
    message: 'Trims the document to the visible overlay pixels and frame geometry.',
    label: 'Padding around mockup (canvas pixels)',
    value: 20, min: 0, max: 300, step: 1,
    hint: 'Keeps a margin so the overlay edge is not clipped.',
    confirmLabel: 'Trim canvas',
  });
  if (pad == null) return;

  const off = exportCanvas({ scale: 1, only: ['overlay'], bg: false });
  const pixels = off.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, off.width, off.height).data;
  let minX = off.width, minY = off.height, maxX = -1, maxY = -1;
  for (let y = 0; y < off.height; y++) {
    for (let x = 0; x < off.width; x++) {
      if (pixels[(y * off.width + x) * 4 + 3] > 3) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  frames.forEach(f => f.points.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }));
  if (maxX < minX || maxY < minY) { toast('No visible mockup pixels found'); return; }

  const x0 = Math.max(0, Math.floor(minX - pad));
  const y0 = Math.max(0, Math.floor(minY - pad));
  const x1 = Math.min(doc.canvas.w, Math.ceil(maxX + 1 + pad));
  const y1 = Math.min(doc.canvas.h, Math.ceil(maxY + 1 + pad));
  const newW = Math.max(8, x1 - x0), newH = Math.max(8, y1 - y0);
  if (newW === doc.canvas.w && newH === doc.canvas.h && x0 === 0 && y0 === 0) {
    toast('Canvas is already fitted'); return;
  }

  doc.layers.forEach(l => {
    if (l.type === 'frame') l.points.forEach(p => { p.x -= x0; p.y -= y0; });
    else { if (typeof l.x === 'number') l.x -= x0; if (typeof l.y === 'number') l.y -= y0; }
  });
  doc.canvas.w = newW;
  doc.canvas.h = newH;
  contentCache.clear();
  sizePill();
  fit();
  sync();
  toast(`Canvas fitted to ${newW} × ${newH} with ${pad}px padding`);
};

/* Opening bleed: the drop target grows a little under the artwork's border. */
const FF_OPENING_BLEED_KEY = 'frameforge.openingBleed';
const ffSavedOpeningBleed = localStorage.getItem(FF_OPENING_BLEED_KEY);
let ffOpeningBleed = ffSavedOpeningBleed == null ? 6 : Math.max(0, Math.min(20, Number(ffSavedOpeningBleed) || 0));

function polygonSignedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/* Constant-distance polygon expansion. The Canva image extends beneath the
   opaque overlay, hiding antialiasing gaps without changing the artwork. */
function makeOverlayAlphaMap(canvas = null) {
  try {
    const c = canvas || exportCanvas({ scale: 1, only: ['overlay'], bg: false });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    return {
      data: ctx.getImageData(0, 0, c.width, c.height).data,
      w: c.width,
      h: c.height,
      sx: c.width / doc.canvas.w,
      sy: c.height / doc.canvas.h
    };
  } catch (error) {
    console.warn('Auto-safe bleed could not inspect overlay alpha', error);
    return null;
  }
}

function overlayAlphaAt(map, x, y) {
  if (!map) return 0;
  const cx = Math.round(x * map.sx), cy = Math.round(y * map.sy);
  const rx = Math.max(1, Math.round(map.sx)), ry = Math.max(1, Math.round(map.sy));
  let total = 0, count = 0;
  for (let yy = cy - ry; yy <= cy + ry; yy++) {
    for (let xx = cx - rx; xx <= cx + rx; xx++) {
      if (xx < 0 || yy < 0 || xx >= map.w || yy >= map.h) continue;
      total += map.data[(yy * map.w + xx) * 4 + 3];
      count++;
    }
  }
  return count ? total / count : 0;
}

function openingWithBleed(points, bleed = ffOpeningBleed, alphaMap = null) {
  if (!points || points.length < 3 || !(bleed > 0)) return (points || []).map(p => ({ x: p.x, y: p.y }));
  const orientation = polygonSignedArea(points) >= 0 ? 1 : -1;
  const normal = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return orientation > 0 ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
  };
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const n0 = normal(p0, p1), n1 = normal(p1, p2);
    let bx = n0.x + n1.x, by = n0.y + n1.y;
    const bl = Math.hypot(bx, by);
    if (bl < 0.0001) { bx = n1.x; by = n1.y; }
    else { bx /= bl; by /= bl; }
    const dot = Math.max(0.34, bx * n1.x + by * n1.y);
    const targetDistance = Math.min(bleed / dot, bleed * 2.8);
    let distance = alphaMap ? targetDistance : 0;

    /* Follow this vertex's outward bisector through the rendered overlay.
       Once an opaque border is found, stop before its outer transparent edge.
       Thin borders therefore get a small bleed; thick borders get the full value. */
    if (alphaMap) {
      const step = 0.5;
      let enteredBorder = false, lastCovered = 0, clearRun = 0;
      for (let d = step; d <= targetDistance + 0.001; d += step) {
        const alpha = overlayAlphaAt(alphaMap, p1.x + bx * d, p1.y + by * d);
        if (alpha >= 105) {
          enteredBorder = true;
          lastCovered = d;
          clearRun = 0;
        } else if (enteredBorder) {
          clearRun += step;
          if (clearRun >= 1.5) break;
        }
      }
      if (enteredBorder) distance = Math.min(targetDistance, Math.max(0.5, lastCovered - 0.75));
      else distance = 0;
    }

    out.push({
      x: Math.max(0, Math.min(doc.canvas.w, p1.x + bx * distance)),
      y: Math.max(0, Math.min(doc.canvas.h, p1.y + by * distance))
    });
  }
  return out;
}

if ($('#btnShadowStrength')) $('#btnShadowStrength').onclick = async () => {
  const L = shadowLayer();
  if (!L) { toast('This design has no shadow layer'); return; }
  const raw = await uiPrompt('Shadow strength', String(Math.round((L.strength || ffShadowStrength) * 100)), 'Percent of light the shadow removes (5-45). Higher looks stronger; the cap keeps the opening detectable.');
  if (raw == null) return;
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) { toast('Enter a number from 5 to 45'); return; }
  ffShadowStrength = Math.max(0.02, Math.min(0.45, value / 100));
  await restyleShadowLayer(L, ffShadowStrength);
  toast(`Shadow rebuilt at ${Math.round(ffShadowStrength * 100)}%`);
};

function updateOpeningBleedButton() {
  const button = $('#btnOpeningBleed');
  if (button) button.textContent = `Auto bleed: ${ffOpeningBleed}px`;
}
updateOpeningBleedButton();
updateShadowButton();
if ($('#btnOpeningBleed')) $('#btnOpeningBleed').onclick = async () => {
  const value = await uiNumber({
    title: 'Auto-safe bleed',
    message: 'This is a maximum, not a forced amount. FrameForge measures overlay opacity along every opening vertex and automatically uses less bleed on thin borders.',
    label: 'Maximum bleed (pixels)',
    value: ffOpeningBleed, min: 0, max: 20, step: 0.5,
    hint: '6px suits most borders. Try 8px for rough or torn edges.',
  });
  if (value == null) return;
  ffOpeningBleed = Math.round(Math.max(0, Math.min(20, value)) * 10) / 10;
  localStorage.setItem(FF_OPENING_BLEED_KEY, String(ffOpeningBleed));
  updateOpeningBleedButton();
  toast(`Auto-safe bleed max set to ${ffOpeningBleed}px · thin borders will use less`);
};

function framePath(points, smooth) {
  if (!points || points.length < 3) return '';
  const n = v => String(Math.round(Number(v) * 10) / 10);
  if (!smooth) return 'M ' + n(points[0].x) + ' ' + n(points[0].y) + ' ' + points.slice(1).map(p => 'L ' + n(p.x) + ' ' + n(p.y)).join(' ') + ' Z';
  // Safe corner-aware smoothing: sharp silhouette details stay as lines;
  // only locally smooth runs receive short cubic handles. Unlike unrestricted
  // Catmull-Rom this cannot throw long loops across narrow hair/arm contours.
  const reduceOne = src => {
    if(src.length<=16)return src;
    let at=0,best=Infinity;
    for(let i=0;i<src.length;i++){
      const a=src[(i-1+src.length)%src.length],b=src[i],c=src[(i+1)%src.length];
      const area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
      const span=Math.hypot(c.x-a.x,c.y-a.y)||1;
      const score=area*span;
      if(score<best){best=score;at=i}
    }
    return src.filter((_,i)=>i!==at);
  };
  const tangent = (pts,i) => {
    const a=pts[(i-1+pts.length)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];
    const d1=Math.hypot(b.x-a.x,b.y-a.y),d2=Math.hypot(c.x-b.x,c.y-b.y);
    if(d1<.01||d2<.01)return{x:0,y:0};
    const u1={x:(b.x-a.x)/d1,y:(b.y-a.y)/d1},u2={x:(c.x-b.x)/d2,y:(c.y-b.y)/d2};
    const dot=u1.x*u2.x+u1.y*u2.y;
    if(dot<.72)return{x:0,y:0}; // preserve corners, tips and narrow cuts
    const tx=u1.x+u2.x,ty=u1.y+u2.y,tl=Math.hypot(tx,ty)||1;
    const amount=Math.min(d1,d2)*.16*Math.min(1,(dot-.72)/.28);
    return{x:tx/tl*amount,y:ty/tl*amount};
  };
  const curve = pts => {
    const out=['M'+n(pts[0].x)+' '+n(pts[0].y)];
    for(let i=0;i<pts.length;i++){
      const a=pts[i],b=pts[(i+1)%pts.length],ta=tangent(pts,i),tb=tangent(pts,(i+1)%pts.length);
      if((Math.abs(ta.x)+Math.abs(ta.y)<.01)||(Math.abs(tb.x)+Math.abs(tb.y)<.01))out.push('L'+n(b.x)+' '+n(b.y));
      else out.push('C'+n(a.x+ta.x)+' '+n(a.y+ta.y)+' '+n(b.x-tb.x)+' '+n(b.y-tb.y)+' '+n(b.x)+' '+n(b.y));
    }
    return out.join('')+'Z';
  };
  let pts=points.slice(),path=curve(pts);
  // Simplify to a little under the budget so later encoding stays safe.
  const target=FF_LIMITS.PATH_BUDGET-80;
  while(new TextEncoder().encode(path).length>target&&pts.length>16){pts=reduceOne(pts);path=curve(pts)}
  return path;
}
