'use strict';
/* =========================================================================
   FrameForge Studio - 18-frame-designs.js
   built-in frame designs, generated from a flat swatch
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.

   Why generate instead of shipping frame PNGs
   -------------------------------------------
   A finished frame PNG only fits the ratio it was drawn at. Stretching a
   2:3 frame to 1:1 squashes its corners and the result reads as fake
   immediately. A real frame is four lengths of moulding cut at 45 degrees,
   so that is what this builds: the swatch supplies nothing but colour and
   material, and the geometry is rebuilt from scratch for every ratio.
   Nothing is ever stretched, and any flat image can be a design.

   The output is an ordinary locked `overlay` layer - byte for byte the
   same shape as one the creator uploads by hand - so every downstream
   feature (Pick opening, Export for AI, Bulk 100, Publish) keeps working
   with no changes.
   ========================================================================= */

const FF_FRAME_SWATCH_SIZE = 256;

/* ---------------------------------------------------------------------
   Built-in swatches. These are flat material samples, NOT frame shapes.
   Each returns a square canvas; the grain of a directional material must
   run down the canvas so it ends up running along the length of the bar.
   --------------------------------------------------------------------- */
function _ffSwatchCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = FF_FRAME_SWATCH_SIZE;
  return c;
}

function ffSwatchFlat(hex) {
  const c = _ffSwatchCanvas(), x = c.getContext('2d');
  x.fillStyle = hex;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function ffSwatchGold() {
  const c = _ffSwatchCanvas(), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, c.width, 0);
  g.addColorStop(0.00, '#6E4E12');
  g.addColorStop(0.28, '#C9A03C');
  g.addColorStop(0.44, '#F4DC92');
  g.addColorStop(0.62, '#C9992F');
  g.addColorStop(1.00, '#7A5716');
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function ffSwatchWood(base) {
  const c = _ffSwatchCanvas(), x = c.getContext('2d');
  x.fillStyle = base || '#96603A';
  x.fillRect(0, 0, c.width, c.height);
  // NOTE: ffBuildBar maps the swatch's x axis ACROSS the thickness of the bar
  // and its y axis ALONG the length, so a filled row like the ones below is a
  // line across the bar, not along it. Probing a swatch with a single black
  // row confirms it, and this swatch measures a lightness SD of 4.8 along the
  // length against 0.0 across the thickness. So this is cross-grain banding,
  // not long grain. Kept as-is because Oak, Walnut and Natural wood ship on
  // it; ffSwatchTimber below is the one that runs the grain the right way.
  for (let y = 0; y < c.height; y++) {
    const g = Math.sin(y * 0.30) * 0.5 + Math.sin(y * 0.071 + 1.3) * 0.35 + Math.sin(y * 0.013) * 0.15;
    x.fillStyle = 'rgba(0,0,0,' + Math.max(0, -g * 0.10).toFixed(3) + ')';
    x.fillRect(0, y, c.width, 1);
    x.fillStyle = 'rgba(255,238,214,' + Math.max(0, g * 0.09).toFixed(3) + ')';
    x.fillRect(0, y, c.width, 1);
  }
  return c;
}

function ffSwatchMaple(base) {
  // Maple is tight, low-contrast grain. Oak's grain is tuned for a 23px face;
  // on a slim face those same sine waves smear into blotches, so keep the
  // variation fine and faint and the face reads as one flat plane.
  const c = _ffSwatchCanvas(), x = c.getContext('2d');
  x.fillStyle = base || '#E3C89B';
  x.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    const g = Math.sin(y * 0.90) * 0.5 + Math.sin(y * 0.21 + 0.7) * 0.35 + Math.sin(y * 0.031) * 0.15;
    x.fillStyle = 'rgba(74,48,24,' + Math.max(0, -g * 0.035).toFixed(3) + ')';
    x.fillRect(0, y, c.width, 1);
    x.fillStyle = 'rgba(255,245,228,' + Math.max(0, g * 0.045).toFixed(3) + ')';
    x.fillRect(0, y, c.width, 1);
  }
  return c;
}

