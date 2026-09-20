'use strict';
/* =========================================================================
   FrameForge Studio - 13-scene.js
   scene hand-off plate and colour-key extraction
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* ---------------------------------------------------------------------
   Minimal store-only ZIP writer.
   A browser download cannot create a folder, so the hand-off files are
   bundled into one archive that unpacks into a single named folder.
   PNG bytes are already compressed, so skipping DEFLATE costs almost
   nothing and keeps this dependency-free.
   --------------------------------------------------------------------- */
function _ffCrc32(buf) {
  let t = _ffCrc32.table;
  if (!t) {
    t = _ffCrc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function _ffZip(files) {
  const enc = new TextEncoder();
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980 /* ff-limits-ok: ZIP DOS epoch */) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const body = [], central = [];
  let offset = 0, centralSize = 0;

  files.forEach(f => {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = _ffCrc32(data);
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0)
    ]);
    body.push(local, name, data);
    const cd = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset)
    ]);
    central.push(cd, name);
    centralSize += cd.length + name.length;
    offset += local.length + name.length + data.length;
  });

  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0)
  ]);
  return new Blob([...body, ...central, end], { type: 'application/zip' });
}

/* Flatten the current design into the hand-off plate: white ground, every
   frame opening filled with the key colour, artwork painted on top so the
   border covers the key colour's edge. */
function sceneBuildKeyedPlate(frames, scale) {
  const art = exportCanvas({ scale, only: ['overlay', 'shadow'], bg: false });
  const plate = document.createElement('canvas');
  plate.width = art.width; plate.height = art.height;
  const k = plate.getContext('2d');
  k.fillStyle = '#FFFFFF';
  k.fillRect(0, 0, plate.width, plate.height);
  k.save();
  k.scale(scale, scale);
  k.fillStyle = FF_SCENE_KEY_HEX;
  frames.forEach(f => {
    if (!f.points || f.points.length < 3) return;
    k.beginPath();
    k.moveTo(f.points[0].x, f.points[0].y);
    f.points.slice(1).forEach(p => k.lineTo(p.x, p.y));
    k.closePath();
    k.fill();
  });
  k.restore();
  k.drawImage(art, 0, 0);
  return plate;
}

/* width / height of a rebuilt opening, from its bounding box. */
function _ffOpeningAspect(o) {
  const pts = o && (o.pts || o.points);
  if (!pts || pts.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].x < minX) minX = pts[i].x;
    if (pts[i].x > maxX) maxX = pts[i].x;
    if (pts[i].y < minY) minY = pts[i].y;
    if (pts[i].y > maxY) maxY = pts[i].y;
  }
  const w = maxX - minX, h = maxY - minY;
  return h > 0 ? w / h : null;
}

/* ---------------------------------------------------------------------
   Ratio rectify.

   An image model hands back an opening that is a percent or two off the
   print ratio it was given. Rejecting that render throws away a good
   photograph over an error the eye cannot see, and stretching artwork to
   fill it pushes the same error onto the buyer's print instead. So the
   geometry is corrected here: the whole scene is scaled by a hair about
   the centre of the opening until the opening is exactly the declared
   ratio. Nothing is pasted, repainted or re-lit, so every bit of the
   model's realism survives; a 2% correction on a 1500px render moves the
   furthest pixel by about ten.

   The correction is area-preserving - w' = sqrt(ratio * w * h) - so the
   print keeps the size it was rendered at and only changes shape. A
   uniform cover factor is then applied so the scaled scene still fills
   the canvas and no bare strip appears along an edge.

   Only an axis-aligned opening is corrected. A scene in perspective
   needs a warp that decays back to identity away from the frame, which
   is not shipped yet, so those are reported instead of silently bent.
   --------------------------------------------------------------------- */
const FF_SCENE_RECTIFY_MIN = 0.002;   // below this the fix is pointless
const FF_SCENE_RECTIFY_MAX = 0.08;    // above this it is a real mix-up, not drift

