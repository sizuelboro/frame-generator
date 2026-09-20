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
  // grain runs down the swatch, i.e. along the bar once it is laid out
  for (let y = 0; y < c.height; y++) {
    const g = Math.sin(y * 0.30) * 0.5 + Math.sin(y * 0.071 + 1.3) * 0.35 + Math.sin(y * 0.013) * 0.15;
    x.fillStyle = 'rgba(0,0,0,' + Math.max(0, -g * 0.10).toFixed(3) + ')';
    x.fillRect(0, y, c.width, 1);
    x.fillStyle = 'rgba(255,238,214,' + Math.max(0, g * 0.09).toFixed(3) + ')';
    x.fillRect(0, y, c.width, 1);
  }
  return c;
}

const FF_FRAME_DESIGNS = [
  { id: 'white',  label: 'White',       build: () => ffSwatchFlat('#FBFAF8') },
  { id: 'black',  label: 'Black',       build: () => ffSwatchFlat('#232323') },
  { id: 'gold',   label: 'Gold',        build: ffSwatchGold },
  { id: 'oak',    label: 'Oak',         build: () => ffSwatchWood('#B98A55') },
  { id: 'walnut', label: 'Walnut',      build: () => ffSwatchWood('#6F4525') },
  { id: 'natural',label: 'Natural wood',build: () => ffSwatchWood('#96603A') }
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
function ffBuildBar(swatch, length, thick, flip) {
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
  g.addColorStop(0.00, 'rgba(0,0,0,0.34)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.26)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.72, 'rgba(0,0,0,0.12)');
  g.addColorStop(1.00, 'rgba(0,0,0,0.42)');
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
function ffBuildMitredFrame(swatch, W, H, border) {
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

  const hBar = ffBuildBar(swatch, W, b, false);
  const hBarFlip = ffBuildBar(swatch, W, b, true);
  const vBar = ffBuildBar(swatch, H, b, false);
  const vBarFlip = ffBuildBar(swatch, H, b, true);

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

  // crisp lip against the opening, and a soft outer edge
  x.strokeStyle = 'rgba(0,0,0,0.38)';
  x.lineWidth = 1;
  x.strokeRect(b - 0.5, b - 0.5, W - b * 2 + 1, H - b * 2 + 1);
  x.strokeStyle = 'rgba(0,0,0,0.22)';
  x.strokeRect(0.5, 0.5, W - 1, H - 1);

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
  const borderPct = typeof o.borderPct === 'number' ? o.borderPct : 7.5;

  const design = o.swatch ? null : ffFrameDesign(o.designId || 'white');
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

  const built = ffBuildMitredFrame(swatch, W, H, b);
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
    toast(res.overlayName + ' added \u00b7 ' + res.border + 'px moulding \u00b7 opening is in register, no need to Pick opening');
  };
}

window.FF_FRAME_DESIGNS = FF_FRAME_DESIGNS;