function ffSwatchTimber(opts) {
  // Real long grain: continuous lines running down the length of the
  // moulding. Because the swatch's x axis is what ends up crossing the
  // thickness, the grain has to be drawn as vertical bands here, which is the
  // opposite of ffSwatchWood above.
  //
  // That x axis is also squeezed from 256 into the thickness of the bar, so
  // roughly 18:1 on a slim frame. Bands therefore have to be wide in swatch
  // space or the downscale averages them away. The y axis is close to 1:1
  // with the length, so detail along the bar survives and each band is given
  // a slow wander rather than being ruler straight.
  const o = opts || {};
  const base = o.base || '#B08A52';
  const lines = o.lines || 7;
  const strength = (o.strength === undefined ? 1 : o.strength);
  // How strongly the length of the bar drifts in lightness. A photographed
  // board varies far more along its length than the default here suggests,
  // so a design can dial this up; 1 keeps the original look.
  const washMul = (o.wash === undefined ? 1 : o.wash);

  // Seeded, so a published frame PNG is reproducible rather than different on
  // every render.
  let sd = (o.seed || 7) >>> 0;
  const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);

  const c = _ffSwatchCanvas(), x = c.getContext('2d'), N = c.width;
  x.fillStyle = base;
  x.fillRect(0, 0, N, N);
  const img = x.getImageData(0, 0, N, N), d = img.data;

  const band = [];
  for (let i = 0; i < lines; i++) {
    // timber is a few crisp dark lines among broad faint ones, never a row of
    // evenly spaced stripes
    const crisp = (i % 3 === 0);
    band.push({
      pos: ((i + 0.5) / lines + (rnd() - 0.5) * 0.75 / lines) * N,
      half: (crisp ? (0.10 + rnd() * 0.14) : (0.45 + rnd() * 0.60)) / lines * N,
      dark: (crisp ? (0.26 + rnd() * 0.16) : (0.06 + rnd() * 0.09)),
      amp: 4 + rnd() * 18,
      freq: 0.004 + rnd() * 0.012,
      phase: rnd() * 6.283
    });
  }

  const washPh = rnd() * 6.283;
  for (let y = 0; y < N; y++) {
    const wash = (Math.sin(y * 0.011 + washPh) * 0.020 + Math.sin(y * 0.0032 + washPh * 2) * 0.014) * washMul;
    for (let i = 0; i < lines; i++) {
      const b = band[i];
      const cx = b.pos + Math.sin(y * b.freq + b.phase) * b.amp;
      const from = Math.max(0, Math.floor(cx - b.half));
      const to = Math.min(N - 1, Math.ceil(cx + b.half));
      for (let px = from; px <= to; px++) {
        const t = 1 - Math.abs(px - cx) / b.half;
        if (t <= 0) continue;
        const a = b.dark * t * t * strength;   // squared, for a tighter core
        const k = (y * N + px) * 4;
        d[k] = d[k] * (1 - a) + 58 * a;
        d[k + 1] = d[k + 1] * (1 - a) + 34 * a;
        d[k + 2] = d[k + 2] * (1 - a) + 14 * a;
      }
    }
    if (wash !== 0) {
      // slow lightness wash, so the length of the bar is not one flat tone
      const a = Math.min(0.6, Math.abs(wash) * strength);
      const wr = wash > 0 ? 255 : 40, wg = wash > 0 ? 244 : 24, wb = wash > 0 ? 226 : 8;
      for (let px = 0; px < N; px++) {
        const k = (y * N + px) * 4;
        d[k] = d[k] * (1 - a) + wr * a;
        d[k + 1] = d[k + 1] * (1 - a) + wg * a;
        d[k + 2] = d[k + 2] * (1 - a) + wb * a;
      }
    }
  }

  x.putImageData(img, 0, 0);
  return c;
}

/* ---------------------------------------------------------------------
   Bevel profiles, measured across the thickness of the bar: stop 0 is the
   outer edge of the frame, stop 1 the lip against the opening.

   CLASSIC is the original profile and suits a wide ornate moulding: it
   sweeps roughly 97 levels of lightness, so the face reads as rounded.
   A slim modern frame does the opposite. Sampling the left bar of two
   reference photographs gives a face that is flat within about 12 levels,
   with both edges catching light rather than going dark - so FLAT keeps
   the face even and lifts the edges instead of shading them.
   --------------------------------------------------------------------- */