function _ffRectifyTransform(pts, target) {
  if (!pts || pts.length < 3 || !(target > 0)) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].x < minX) minX = pts[i].x;
    if (pts[i].x > maxX) maxX = pts[i].x;
    if (pts[i].y < minY) minY = pts[i].y;
    if (pts[i].y > maxY) maxY = pts[i].y;
  }
  const w = maxX - minX, h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return null;

  const got = w / h;
  const drift = Math.abs(got - target) / target;

  const w2 = Math.sqrt(target * w * h);     // area-preserving
  const h2 = w2 / target;
  let sx = w2 / w, sy = h2 / h;

  /* One axis always comes out below 1. Scaling both by the same cover
     factor keeps the ratio exact while guaranteeing the scene still
     reaches every edge of the canvas. */
  const cover = Math.max(1 / sx, 1 / sy, 1);
  sx *= cover; sy *= cover;

  return { sx, sy, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, got, target, drift };
}

async function _ffRectifyScene(src, w, h, t) {
  const img = await loadImg(src);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  /* scale about the centre of the opening, not the centre of the canvas,
     so the frame stays where the model put it */
  x.setTransform(t.sx, 0, 0, t.sy, t.cx - t.sx * t.cx, t.cy - t.sy * t.cy);
  x.drawImage(img, 0, 0, w, h);
  x.setTransform(1, 0, 0, 1, 0, 0);
  return c.toDataURL('image/png');
}

function _ffSceneSlug(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

if ($('#btnSceneExport')) {
  $('#btnSceneExport').onclick = async () => {
    const frames = doc.layers.filter(l => l.type === 'frame' && l.visible !== false && l.points && l.points.length >= 3);
    if (!frames.length) { toast('No opening found - add a frame first'); return; }
    const art = doc.layers.filter(l => (l.type === 'overlay' || l.type === 'shadow') && l.visible !== false);
    if (!art.length) { toast('Add a mockup overlay first, then export for AI'); return; }

    const scale = 2;
    const plate = sceneBuildKeyedPlate(frames, scale);
    const openingArea = frames.reduce((sum, f) => sum + _ffPolyArea(f.points), 0);
    const areaRatio = openingArea / Math.max(1, doc.canvas.w * doc.canvas.h);

    const sidecar = {
      version: 2,
      keyColour: FF_SCENE_KEY_HEX,
      keyDetection: 'hue',
      shadowOverKeyAllowed: true,
      exportScale: scale,
      sourceCanvas: { w: doc.canvas.w, h: doc.canvas.h },
      sourceAspect: +(doc.canvas.w / doc.canvas.h).toFixed(4),
      openingAreaRatio: +areaRatio.toFixed(5),
      openingCount: frames.length,
      /* The declared print ratio of the opening, when one was chosen from
         the ratio presets. The canvas aspect below is NOT a substitute:
         an image model usually returns the same canvas size while still
         handing back an opening of the wrong shape, so the canvas check
         passes and the error goes out the door. This is the value that
         actually catches "I asked for A4 and got US Letter", and it is
         also what the importer rectifies the render against. */
      openingRatioId: (frames.find(f => f.ratioId) || {}).ratioId || null,
      openingRatio: (frames.find(f => f.ratioValue) || {}).ratioValue || null,
      openings: frames.map(f => ({
        frameType: f.frameType || 'rect',
        ratioId: f.ratioId || null,
        ratioValue: f.ratioValue || null,
        points: f.points.map(p => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) }))
      })),
      exportedAt: new Date().toISOString()
    };
    try { localStorage.setItem(FF_SCENE_SIDECAR_KEY, JSON.stringify(sidecar)); } catch (e) { /* quota - validation just gets skipped */ }

    const overlayName = (art.find(l => l.type === 'overlay') || {}).name || 'frame';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const slug = _ffSceneSlug(overlayName) || 'frame';
    const folder = 'frameforge-for-ai-' + slug + '-' + stamp;

    const readme = [
      'FrameForge - AI scene hand-off',
      '',
      'Files in this folder',
      '  frame-keyed.png     give this to the image model',
      '  chatgpt-prompt.txt  paste this as the message',
      '  handoff.json        read back by "Import AI scene" for validation',
      '',
      'Steps',
      '  1. Open ChatGPT (or any image model).',
      '  2. Attach frame-keyed.png and paste the contents of',
      '     chatgpt-prompt.txt as the message.',
      '  3. Download the scene it returns.',
      '  4. Back in FrameForge, click "Import AI scene" and pick that file.',
      '     Start with a green key tolerance of 90.',
      '',
      'Notes',
      '  The solid green block is the photo opening. Shadows may fall across',
      '  it, but it must stay green and must stay empty.',
      '  Import in the same browser you exported from, otherwise the sidecar',
      '  validation warnings are skipped.',
      '  A model usually returns the opening a percent or two off the ratio',
      '  it was asked for. The importer measures that and corrects the whole',
      '  render, so the print comes out at the exact ratio either way.',
      '',
      'Source canvas   ' + doc.canvas.w + ' x ' + doc.canvas.h,
      'Export scale    ' + scale + 'x  (' + plate.width + ' x ' + plate.height + ')',
      'Openings        ' + frames.length,
      'Opening area    ' + Math.round(areaRatio * 100) + '% of the canvas',
      'Exported        ' + sidecar.exportedAt,
      ''
    ].join('\n');

    const pngBlob = await new Promise(res => plate.toBlob(res, 'image/png'));
    const enc = new TextEncoder();
    const zip = _ffZip([
      { name: folder + '/frame-keyed.png', data: new Uint8Array(await pngBlob.arrayBuffer()) },
      { name: folder + '/chatgpt-prompt.txt', data: enc.encode(FF_SCENE_PROMPT) },
      { name: folder + '/handoff.json', data: enc.encode(JSON.stringify(sidecar, null, 2)) },
      { name: folder + '/README.txt', data: enc.encode(readme) }
    ]);
    download(zip, folder + '.zip');

    let copied = false;
    try { await navigator.clipboard.writeText(FF_SCENE_PROMPT); copied = true; } catch (e) { copied = false; }

    toast('Hand-off ZIP exported (4 files)' + (copied ? ' - prompt also copied to clipboard' : ' - prompt is inside the ZIP') +
      ' - opening is ' + Math.round(areaRatio * 100) + '% of the canvas');
  };
}

