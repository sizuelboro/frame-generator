'use strict';
/* =========================================================================
   FrameForge Studio - 22-modes.js
   the two ways to make a frame, and the Generate panel
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.

   Why modes
   ---------
   The Studio makes a frame in one of two ways, and the toolbar used to show
   the buttons for both in one row:

     Generate    a moulding is drawn around an opening of a chosen shape
                 (17-ratio-presets.js + 18-frame-designs.js)
     From image  the creator uploads artwork and the opening is detected or
                 drawn (11-detect.js, 14-wand.js, 21-soft-bleed.js)

   Nothing said which button belonged to which way, so creators pressed
   "Add design area" and got a bare dashed box. The Studio now starts by
   asking which way, and the left panel shows only that mode's controls.
   Shared tools (decoration, layers, export) stay visible in both.

   A panel section opts into a mode with data-only="generate", "image" or
   both; <body data-mode> selects which are shown. Mode is a view, not a
   property of the document: switching never changes the canvas.
   ========================================================================= */

/* Opening shapes offered in Generate. Print-only presets (A-series, 5:7,
   11:14) stay in FF_RATIOS so older projects and the AI round trip still
   resolve them, but they are not offered here. */
const FF_GEN_SHAPES = ['1-1', '4-5', '3-4', '2-3', '9-16'];

/* What Generate draws, and which layers it drew last, so changing a setting
   redraws that frame instead of stacking a new one on top. */
const ffGen = {
  ratioId: '1-1',
  orientation: 'portrait',
  designId: 'white',
  swatch: null,        // an uploaded texture, when designId is 'custom'
  swatchName: '',
  borderPct: null,     // null: the design's own width
  overlayId: null,
  frameId: null
};

window.ffStudioMode = null;

/* The bundled demo (a laptop) is loaded at boot by 08-files.js. Choosing a
   mode replaces it with a clean canvas, but only while it is untouched. */
const _ffBootIds = doc.layers.map(l => l.id).join(',');
function ffIsBootDemo() {
  return doc.layers.length > 0 && doc.layers.map(l => l.id).join(',') === _ffBootIds;
}

function ffBlankDoc(w, h) {
  doc = { canvas: { w: w || 1200, h: h || 800, bg: '#FFFFFF' }, layers: [] };
  sel = null; contentEdit = null; contentCache.clear();
  ffGen.overlayId = ffGen.frameId = null;
  sizePill(); fit(); sync();
}

/* A document with a generated moulding reads as Generate work. */
function ffInferMode() {
  return doc.layers.some(l => l.type === 'overlay' && l.frameDesignId) ? 'generate' : 'image';
}

/* ---------------------------------------------------------------------
   Mode switching
   --------------------------------------------------------------------- */
function ffSetMode(mode) {
  const m = mode === 'generate' || mode === 'image' ? mode : null;
  window.ffStudioMode = m;
  document.body.dataset.mode = m || '';
  document.querySelectorAll('[data-mode-tab]').forEach(b =>
    b.setAttribute('aria-selected', b.dataset.modeTab === m ? 'true' : 'false'));
  if (_wandOn) wandMode(false);
  setTool('select');
  if (m === 'generate') { ffGenAdopt(); ffGenRenderPanel(); }
  ffSyncStage();
  refreshProps();
}

/* Picking a mode from the chooser or the toolbar. */
function ffChooseMode(mode) {
  if (ffIsBootDemo()) ffBlankDoc(mode === 'generate' ? 1000 : 1200, mode === 'generate' ? 1000 : 800);
  ffSetMode(mode);
  // Draw a first frame straight away on a clean canvas, so Generate never
  // opens on nothing. Existing work is left alone: switching is only a view.
  if (mode === 'generate' && !doc.layers.length) ffGenerate();
}

/* Chooser while no mode is picked; the upload card while From image has
   nothing on the canvas yet. */
function ffSyncStage() {
  const chooser = $('#modeChooser'), empty = $('#emptyState');
  const mode = window.ffStudioMode;
  if (chooser) chooser.classList.toggle('gone', !!mode);
  if (empty) empty.classList.toggle('gone', !(mode === 'image' && !doc.layers.length));
}

document.querySelectorAll('[data-choose]').forEach(b =>
  b.addEventListener('click', () => ffChooseMode(b.dataset.choose)));
document.querySelectorAll('[data-mode-tab]').forEach(b =>
  b.addEventListener('click', () => ffChooseMode(b.dataset.modeTab)));

/* Layers change through many paths (open project, saved mockup, detection).
   Keep the stage in step, and when a document arrives before a mode was
   picked, take the mode from what it contains. */
if ($('#layerList') && typeof MutationObserver === 'function') {
  new MutationObserver(() => {
    if (!window.ffStudioMode && doc.layers.length && !ffIsBootDemo()) ffSetMode(ffInferMode());
    else ffSyncStage();
  }).observe($('#layerList'), { childList: true });
}