const FF_BEVEL_CLASSIC = [
  [0.00, 'rgba(0,0,0,0.34)'],
  [0.16, 'rgba(255,255,255,0.26)'],
  [0.42, 'rgba(255,255,255,0.10)'],
  [0.72, 'rgba(0,0,0,0.12)'],
  [1.00, 'rgba(0,0,0,0.42)']
];
const FF_BEVEL_FLAT = [
  [0.00, 'rgba(255,255,255,0.30)'],
  [0.10, 'rgba(0,0,0,0.05)'],
  [0.55, 'rgba(255,255,255,0.03)'],
  [0.86, 'rgba(0,0,0,0.06)'],
  [0.94, 'rgba(255,255,255,0.10)'],
  [1.00, 'rgba(255,255,255,0.34)']
];
// Between the two: enough shading to read as a solid bar of wood with real
// depth, without the rounded ornate sweep of CLASSIC.
const FF_BEVEL_SOFT = [
  [0.00, 'rgba(0,0,0,0.15)'],
  [0.12, 'rgba(255,255,255,0.13)'],
  [0.50, 'rgba(255,255,255,0.03)'],
  [0.80, 'rgba(0,0,0,0.04)'],
  [1.00, 'rgba(0,0,0,0.17)']
];
// Fitted to the reference frame PNG rather than chosen by eye: across its
// 47px bar the face spans 32 levels of lightness, so this is a touch flatter
// again than SOFT.
const FF_BEVEL_TIMBER = [
  [0.00, 'rgba(0,0,0,0.12)'],
  [0.12, 'rgba(255,255,255,0.11)'],
  [0.50, 'rgba(255,255,255,0.03)'],
  [0.80, 'rgba(0,0,0,0.03)'],
  [1.00, 'rgba(0,0,0,0.13)']
];

const FF_FRAME_DESIGNS = [
  { id: 'white',  label: 'White',       build: () => ffSwatchFlat('#FBFAF8') },
  { id: 'black',  label: 'Black',       build: () => ffSwatchFlat('#232323') },
  { id: 'gold',   label: 'Gold',        build: ffSwatchGold },
  { id: 'oak',    label: 'Oak',         build: () => ffSwatchWood('#B98A55') },
  { id: 'walnut', label: 'Walnut',      build: () => ffSwatchWood('#6F4525') },
  { id: 'natural',label: 'Natural wood',build: () => ffSwatchWood('#96603A') },
  {
    id: 'maple', label: 'Maple (slim)',
    // measured off the reference photographs: moulding is ~3.4% of the opening
    borderPct: 3.2,
    bevel: FF_BEVEL_FLAT,
    lipInner: 'rgba(255,255,255,0.55)',
    lipOuter: 'rgba(0,0,0,0.10)',
    build: () => ffSwatchMaple('#E3C89B')
  },
  {
    id: 'timber-oak', label: 'Solid oak',
    // a solid timber moulding is chunky; it also needs the width, because the
    // grain has nowhere to show on a slim face
    borderPct: 7.0,
    bevel: FF_BEVEL_SOFT,
    lipInner: 'rgba(0,0,0,0.25)',
    lipOuter: 'rgba(0,0,0,0.18)',
    build: () => ffSwatchTimber({ base: '#B08A52' })
  },
  {
    id: 'oak-natural', label: 'Natural oak',
    // Every number here is fitted to a reference frame PNG rather than
    // picked by eye. Measured on its 47px bar: opening border 6.48%, face
    // #DCBC9A at lightness 187, 30% saturation, spanning 32 levels, with a
    // lightness SD of 7.3 across the thickness and 5.3 along the length.
    // This design renders 184 / 30.3% / 35 / 8.0 / 5.3 against that.
    borderPct: 6.5,
    bevel: FF_BEVEL_TIMBER,
    lipInner: 'rgba(0,0,0,0.25)',
    lipOuter: 'rgba(0,0,0,0.18)',
    build: () => ffSwatchTimber({ base: '#DEBE9C', lines: 10, strength: 0.75, wash: 5.5 })
  }
];

function ffFrameDesign(id) {
  for (let i = 0; i < FF_FRAME_DESIGNS.length; i++) if (FF_FRAME_DESIGNS[i].id === id) return FF_FRAME_DESIGNS[i];
  return null;
}

/* Custom swatches the creator drops in. Any flat image works. */
let ffCustomSwatch = null;

/* ---------------------------------------------------------------------
   One length of moulding: the swatch tiled along the bar, with bevel
   shading across its thickness so it reads as a raised profile rather
   than a flat sticker.
   --------------------------------------------------------------------- */