/* Hue test that survives shadow. A shadowed key green keeps r and b near
   zero and only loses brightness, so test the channel ratio instead of the
   distance to pure #00FF00. Natural foliage carries a real red component
   and is rejected. Tolerance widens the allowed red/blue contamination and
   lowers the brightness floor, so a higher number keeps deeper shadow. */
function _ffIsKeyGreen(r, g, b, tol) {
  const t = Math.max(10, Math.min(200, tol)) / 200;
  const slack = 0.25 + t * 0.45;              // 0.27 .. 0.70
  const floor = 46 - Math.round(t * 30);      // 45 .. 16
  return g >= floor && r < g * slack && b < g * slack;
}

/* The model renders a soft, anti-aliased edge where the key meets the
   frame. Those blend pixels are too contaminated to pass the hue test but
   still read as a thin green fringe once the key is gone. Grow the kill
   mask a couple of pixels into any neighbour that is still clearly
   green-dominant. Only the kill mask grows - the core mask keeps driving
   geometry and shadow, so the opening does not creep outwards. */
function _ffGrowFringe(core, d, w, h, passes) {
  const kill = Uint8Array.from(core);
  for (let pass = 0; pass < passes; pass++) {
    const add = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (kill[p]) continue;
        if (!((x > 0 && kill[p - 1]) || (x < w - 1 && kill[p + 1]) ||
              (y > 0 && kill[p - w]) || (y < h - 1 && kill[p + w]))) continue;
        const i = p * 4;
        if (d[i + 3] < 8) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (g > r && g > b && g - Math.max(r, b) > 12) add.push(p);
      }
    }
    if (!add.length) break;
    for (const p of add) kill[p] = 1;
  }
  return kill;
}

