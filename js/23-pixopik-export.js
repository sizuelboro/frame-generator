'use strict';
/* =========================================================================
   FrameForge Studio - 23-pixopik-export.js
   Export for Pixopik: one overlay PNG plus a ready-to-paste frame entry
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.

   What Pixopik wants
   ------------------
   A frame in Pixopik's library (Elements -> Frames) is a `FrameDef`:

     { id, label, group, keywords, aspect, overlay: "png", clip: [[x, y], ...] }

   `clip` is the opening as one polygon in the frame's own box, 0-1 on each
   axis. Pixopik turns it into a `SiteFrame.clip` path of integers in a
   0-1000 box and `isFrameClip` rejects anything over 400 points or 6000
   characters. The overlay is drawn stretched over the whole box, so the box
   IS the overlay image: `aspect` is its width / height.

   What this does
   --------------
     1. Renders every decoration layer (overlay, shadow, image, text, shape)
        on a transparent background. Openings and the preview photo in them
        are not part of the artwork.
     2. Crops to the artwork plus the opening, so nothing needs Trim canvas.
     3. Grows the chosen opening with Auto bleed, exactly as Export overlay
        PNG does, then maps it into 0-1 of the crop and simplifies it to
        Pixopik's limits.
     4. Checks the result against the same rules Pixopik enforces, and only
        then lets the creator export.

   Everything between the pixopik-core markers is pure (no DOM, no Studio
   state) so the suite can call it directly.
   ========================================================================= */

/* ---- pixopik-core ---------------------------------------------------- */
const FF_PX_MAX_POINTS = FF_LIMITS.PIXOPIK_MAX_POINTS;
const FF_PX_MAX_CHARS = FF_LIMITS.PIXOPIK_MAX_CLIP_CHARS;
const FF_PX_UNITS = FF_LIMITS.PIXOPIK_CLIP_UNITS;
/* Smallest opening worth exporting: 0.01% of the frame's box. */
const FF_PX_MIN_AREA = FF_PX_UNITS * FF_PX_UNITS * 0.0001;

/* Pixopik's FRAME_GROUPS, in its own order. */
const FF_PIXOPIK_GROUPS = [
  ['basic', 'Basic shapes'],
  ['wedding', 'Wedding & ornate'],
  ['photo', 'Film and photo'],
  ['arches', 'Arches & windows'],
  ['flowers', 'Flowers & badges'],
  ['paper', 'Paper'],
  ['devices', 'Devices'],
  ['blob', 'Blob']
];

/* Ids of the frames Pixopik ships in src/lib/frameShapes.ts. An exported
   frame must not reuse one: the panel keys tiles and recents by id. */
const FF_PIXOPIK_BUILTIN_IDS = [
  'square', 'rounded', 'circle', 'triangle', 'diamond', 'hexagon', 'octagon', 'star', 'heart',
  'ornate', 'oval', 'goldarch', 'wreath', 'mandala', 'border',
  'polaroid', 'instant', 'film', 'slide',
  'arch', 'pointed', 'mughal', 'dome', 'keyhole',
  'scallop', 'flower', 'daisy', 'sunburst', 'cloud',
  'torn', 'stamp', 'taped', 'deckle',
  'phone', 'tablet', 'laptop', 'browser',
  'blob1', 'blob2', 'blob3', 'blob4'
];

const FF_PIXOPIK_QUALITY = [1000, 1600, 2400];

/* "Puffy Crayon!" -> "puffy-crayon" */
function ffPxSlug(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}
function ffPxValidId(id) {
  return typeof id === 'string' && id.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}
function ffPxBuiltinClash(id) {
  return FF_PIXOPIK_BUILTIN_IDS.indexOf(String(id || '').toLowerCase()) > -1;
}

/* Pixopik's toClip, for points already on the 0-1000 integer grid. */
function ffPxClipString(ints) {
  return 'M' + ints.map(p => p[0] + ' ' + p[1]).join(' L') + ' Z';
}

/* Pixopik's isFrameClip, character for character. */
function ffPxIsFrameClip(v) {
  if (typeof v !== 'string' || v.length > FF_PX_MAX_CHARS) return false;
  const m = /^M(\d{1,4}) (\d{1,4})((?: L\d{1,4} \d{1,4}){2,399}) Z$/.exec(v);
  return !!m && (v.match(/\d+/g) || []).every(n => Number(n) <= FF_PX_UNITS);
}

function ffPxArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/* Snap to the integer grid and drop the repeats that snapping creates,
   including a last point equal to the first (the path closes itself). */
function ffPxSnap(pts) {
  const out = [];
  for (const p of pts) {
    const q = [Math.min(FF_PX_UNITS, Math.max(0, Math.round(p[0]))), Math.min(FF_PX_UNITS, Math.max(0, Math.round(p[1])))];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

/* Douglas-Peucker for a closed ring: split at the point farthest from the
   first, so neither half's end points are arbitrary. */
function ffPxRdpClosed(pts, eps) {
  if (pts.length < 5) return pts.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplify(pts.slice(0, far + 1), eps);
  const b = simplify(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/**
 * Points in the frame's own box (0-1) -> Pixopik's integer grid, simplified
 * until both of isFrameClip's limits hold. The tolerance only grows from
 * half a grid step, so a shape already within the limits is kept exactly.
 */
function ffPxFitPoints(unitPts) {
  const scaled = unitPts.map(p => [p[0] * FF_PX_UNITS, p[1] * FF_PX_UNITS]);
  let ints = ffPxSnap(scaled);
  const source = ints.length;
  let eps = 0.5;
  while ((ints.length > FF_PX_MAX_POINTS || ffPxClipString(ints).length > FF_PX_MAX_CHARS) && eps < FF_PX_UNITS) {
    ints = ffPxSnap(ffPxRdpClosed(scaled, eps));
    eps *= 1.3;
  }
  const clip = ffPxClipString(ints);
  // Pixopik's validator accepts three points on a line; a photo cannot drop
  // into that, so it is refused here.
  const valid = ints.length >= 3 && ffPxArea(ints) >= FF_PX_MIN_AREA && ffPxIsFrameClip(clip);
  return { ints, clip, source, valid };
}

/* Opening in canvas pixels -> 0-1 of the crop box. */
function ffPxToUnit(points, box) {
  return points.map(p => [
    Math.min(1, Math.max(0, (p.x - box.x) / box.w)),
    Math.min(1, Math.max(0, (p.y - box.y) / box.h))
  ]);
}

/* Bounding box of everything with alpha above 3 in an RGBA buffer, in the
   buffer's own pixels. Null when it is empty. */
function ffPxAlphaBounds(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 3) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* Union of boxes, snapped outwards to whole pixels and kept on the canvas. */
function ffPxUnionBox(boxes, cw, ch) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  const x0 = Math.max(0, Math.floor(Math.min(...list.map(b => b.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...list.map(b => b.y))));
  const x1 = Math.min(cw, Math.ceil(Math.max(...list.map(b => b.x + b.w))));
  const y1 = Math.min(ch, Math.ceil(Math.max(...list.map(b => b.y + b.h))));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/* The text the creator pastes into Pixopik's src/lib/customFrames.ts.
   Strings go through JSON.stringify so a quote in a name cannot break it. */
function ffPxEntry(o) {
  const pts = o.ints.map(p => '[' + +(p[0] / FF_PX_UNITS).toFixed(3) + ', ' + +(p[1] / FF_PX_UNITS).toFixed(3) + ']');
  const rows = [];
  for (let i = 0; i < pts.length; i += 8) rows.push('      ' + pts.slice(i, i + 8).join(', ') + ',');
  return [
    '  {',
    '    id: ' + JSON.stringify(o.id) + ',',
    '    label: ' + JSON.stringify(o.label) + ',',
    '    group: ' + JSON.stringify(o.group) + ',',
    '    keywords: ' + JSON.stringify(o.keywords || '') + ',',
    '    aspect: ' + o.aspect + ',',
    o.overlay ? '    overlay: "png",' : null,
    '    clip: [',
    rows.join('\n'),
    '    ],',
    '  },'
  ].filter(l => l !== null).join('\n');
}

function ffPxFileText(o) {
  const head = [
    '// Pixopik frame ' + JSON.stringify(o.label) + ', exported from FrameForge on ' + (o.date || new Date().toISOString().slice(0, 10)) + '.',
    '//',
    o.overlay
      ? '// 1. Save ' + o.id + '.png as public/frames/' + o.id + '.png in the Pixopik repo.'
      : '// 1. No artwork: this is a plain cut-out frame, there is no PNG to copy.',
    '// 2. Paste the entry below into CUSTOM_FRAMES in src/lib/customFrames.ts.',
    '// 3. It appears under Elements -> Frames -> ' + o.groupLabel + '.',
    ''
  ];
  return head.join('\n') + '\n' + ffPxEntry(o) + '\n';
}
/* ---- end pixopik-core ------------------------------------------------- */

/* Layers that make up the artwork. Frames (and the photo previewed in
   them) are the opening, not the artwork. */
const FF_PX_ART = ['overlay', 'shadow', 'image', 'text', 'shape'];
/* The whole canvas is rendered before cropping, so cap how far it scales. */
const FF_PX_MAX_RENDER = 8192;

function ffPxOpenings() {
  return doc.layers.filter(l => l.type === 'frame' && l.visible !== false && l.points && l.points.length >= 3);
}

function ffPxCanvasToBlob(c) {
  return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}

/**
 * Build the export for one opening at one quality. Pure Studio reads, no
 * downloads; the dialog calls it again whenever the opening or quality
 * changes.
 */
async function ffPxBuild(opts) {
  const o = opts || {};
  const openings = ffPxOpenings();
  if (!openings.length) return { error: 'no-opening', openings };
  const frame = openings.find(f => f.id === o.frameId) || openings[0];
  const quality = FF_PIXOPIK_QUALITY.indexOf(o.quality) > -1 ? o.quality : 1600;

  const art1 = exportCanvas({ scale: 1, only: FF_PX_ART, bg: false });
  const data = art1.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, art1.width, art1.height).data;
  const artBox = ffPxAlphaBounds(data, art1.width, art1.height);
  const alphaMap = makeOverlayAlphaMap(art1);
  const bled = openingWithBleed(frame.points, ffOpeningBleed, alphaMap);

  const box = ffPxUnionBox([artBox, bbox(bled)], doc.canvas.w, doc.canvas.h);
  if (!box) return { error: 'empty', openings, frame };

  const fit = ffPxFitPoints(ffPxToUnit(bled, box));
  const aspect = +(box.w / box.h).toFixed(4);

  let png = null, W = 0, H = 0, scale = 0, capped = false;
  if (artBox) {
    scale = quality / Math.max(box.w, box.h);
    const most = FF_PX_MAX_RENDER / Math.max(doc.canvas.w, doc.canvas.h);
    if (scale > most) { scale = most; capped = true; }
    const big = exportCanvas({ scale, only: FF_PX_ART, bg: false });
    W = Math.max(1, Math.round(box.w * scale));
    H = Math.max(1, Math.round(box.h * scale));
    png = document.createElement('canvas');
    png.width = W; png.height = H;
    png.getContext('2d').drawImage(big, box.x * scale, box.y * scale, box.w * scale, box.h * scale, 0, 0, W, H);
  }
  const blob = png ? await ffPxCanvasToBlob(png) : null;

  return {
    openings, frame, quality, box, aspect, fit, png, blob, W, H, capped,
    hasArt: !!artBox,
    openingShare: ffPxArea(fit.ints) / (FF_PX_UNITS * FF_PX_UNITS)
  };
}

/* What the dialog shows under the preview. `level` is ok, warn or err; any
   err keeps Export disabled. */
function ffPxChecks(built, form) {
  const out = [];
  const add = (level, text) => out.push({ level, text });

  if (!form.label) add('err', 'Give the frame a name.');
  if (!ffPxValidId(form.id)) add('err', 'ID: lowercase letters, numbers and single dashes only.');
  else if (ffPxBuiltinClash(form.id)) add('err', '\u201c' + form.id + '\u201d is already a built-in Pixopik frame. Pick another name.');

  if (!built || built.error === 'no-opening') {
    add('err', 'No opening yet. ' + (window.ffStudioMode === 'generate'
      ? 'Pick a style on the left to draw a frame.' : 'Click inside the opening of your frame (step 2), or draw one.'));
    return out;
  }
  if (built.error) { add('err', 'Nothing to export: the canvas is empty.'); return out; }

  const f = built.fit;
  if (!f.valid) add('err', 'The opening could not be made into a valid Pixopik path.');
  else add('ok', f.ints.length + ' points (max ' + FF_PX_MAX_POINTS + ')' +
    (f.source > f.ints.length ? ', simplified from ' + f.source : ''));
  if (f.valid) add('ok', 'Opening path valid (' + f.clip.length + ' characters)');

  if (built.hasArt) {
    const kb = built.blob ? Math.round(built.blob.size / 1024) : 0;
    add(kb > 1500 ? 'warn' : 'ok', 'Overlay ' + built.W + ' \u00d7 ' + built.H + ' px, ' + kb + ' KB' +
      (kb > 1500 ? ' \u2014 large, try a lower quality' : ''));
    if (built.capped) add('warn', 'The canvas is too large to render at the chosen quality; exported smaller.');
  } else {
    add('warn', 'No artwork: exported as a plain cut-out frame, with no PNG.');
  }
  add('ok', 'Aspect ' + built.aspect + (built.aspect === 1 ? ' (square)' : built.aspect < 1 ? ' (portrait)' : ' (landscape)'));

  if (built.openingShare < 0.04) add('warn', 'The opening is very small for this artwork. Is the right opening selected?');
  if (built.openings.length > 1) add('warn', built.openings.length + ' openings in this design. A Pixopik frame holds one, the others stay see-through.');
  return out;
}

/* Pixopik's empty-frame placeholder (sky and hills), so the preview looks
   the way the frame will in Elements -> Frames. */
function ffPxDrawPlaceholder(x, w, h) {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#bcd9ef'); g.addColorStop(1, '#e6f1f8');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const s = Math.max(w, h) / 200, ox = (w - 200 * s) / 2, oy = (h - 200 * s) / 2;
  x.save(); x.translate(ox, oy); x.scale(s, s);
  x.fillStyle = '#fff'; x.fill(new Path2D('M62 70a17 17 0 0 1 31-12 21 21 0 0 1 38 4 14 14 0 0 1 4 27H67a12 12 0 0 1-5-19Z'));
  x.fillStyle = '#9cbf4b'; x.fill(new Path2D('M0 150c40-14 85-16 130-6s55 12 70 8v48H0Z'));
  x.fillStyle = '#5a7d1c'; x.fill(new Path2D('M0 200v-26c45-26 105-30 200-18v44Z'));
  x.restore();
}

function ffPxDrawPreview(c, built) {
  const S = 480;
  const aspect = built && !built.error ? built.aspect : 1;
  c.width = aspect >= 1 ? S : Math.round(S * aspect);
  c.height = aspect >= 1 ? Math.round(S / aspect) : S;
  c.style.width = Math.round(c.width / 2) + 'px';
  c.style.height = Math.round(c.height / 2) + 'px';
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  if (!built || built.error || !built.fit.valid) return;
  const ints = built.fit.ints;
  x.save();
  x.beginPath();
  ints.forEach((p, i) => {
    const px = p[0] / FF_PX_UNITS * c.width, py = p[1] / FF_PX_UNITS * c.height;
    if (i) x.lineTo(px, py); else x.moveTo(px, py);
  });
  x.closePath();
  x.clip();
  ffPxDrawPlaceholder(x, c.width, c.height);
  x.restore();
  if (built.png) x.drawImage(built.png, 0, 0, c.width, c.height);
}

/* Sensible starting values from what is on the canvas. */
function ffPxDefaults() {
  const gen = window.ffStudioMode === 'generate' && typeof ffGen === 'object';
  let label = '';
  let keywords = '';
  if (gen) {
    const d = ffGen.designId === 'custom' ? null : ffFrameDesign(ffGen.designId);
    const style = d ? d.label.replace(/\s*\(.*\)\s*/, '') : (ffGen.swatchName || 'Custom');
    label = style + ' ' + ffRatioFamilyLabel(ffGen.ratioId, ffGen.orientation) + ' frame';
    keywords = (style + ' moulding picture frame').toLowerCase();
  } else {
    const ov = doc.layers.find(l => l.type === 'overlay' && l.visible !== false);
    label = ov ? String(ov.name || '').replace(/\s*(overlay|mockup)\s*$/i, '').replace(/[-_]+/g, ' ').trim() : '';
    label = label ? label.charAt(0).toUpperCase() + label.slice(1) : 'My frame';
  }
  // a design the creator has named is exported under that name
  if (doc.name && doc.name !== 'Untitled frame') label = doc.name;
  let group = gen ? 'photo' : 'wedding';
  try { group = localStorage.getItem('frameforge.pixopik.group') || group; } catch (e) { /* storage blocked */ }
  if (!FF_PIXOPIK_GROUPS.some(g => g[0] === group)) group = 'wedding';
  return { label: label.slice(0, 40), keywords, group };
}

/* ---------------------------------------------------------------------
   Dialog
   --------------------------------------------------------------------- */
let _ffPxOpen = false;

async function ffPxOpenDialog() {
  if (_ffPxOpen) return;
  if (_wandOn) wandMode(false);
  _ffPxOpen = true;

  const d0 = ffPxDefaults();
  const openings = ffPxOpenings();
  // largest opening first, the same default detection uses
  const ranked = openings.slice().sort((a, b) => _ffPxBoxArea(b) - _ffPxBoxArea(a));

  const back = document.createElement('div');
  back.className = 'pxback';
  back.id = 'pixopikDialog';
  const card = document.createElement('form');
  card.className = 'pxcard';
  card.noValidate = true;
  card.innerHTML = `
    <h3>Export for Pixopik</h3>
    <div class="sub">An overlay PNG and a ready-to-paste entry for Pixopik's frame library. The canvas is cropped for you.</div>
    <div class="pxgrid">
      <div class="pxform">
        <div class="field"><label for="pxName">Name</label><input class="inp" id="pxName" maxlength="40" autocomplete="off"></div>
        <div class="field"><label for="pxId">ID <span class="val">(file name, made from the name)</span></label><input class="inp pxid" id="pxId" maxlength="48" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="pxGroup">Group</label><select class="inp" id="pxGroup"></select></div>
        <div class="field"><label for="pxKeywords">Keywords <span class="val">(for frame search)</span></label><input class="inp" id="pxKeywords" maxlength="120" autocomplete="off" placeholder="crayon kids hearts stars"></div>
        <div class="field" id="pxOpeningField"><label for="pxOpening">Opening</label><select class="inp" id="pxOpening"></select></div>
        <div class="field"><label for="pxQuality">Quality <span class="val">(longest side of the overlay)</span></label><select class="inp" id="pxQuality"></select></div>
      </div>
      <div>
        <div class="pxprev"><canvas id="pxPreview" width="480" height="480"></canvas></div>
        <div class="pxcap">How it looks in Pixopik</div>
        <ul class="pxchecks" id="pxChecks"></ul>
      </div>
    </div>
    <div class="pxacts">
      <span class="grow" id="pxStatus"></span>
      <button type="button" class="btn" id="pxCancel">Cancel</button>
      <button type="button" class="btn" id="pxCopy" title="Copy the frame entry to the clipboard">Copy entry</button>
      <button type="submit" class="btn primary" id="pxExport">Export</button>
    </div>`;
  back.appendChild(card);
  document.body.appendChild(back);

  const q = (s) => card.querySelector(s);
  const name = q('#pxName'), id = q('#pxId'), group = q('#pxGroup'), kw = q('#pxKeywords');
  const opening = q('#pxOpening'), quality = q('#pxQuality');

  FF_PIXOPIK_GROUPS.forEach(g => {
    const o = document.createElement('option'); o.value = g[0]; o.textContent = g[1]; group.appendChild(o);
  });
  ranked.forEach((f, i) => {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = (f.name || 'Opening') + (i === 0 && ranked.length > 1 ? ' (largest)' : '');
    opening.appendChild(o);
  });
  if (!ranked.length) {
    const o = document.createElement('option'); o.value = ''; o.textContent = 'No opening yet'; opening.appendChild(o);
  }
  if (ranked.length <= 1) q('#pxOpeningField').style.display = ranked.length ? 'none' : '';
  FF_PIXOPIK_QUALITY.forEach(v => {
    const o = document.createElement('option'); o.value = String(v); o.textContent = v + ' px' + (v === 1600 ? ' (recommended)' : ''); quality.appendChild(o);
  });

  name.value = d0.label;
  id.value = ffPxSlug(d0.label);
  group.value = d0.group;
  kw.value = d0.keywords;
  quality.value = '1600';
  // ID follows the name until the creator edits it by hand
  let idTouched = false;

  let built = null, seq = 0;
  const form = () => ({
    label: name.value.trim(),
    id: id.value.trim(),
    group: group.value,
    groupLabel: (FF_PIXOPIK_GROUPS.find(g => g[0] === group.value) || [0, group.value])[1],
    keywords: kw.value.trim().replace(/\s+/g, ' ')
  });
  const entryOf = () => {
    const f = form();
    return Object.assign(f, { aspect: built.aspect, ints: built.fit.ints, overlay: built.hasArt });
  };

  const paintChecks = () => {
    const list = ffPxChecks(built, form());
    const ul = q('#pxChecks');
    ul.textContent = '';
    list.forEach(c => {
      const li = document.createElement('li');
      li.className = c.level;
      const i = document.createElement('i');
      i.textContent = c.level === 'ok' ? '\u2713' : c.level === 'warn' ? '!' : '\u2715';
      li.appendChild(i);
      li.appendChild(document.createTextNode(c.text));
      ul.appendChild(li);
    });
    const blocked = list.some(c => c.level === 'err');
    q('#pxExport').disabled = blocked;
    q('#pxCopy').disabled = blocked;
    return !blocked;
  };

  const rebuild = async () => {
    const mine = ++seq;
    q('#pxStatus').textContent = 'Rendering\u2026';
    q('#pxExport').disabled = true;
    let next = null;
    try {
      next = await ffPxBuild({ frameId: opening.value, quality: +quality.value });
    } catch (e) {
      next = { error: 'failed', openings: ranked };
      console.warn('Export for Pixopik failed to render', e);
    }
    if (mine !== seq || !back.isConnected) return;
    built = next;
    ffPxDrawPreview(q('#pxPreview'), built);
    q('#pxStatus').textContent = '';
    paintChecks();
  };

  name.addEventListener('input', () => { if (!idTouched) id.value = ffPxSlug(name.value); paintChecks(); });
  id.addEventListener('input', () => { idTouched = true; paintChecks(); });
  id.addEventListener('blur', () => { id.value = ffPxSlug(id.value); paintChecks(); });
  kw.addEventListener('input', paintChecks);
  group.addEventListener('change', paintChecks);
  opening.addEventListener('change', rebuild);
  quality.addEventListener('change', rebuild);

  const close = () => {
    seq++;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    _ffPxOpen = false;
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  q('#pxCancel').onclick = close;

  q('#pxCopy').onclick = async () => {
    if (!built || built.error || !paintChecks()) return;
    const text = ffPxEntry(entryOf());
    try { await navigator.clipboard.writeText(text); toast('Frame entry copied \u00b7 paste it into CUSTOM_FRAMES'); }
    catch (e) { toast('Clipboard is blocked here \u00b7 use Export to download the entry'); }
  };

  card.onsubmit = (e) => {
    e.preventDefault();
    if (!built || built.error || !paintChecks()) return;
    const o = entryOf();
    try { localStorage.setItem('frameforge.pixopik.group', o.group); } catch (err) { /* storage blocked */ }
    if (built.blob) download(built.blob, o.id + '.png');
    download(new Blob([ffPxFileText(o)], { type: 'text/plain' }), o.id + '.frame.txt');
    close();
    toast(built.blob
      ? 'Exported ' + o.id + '.png + ' + o.id + '.frame.txt \u00b7 copy the PNG to public/frames/ and paste the entry'
      : 'Exported ' + o.id + '.frame.txt \u00b7 paste the entry into CUSTOM_FRAMES');
  };

  setTimeout(() => { name.focus(); name.select(); }, 0);
  await rebuild();
}

function _ffPxBoxArea(f) {
  const b = bbox(f.points);
  return b.w * b.h;
}

if ($('#btnExportPixopik')) $('#btnExportPixopik').onclick = ffPxOpenDialog;

window.ffPxOpenDialog = ffPxOpenDialog;
window.ffPxBuild = ffPxBuild;