/* An image dropped on the chooser means From image. This runs in the
   capture phase, before 08-files.js decides what the drop becomes, so a
   first drop on a clean canvas still lands as the frame artwork. */
document.addEventListener('drop', (ev) => {
  if (window.ffStudioMode) return;
  const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (!f || !/^image\//.test(f.type) || !$('#wrap') || !$('#wrap').contains(ev.target)) return;
  if (ffIsBootDemo()) ffBlankDoc(1200, 800);
  ffSetMode('image');
}, true);

/* File -> New also starts over at the chooser. Replaces the handler from
   10-dialogs.js, which only cleared the canvas. */
if ($('#btnNew')) {
  $('#btnNew').onclick = async () => {
    if (doc.layers.length && !ffIsBootDemo()) {
      const go = await uiConfirm('Start a new frame?', 'Unsaved work on this canvas will be lost.', 'Start new');
      if (!go) return;
    }
    ffBlankDoc(1200, 800);
    ffGen.swatch = null; ffGen.swatchName = ''; ffGen.borderPct = null;
    if (ffGen.designId === 'custom') ffGen.designId = 'white';
    ffSetMode(null);
    toast('New canvas \u00b7 choose how to make the frame');
  };
}

/* ---------------------------------------------------------------------
   Generate
   --------------------------------------------------------------------- */
function ffGenDesign() {
  return ffGen.designId === 'custom' ? null : ffFrameDesign(ffGen.designId);
}
function ffGenBorder() {
  if (typeof ffGen.borderPct === 'number') return ffGen.borderPct;
  const d = ffGenDesign();
  return d && typeof d.borderPct === 'number' ? d.borderPct : 7.5;
}

function ffGenLayers() {
  return {
    ov: doc.layers.find(l => l.id === ffGen.overlayId) || null,
    fr: doc.layers.find(l => l.id === ffGen.frameId) || null
  };
}

/* A project opened from disk carries no ids we drew, so pick its generated
   moulding back up instead of drawing a second one over it. */
function ffGenAdopt() {
  if (ffGenLayers().ov) return;
  const ov = doc.layers.find(l => l.type === 'overlay' && l.frameDesignId);
  if (!ov) { ffGen.overlayId = ffGen.frameId = null; return; }
  const fr = doc.layers.find(l => l.type === 'frame' && l.ratioId && inPoly(
    { x: ov.x + ov.w / 2, y: ov.y + ov.h / 2 }, l.points));
  ffGen.overlayId = ov.id;
  ffGen.frameId = fr ? fr.id : null;
  if (fr) {
    ffGen.ratioId = fr.ratioId;
    ffGen.orientation = fr.ratioOrientation === 'landscape' ? 'landscape' : 'portrait';
  }
  if (ffFrameDesign(ov.frameDesignId)) ffGen.designId = ov.frameDesignId;
  if (typeof ov.frameDesignBorderPct === 'number') ffGen.borderPct = ov.frameDesignBorderPct;
}

/* Draw the frame for the current settings, replacing the one drawn before.
   The preview photo in the opening and the layer's place in the stack are
   kept, so redrawing never undoes the creator's other work. */
function ffGenerate() {
  const old = ffGenLayers();
  const content = old.fr ? old.fr.content : null;
  let at = -1;
  if (old.ov || old.fr) {
    const idx = doc.layers.findIndex(l => l === old.fr || l === old.ov);
    doc.layers = doc.layers.filter(l => l !== old.fr && l !== old.ov);
    at = idx;
  }

  const custom = ffGen.designId === 'custom' && ffGen.swatch;
  const borderPct = ffGenBorder();
  const res = ffApplyFrameDesign({
    ratioId: ffGen.ratioId,
    orientation: ffGen.orientation,
    designId: custom ? null : ffGen.designId,
    swatch: custom ? ffGen.swatch : null,
    swatchName: ffGen.swatchName,
    borderPct
  });
  if (!res) return null;

  const ov = doc.layers[doc.layers.length - 1];
  const fr = res.frame;
  ov.frameDesignBorderPct = borderPct;
  if (content) fr.content = content;
  if (at > -1) {
    doc.layers = doc.layers.filter(l => l !== ov && l !== fr);
    doc.layers.splice(Math.min(at, doc.layers.length), 0, fr, ov);
  }
  ffGen.overlayId = ov.id;
  ffGen.frameId = fr.id;
  sel = null;
  contentCache.clear();
  sync();
  return res;
}

/* Style thumbnails are drawn once with the real frame builder, so the grid
   shows exactly what clicking a tile will draw. */
const _ffStyleThumbs = new Map();
function ffStyleThumb(key, swatch, design) {
  if (_ffStyleThumbs.has(key)) return _ffStyleThumbs.get(key);
  const pct = design && typeof design.borderPct === 'number' ? design.borderPct : 7.5;
  const S = 104;
  const b = Math.max(10, Math.round(S * pct / 100 * 1.7));
  const built = ffBuildMitredFrame(swatch, S, S, b, design ? {
    bevel: design.bevel, lipInner: design.lipInner, lipOuter: design.lipOuter
  } : null);
  const url = built.canvas.toDataURL('image/png');
  _ffStyleThumbs.set(key, url);
  return url;
}

function ffGenRenderPanel() {
  const shapes = $('#genShapes');
  if (shapes) {
    shapes.textContent = '';
    FF_GEN_SHAPES.forEach(id => {
      const b = document.createElement('button');
      b.className = 'chip' + (ffGen.ratioId === id ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', ffGen.ratioId === id ? 'true' : 'false');
      b.dataset.shape = id;
      b.textContent = ffRatioFamilyLabel(id, ffGen.orientation);
      b.onclick = () => { ffGen.ratioId = id; ffGenerate(); ffGenRenderPanel(); };
      shapes.appendChild(b);
    });
  }

  const orient = $('#genOrient');
  if (orient) {
    orient.textContent = (ffGen.orientation === 'landscape' ? 'Landscape' : 'Portrait') + ' \u21c5';
    orient.disabled = ffGen.ratioId === '1-1';
    orient.title = ffGen.ratioId === '1-1' ? 'A square reads the same either way' : 'Switch portrait / landscape';
  }

  const styles = $('#genStyles');
  if (styles) {
    styles.textContent = '';
    const tile = (key, label, src, on, onclick, upload) => {
      const b = document.createElement('button');
      b.className = 'style' + (on ? ' on' : '');
      b.setAttribute('role', upload ? 'button' : 'radio');
      if (!upload) b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.dataset.style = key;
      b.title = label;
      if (src) {
        const img = document.createElement('img');
        img.src = src; img.alt = '';
        b.appendChild(img);
      } else {
        const up = document.createElement('span');
        up.className = 'up'; up.textContent = '+';
        b.appendChild(up);
      }
      const t = document.createElement('span');
      t.textContent = label;
      b.appendChild(t);
      b.onclick = onclick;
      styles.appendChild(b);
    };
    FF_FRAME_DESIGNS.forEach(d => tile(d.id, d.label, ffStyleThumb(d.id, d.build(), d),
      ffGen.designId === d.id, () => ffGenPickStyle(d.id)));
    if (ffGen.swatch) {
      tile('custom', ffGen.swatchName || 'Your texture', ffStyleThumb('custom:' + ffGen.swatchName, ffGen.swatch, null),
        ffGen.designId === 'custom', () => ffGenPickStyle('custom'));
    }
    tile('upload', 'Upload texture', null, false, ffGenUploadTexture, true);
  }

  const range = $('#genBorder'), val = $('#genBorderVal');
  const pct = ffGenBorder();
  if (range) range.value = String(pct);
  if (val) val.textContent = (+pct.toFixed(1)) + '%';
}

/* Picking a style resets the border to that style's own width: a slim
   maple moulding and a chunky oak one are designed at different widths. */
function ffGenPickStyle(id) {
  ffGen.designId = id;
  ffGen.borderPct = null;
  ffGenerate();
  ffGenRenderPanel();
}

async function ffGenUploadTexture() {
  const f = await pickFile();
  if (!f) return;
  const img = new Image();
  img.src = f.src;
  try { await img.decode(); } catch (e) { toast('Could not read that image'); return; }
  ffGen.swatch = img;
  ffGen.swatchName = (f.name || 'Texture').replace(/\.[^.]+$/, '').slice(0, 24) || 'Texture';
  ffGenPickStyle('custom');
  toast('Texture applied \u00b7 any flat image works, the corners are mitred for you');
}

if ($('#genOrient')) {
  $('#genOrient').onclick = () => {
    ffGen.orientation = ffGen.orientation === 'portrait' ? 'landscape' : 'portrait';
    ffGenerate();
    ffGenRenderPanel();
  };
}
if ($('#genBorder')) {
  let pending = 0;
  $('#genBorder').addEventListener('input', (e) => {
    ffGen.borderPct = +e.target.value;
    if ($('#genBorderVal')) $('#genBorderVal').textContent = (+ffGen.borderPct.toFixed(1)) + '%';
    if (pending) return;
    // a timer rather than requestAnimationFrame, which never fires in a
    // background tab or a headless test run
    pending = setTimeout(() => { pending = 0; ffGenerate(); }, 16);
  });
}

ffSetMode(null);

window.ffChooseMode = ffChooseMode;
window.ffSetMode = ffSetMode;
window.ffGenerate = ffGenerate;
window.ffGen = ffGen;