async function sceneKeyOut(L, tol) {
  const img = await loadImg(L.src);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, w, h), d = im.data;

  const mask = new Uint8Array(w * h);
  const greenVal = new Uint8Array(w * h);
  let cleared = 0;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (d[i + 3] < 8) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (!_ffIsKeyGreen(r, g, b, tol)) continue;
    mask[p] = 1; greenVal[p] = g; cleared++;
  }
  if (cleared < w * h * 0.004) return null;

  /* --- shadow harvest ---
     Brightest key pixels are the unshaded reference, matching the 95th
     percentile logic buildShadowSource() already uses. The plate is a
     greyscale image (white = no shadow) so the existing Shadow: N% button
     can restyle it later with no special cases. */
  const hist = new Uint32Array(256);
  for (let p = 0; p < w * h; p++) if (mask[p]) hist[greenVal[p]]++;
  let seen = 0, reference = 255;
  const hi = cleared * 0.95;
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= hi) { reference = Math.max(1, v); break } }
  let seenLo = 0, floorVal = reference;
  const lo = cleared * 0.05;
  for (let v = 0; v < 256; v++) { seenLo += hist[v]; if (seenLo >= lo) { floorVal = v; break } }
  const shadowDepth = Math.max(0, Math.min(1, (reference - floorVal) / reference));

  let shadowPlate = null;
  if (shadowDepth >= 0.08) {
    const sp = document.createElement('canvas');
    sp.width = w; sp.height = h;
    const spc = sp.getContext('2d');
    const spi = spc.createImageData(w, h), sd = spi.data;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const v = mask[p] ? Math.max(0, Math.min(255, Math.round(255 * greenVal[p] / reference))) : 255;
      sd[i] = sd[i + 1] = sd[i + 2] = v; sd[i + 3] = 255;
    }
    spc.putImageData(spi, 0, 0);
    shadowPlate = sp.toDataURL('image/png');
  }

  /* knock the key out of the scene, fringe included */
  const kill = _ffGrowFringe(mask, d, w, h, 2);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) if (kill[p]) d[i + 3] = 0;
  ctx.putImageData(im, 0, 0);

  /* every separate key region becomes its own opening, so an occluded or
     duplicated frame does not silently lose part of its drop target */
  const cc = _components(mask, w, h);
  const minRegion = Math.max(64, w * h * 0.002);
  const sx = L.w / w, sy = L.h / h;
  const openings = [];
  let skipped = 0;
  for (const comp of cc.items) {
    if (comp.size < minRegion) { skipped++; continue }
    if (openings.length >= 12) { skipped++; continue }
    const boxArea = (comp.maxX - comp.minX + 1) * (comp.maxY - comp.minY + 1);
    const rectangularity = boxArea > 0 ? comp.size / boxArea : 0;
    let raw;
    if (rectangularity >= 0.82) {
      raw = [[comp.minX, comp.minY], [comp.maxX, comp.minY], [comp.maxX, comp.maxY], [comp.minX, comp.maxY]];
    } else {
      raw = await _maskOutline(_componentMask(cc.labels, comp.id), w, h, 60);
      if (!raw || raw.length < 3) { skipped++; continue }
    }
    openings.push({
      pts: raw.map(p => ({ x: +(L.x + p[0] * sx).toFixed(1), y: +(L.y + p[1] * sy).toFixed(1) })),
      rectangular: rectangularity >= 0.82
    });
  }
  if (!openings.length) return null;

  return {
    src: c.toDataURL('image/png'),
    openings, shadowPlate, shadowDepth, cleared, skipped,
    coverage: cleared / (w * h)
  };
}

async function sceneKeyApply(L, tol) {
  const res = await sceneKeyOut(L, tol);
  if (!res) return null;

  L.src = res.src; imgCache.delete(res.src);
  L.type = 'overlay';
  L.locked = true;
  L.sceneSource = true;
  if (!/scene/i.test(L.name || '')) L.name = (L.name || 'AI') + ' Scene';

  const multi = res.openings.length > 1;
  const frames = res.openings.map((o, i) => ({
    id: uid(), type: 'frame',
    name: multi ? 'Opening Frame ' + (i + 1) : 'Opening Frame',
    frameType: o.pts.length === 4 ? (isAxisRect(o.pts) ? 'rect' : 'perspective') : 'polygon',
    visible: true, locked: false, opacity: 1,
    points: o.pts, content: null
  }));

  doc.layers = doc.layers.filter(x => x.id !== L.id);
  frames.forEach(f => doc.layers.push(f));  // frames below
  doc.layers.push(L);                       // scene above them

  /* The harvested shadow becomes a normal shadow layer so the buyer's
     artwork picks up the same window light as the frame. It is built at
     full strength against the scene ceiling, because the plate already
     encodes exactly how dark the model made each pixel - the goal is to
     reproduce that measurement, not to restyle it. The Shadow % button
     still dials it back afterwards. */
  res.shadowLayerAdded = false;
  if (res.shadowPlate) {
    try {
      const strength = 0.45;
      const shadowSrc = await buildShadowSource(res.shadowPlate, strength, SHADOW_SCENE_MAX_ALPHA);
      doc.layers.push({
        id: uid(), type: 'shadow', name: 'Scene Shadow', sceneSource: true,
        visible: true, locked: true, opacity: 1,
        src: res.shadowPlate, shadowSrc, strength, maxAlpha: SHADOW_SCENE_MAX_ALPHA,
        x: L.x, y: L.y, w: L.w, h: L.h, rotation: 0
      });
      ffShadowStrength = strength;
      res.shadowLayerAdded = true;
      updateShadowButton();
    } catch (e) { res.shadowLayerAdded = false }
  }

  sel = frames[0].id;
  contentCache.clear();
  sync();
  return res;
}