function ffBuildBar(swatch, length, thick, flip, bevel) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(length));
  c.height = Math.max(1, Math.round(thick));
  const x = c.getContext('2d');

  // swatch stretched across the thickness, run along the length
  x.save();
  x.translate(c.width / 2, c.height / 2);
  x.rotate(-Math.PI / 2);
  // after the quarter turn the swatch's own height runs along the bar
  x.drawImage(swatch, -c.height / 2, -c.width / 2, c.height, c.width);
  x.restore();

  // bevel across the thickness
  const g = x.createLinearGradient(0, 0, 0, c.height);
  (bevel || FF_BEVEL_CLASSIC).forEach(s => g.addColorStop(s[0], s[1]));
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);

  if (flip) {
    const f = document.createElement('canvas');
    f.width = c.width; f.height = c.height;
    const fx = f.getContext('2d');
    fx.translate(0, c.height);
    fx.scale(1, -1);
    fx.drawImage(c, 0, 0);
    return f;
  }
  return c;
}

/* ---------------------------------------------------------------------
   The frame itself. Four bars, clipped to trapezoids so the corners meet
   at a true 45 degree mitre. The opening is left fully transparent.
   --------------------------------------------------------------------- */
function ffBuildMitredFrame(swatch, W, H, border, opts) {
  const o = opts || {};
  const bevel = o.bevel;
  const lipInner = o.lipInner !== undefined ? o.lipInner : 'rgba(0,0,0,0.38)';
  const lipOuter = o.lipOuter !== undefined ? o.lipOuter : 'rgba(0,0,0,0.22)';

  W = Math.max(8, Math.round(W));
  H = Math.max(8, Math.round(H));
  const b = Math.max(2, Math.min(Math.round(border), Math.floor(Math.min(W, H) / 2) - 1));

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  const clip = (pts) => {
    x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
    x.closePath();
    x.clip();
  };

  const hBar = ffBuildBar(swatch, W, b, false, bevel);
  const hBarFlip = ffBuildBar(swatch, W, b, true, bevel);
  const vBar = ffBuildBar(swatch, H, b, false, bevel);
  const vBarFlip = ffBuildBar(swatch, H, b, true, bevel);

  // top
  x.save(); clip([[0, 0], [W, 0], [W - b, b], [b, b]]);
  x.drawImage(hBar, 0, 0); x.restore();

  // bottom
  x.save(); clip([[0, H], [W, H], [W - b, H - b], [b, H - b]]);
  x.drawImage(hBarFlip, 0, H - b); x.restore();

  // left
  x.save(); clip([[0, 0], [b, b], [b, H - b], [0, H]]);
  x.translate(0, H); x.rotate(-Math.PI / 2);
  x.drawImage(vBar, 0, 0); x.restore();

  // right
  x.save(); clip([[W, 0], [W - b, b], [W - b, H - b], [W, H]]);
  x.translate(W, 0); x.rotate(Math.PI / 2);
  x.drawImage(vBarFlip, 0, 0); x.restore();

  // Lip against the opening, and the outer edge. A wide moulding wants both
  // dark; on the reference photographs the lip is the brightest pixel on the
  // frame, because the rabbet edge catches the light. Either can be null.
  x.lineWidth = 1;
  if (lipInner) {
    x.strokeStyle = lipInner;
    x.strokeRect(b - 0.5, b - 0.5, W - b * 2 + 1, H - b * 2 + 1);
  }
  if (lipOuter) {
    x.strokeStyle = lipOuter;
    x.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  return { canvas: c, border: b, opening: { x: b, y: b, w: W - b * 2, h: H - b * 2 } };
}

/* ---------------------------------------------------------------------
   Compose a design onto the document: a locked overlay plus the matching
   opening frame, already in register so "Pick opening" is not needed.
   --------------------------------------------------------------------- */
function ffApplyFrameDesign(opts) {
  const o = opts || {};
  const ratioId = o.ratioId || '2-3';
  const orientation = o.orientation === 'landscape' ? 'landscape' : 'portrait';
  const design = o.swatch ? null : ffFrameDesign(o.designId || 'white');
  // an explicit override wins, then the design's own width, then the default
  const borderPct = typeof o.borderPct === 'number' ? o.borderPct
    : (design && typeof design.borderPct === 'number' ? design.borderPct : 7.5);
  const swatch = o.swatch || (design ? design.build() : ffSwatchFlat('#FBFAF8'));
  if (!swatch) return null;

  // The RATIO IS THE OPENING, which is what a print size actually means.
  // The moulding is added outside it, so a 2:3 preset really does hold a
  // 2:3 print rather than a 2:3 outer frame.
  const openBox = ffRatioBox(ratioId, orientation, doc.canvas.w, doc.canvas.h, 0.62);
  if (!openBox) return null;
  const b = Math.max(3, Math.round(Math.min(openBox.w, openBox.h) * (borderPct / 100)));

  const W = openBox.w + b * 2;
  const H = openBox.h + b * 2;
  const ox = Math.round((doc.canvas.w - W) / 2);
  const oy = Math.round((doc.canvas.h - H) / 2);

  const built = ffBuildMitredFrame(swatch, W, H, b, design ? {
    bevel: design.bevel,
    lipInner: design.lipInner,
    lipOuter: design.lipOuter
  } : null);
  const src = built.canvas.toDataURL('image/png');

  const label = (design ? design.label : (o.swatchName || 'Custom')) + ' \u00b7 ' + ffRatioLabel(ratioId, orientation);

  addLayerTop({
    id: uid(), type: 'overlay', name: label + ' frame',
    visible: true, locked: true, opacity: 1,
    src, x: ox, y: oy, w: W, h: H, rotation: 0,
    frameDesignId: design ? design.id : 'custom',
    frameDesignBorder: b
  });

  const inner = {
    x: ox + built.opening.x,
    y: oy + built.opening.y,
    w: built.opening.w,
    h: built.opening.h
  };
  const F = newFrame('rect', inner.x, inner.y, inner.w, inner.h);
  F.name = 'Opening \u00b7 ' + ffRatioLabel(ratioId, orientation);
  F.ratioId = ratioId;
  F.ratioOrientation = orientation;
  F.ratioValue = +ffRatioValue(ratioId, orientation).toFixed(4);
  addLayerTop(F);

  // the overlay must sit above the opening so the moulding covers its edge
  const oi = doc.layers.findIndex(l => l.type === 'overlay' && l.name === label + ' frame');
  if (oi > -1) {
    const ov = doc.layers.splice(oi, 1)[0];
    doc.layers.push(ov);
  }
  sel = F.id;
  contentCache.clear();
  sync();

  return { overlayName: label + ' frame', frame: F, border: b, outer: { w: W, h: H } };
}

/* =========================================================================
   UI
   ========================================================================= */
function ffFillDesignSelect() {
  const sel = $('#frameDesign');
  if (!sel || sel.options.length) return;
  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'Frame design\u2026';
  sel.appendChild(first);
  FF_FRAME_DESIGNS.forEach(d => {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = d.label;
    sel.appendChild(o);
  });
  const cus = document.createElement('option');
  cus.value = '__custom__';
  cus.textContent = 'Upload swatch\u2026';
  sel.appendChild(cus);
}

ffFillDesignSelect();

if ($('#frameDesign')) {
  $('#frameDesign').onchange = async (ev) => {
    const id = ev.target.value;
    ev.target.value = '';
    if (!id) return;

    const ratioId = ffSelectedRatio;
    if (!ratioId) { toast('Pick a frame ratio first'); return; }
    const orientation = typeof ffRatioOrientation === 'string' ? ffRatioOrientation : 'portrait';

    let swatch = null, swatchName = '';
    if (id === '__custom__') {
      const f = await pickFile();
      if (!f) return;
      const img = new Image();
      img.src = f.src;
      try { await img.decode(); } catch (e) { toast('Could not read that swatch'); return; }
      swatch = img;
      swatchName = (f.name || 'Custom').replace(/\.[^.]+$/, '');
      ffCustomSwatch = img;
    }

    const res = ffApplyFrameDesign({
      ratioId, orientation,
      designId: id === '__custom__' ? null : id,
      swatch, swatchName
    });
    if (!res) { toast('Pick a frame ratio first'); return; }
    toast(res.overlayName + ' added \u00b7 ' + res.border + 'px moulding \u00b7 opening is in register, no need to Select design area');
  };
}

window.FF_FRAME_DESIGNS = FF_FRAME_DESIGNS;