/* Start a fresh scene document from one image and hand back the layer the
   key-out runs on. Import calls this a second time when the render has to
   be rectified, so the two passes cannot drift apart. */
function _ffSceneNewDoc(name, src, w, h) {
  const L = {
    id: uid(), type: 'image', sceneSource: true,
    name: name || 'AI scene',
    visible: true, locked: false, opacity: 1,
    src, x: 0, y: 0, w, h, rotation: 0
  };
  doc = { canvas: { w, h, bg: '#FFFFFF' }, kind: 'scene', layers: [L] };
  sel = L.id; contentEdit = null; contentCache.clear(); sizePill(); fit(); sync();
  return L;
}

if ($('#btnSceneImport')) {
  $('#btnSceneImport').onclick = async () => {
    const f = await pickFile();
    if (!f) return;
    const m = await loadMeta(f.src);
    if (!m.w || !m.h) { toast('Could not read that image'); return; }

    const raw = await uiPrompt('Green key tolerance', '90',
      'How far from pure green a pixel may drift and still count as the opening. Try 90. Raise it if shadow on the green was not picked up; lower it if green parts of the scene are being eaten.');
    if (raw == null) return;
    const parsed = parseInt(raw, 10);
    const tol = Math.max(10, Math.min(200, isFinite(parsed) ? parsed : 90));

    let sidecar = null;
    try { sidecar = JSON.parse(localStorage.getItem(FF_SCENE_SIDECAR_KEY) || 'null'); } catch (e) { sidecar = null }

    // a scene always becomes its own document, so the original frame design survives
    const name = (f.name || '').replace(/\.[^.]+$/, '') || 'AI scene';
    let L = _ffSceneNewDoc(name, f.src, m.w, m.h);

    toast('Looking for the green opening\u2026');
    let res = null;
    try { res = await sceneKeyApply(L, tol); } catch (e) { res = null }

    if (!res) {
      toast('No green opening found - use Pick opening to click inside it, or re-import with a higher tolerance');
      return;
    }

    /* --- ratio rectify ---
       Measure the opening the model actually drew, and if it is off the
       declared ratio by a correctable amount, nudge the whole render and
       key it out again. The second pass measures the corrected picture,
       so the number reported below is real and not predicted. */
    let fixed = null;
    if (sidecar && sidecar.openingRatio && res.openings.length === 1) {
      const o0 = res.openings[0];
      const square = o0.pts.length === 4 && isAxisRect(o0.pts);
      const t = square ? _ffRectifyTransform(o0.pts, sidecar.openingRatio) : null;
      if (t && t.drift > FF_SCENE_RECTIFY_MIN && t.drift <= FF_SCENE_RECTIFY_MAX) {
        toast('Opening is ' + (t.drift * 100).toFixed(1) + '% off the print ratio - correcting\u2026');
        let res2 = null;
        try {
          const fixedSrc = await _ffRectifyScene(f.src, m.w, m.h, t);
          L = _ffSceneNewDoc(name, fixedSrc, m.w, m.h);
          res2 = await sceneKeyApply(L, tol);
        } catch (e) { res2 = null }
        if (res2) { res = res2; fixed = t; }
        else {
          /* the corrected pass failed for some reason - fall back to the
             render exactly as the model returned it rather than leaving
             the user with a half-built document */
          L = _ffSceneNewDoc(name, f.src, m.w, m.h);
          try { res = await sceneKeyApply(L, tol) || res; } catch (e) { /* keep the first result */ }
        }
      }
    }

    const notes = [];
    if (sidecar && sidecar.openingAreaRatio) {
      const drift = res.coverage / sidecar.openingAreaRatio;
      if (drift < 0.6) notes.push('opening came back ' + Math.round((1 - drift) * 100) + '% smaller than exported - the model may have painted over it');
      else if (drift > 1.6) notes.push('opening came back ' + Math.round((drift - 1) * 100) + '% larger than exported - green may have bled into the scene');
    }
    if (sidecar && sidecar.sourceAspect) {
      const aspect = m.w / m.h;
      if (Math.abs(aspect - sidecar.sourceAspect) / sidecar.sourceAspect > 0.08) {
        notes.push('scene aspect ratio differs from the export - check the frame is not stretched');
      }
    }
    if (sidecar && sidecar.openingCount && res.openings.length > sidecar.openingCount) {
      notes.push('found ' + res.openings.length + ' openings but exported ' + sidecar.openingCount + ' - the frame may be occluded or duplicated');
    }

    /* Shape of the opening itself, against the ratio that was declared.
       Anything inside the rectify band has already been corrected above,
       so what is left here is either a shape that could not be corrected
       or a genuine mix-up: A-series is 0.707, US Letter 0.773 and 11x14
       0.786, so swapping one for another lands 8-10% out and cannot hide
       behind the correction. */
    let after = null;
    if (sidecar && sidecar.openingRatio) {
      after = _ffOpeningAspect(res.openings[0]);
      if (after) {
        const drift = Math.abs(after - sidecar.openingRatio) / sidecar.openingRatio;
        const declared = (sidecar.openingRatioId || 'the export') + ' is ' + sidecar.openingRatio.toFixed(3);
        if (drift > FF_SCENE_RECTIFY_MAX) {
          notes.push('opening came back at ratio ' + after.toFixed(3) + ' but ' + declared +
            ' (' + Math.round(drift * 100) + '% out) - too far out to be drift, the model changed the print shape, do not publish this');
        } else if (drift > FF_SCENE_RECTIFY_MIN) {
          notes.push('opening is at ratio ' + after.toFixed(3) + ' but ' + declared +
            ' (' + (drift * 100).toFixed(1) + '% out) and could not be corrected automatically - the opening is not square-on, so check it before publishing');
        }
      }
    } else if (sidecar) {
      notes.push('no print ratio was declared on export, so the opening shape could not be checked - pick a frame ratio before exporting');
    }

    if (!sidecar) {
      notes.push('no sidecar found in this browser, so none of the import checks ran - export and import from the same browser');
    }

    const parts = [res.openings.length + (res.openings.length === 1 ? ' opening' : ' openings') + ' rebuilt'];
    if (fixed) {
      parts.push('ratio corrected from ' + fixed.got.toFixed(3) + ' to ' +
        (after != null ? after.toFixed(3) : fixed.target.toFixed(3)) +
        ' (' + (fixed.drift * 100).toFixed(1) + '% out' +
        (sidecar.openingRatioId ? ', ' + sidecar.openingRatioId : '') + ')');
    }
    parts.push(res.shadowLayerAdded
      ? 'shadow harvested at ' + Math.round(res.shadowDepth * 100) + '% depth'
      : 'no shadow found on the green');
    parts.push('drop an image in');

    toast('Scene imported \u00b7 ' + parts.join(' \u00b7 ') + (notes.length ? ' \u00b7 WARNING: ' + notes.join('; ') : ''));
  };
}

/* one button: transparent / checkerboard opening first, colour key second */
if ($('#btnAutoScreen')) {
  $('#btnAutoScreen').onclick = async () => {
    let L = layer(sel);
    if (!L || (L.type !== 'image' && L.type !== 'overlay')) {
      const cands = doc.layers.filter(x => x.type === 'image' || x.type === 'overlay');
      if (cands.length === 1) L = cands[0];
      else { toast('Select the artwork layer first'); return }
    }
    toast('Looking for the opening\u2026');
    try {
      if (await autoHoleApply(L)) return;
    } catch (e) { /* fall through */ }
    const raw = await uiPrompt('No transparent opening found \u2014 key out a colour instead?',
      '80', 'Tolerance: how close a pixel must be to the screen colour. Try 80; raise it if a coloured rim remains.');
    if (raw == null) return;
    const tol = parseInt(raw, 10);
    await autoScreenApply(L, isFinite(tol) ? Math.max(10, Math.min(200, tol)) : 80);
  };
}
