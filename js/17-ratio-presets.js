'use strict';
/* =========================================================================
   FrameForge Studio - 17-ratio-presets.js
   print-size ratio presets for the opening
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.

   Why this exists
   ---------------
   The Studio only ever knew pixels. A creator building an "A4 print"
   mockup had no way to say so, which meant nothing downstream could tell
   whether the opening that came back from the image model was still the
   right shape. Declaring the intended ratio up front fixes that: the
   ratio rides along in the scene sidecar and "Import AI scene" can check
   the returned opening against it.
   ========================================================================= */

/* Portrait ratios, expressed short-side : long-side. A-series is one entry
   on purpose - A5 through A1 are all 1:root(2), so the shape is identical
   and only the printed size differs. */
const FF_RATIOS = [
  { id: 'iso',   label: 'A-series',  w: 1,  h: 1.41421356, sizes: 'A5, A4, A3, A2, A1' },
  { id: '2-3',   label: '2:3',       w: 2,  h: 3,          sizes: '12\u00d718, 16\u00d724, 20\u00d730, 24\u00d736' },
  { id: '3-4',   label: '3:4',       w: 3,  h: 4,          sizes: '9\u00d712, 12\u00d716, 18\u00d724' },
  { id: '4-5',   label: '4:5',       w: 4,  h: 5,          sizes: '8\u00d710, 16\u00d720' },
  { id: '5-7',   label: '5:7',       w: 5,  h: 7,          sizes: '5\u00d77, 10\u00d714' },
  { id: '11-14', label: '11:14',     w: 11, h: 14,         sizes: '11\u00d714' },
  { id: '1-1',   label: '1:1',       w: 1,  h: 1,          sizes: 'Square prints' }
];

function ffRatio(id) {
  for (let i = 0; i < FF_RATIOS.length; i++) if (FF_RATIOS[i].id === id) return FF_RATIOS[i];
  return null;
}

/* width / height for the given preset. Portrait is the short side over the
   long side; landscape is its reciprocal. */
function ffRatioValue(id, orientation) {
  const r = ffRatio(id);
  if (!r) return null;
  const portrait = r.w / r.h;
  return orientation === 'landscape' ? 1 / portrait : portrait;
}

function ffRatioLabel(id, orientation) {
  const r = ffRatio(id);
  if (!r) return '';
  if (r.id === '1-1') return r.label;
  return r.label + (orientation === 'landscape' ? ' landscape' : ' portrait');
}

/* Largest box of the wanted ratio that fits inside boxW x boxH, scaled by
   `fill`. Returned centred on the canvas. */
function ffRatioBox(id, orientation, boxW, boxH, fill) {
  const ratio = ffRatioValue(id, orientation);
  if (!ratio) return null;
  const f = typeof fill === 'number' ? fill : 0.78;
  let w = boxW * f;
  let h = w / ratio;
  if (h > boxH * f) { h = boxH * f; w = h * ratio; }
  return {
    x: Math.round((boxW - w) / 2),
    y: Math.round((boxH - h) / 2),
    w: Math.round(w),
    h: Math.round(h)
  };
}

/* Add a rect frame at an exact print ratio. The preset is recorded on the
   layer so the sidecar and the importer can both see what was intended. */
function ffAddRatioFrame(id, orientation) {
  const r = ffRatio(id);
  if (!r) return null;
  const box = ffRatioBox(id, orientation, doc.canvas.w, doc.canvas.h);
  const L = newFrame('rect', box.x, box.y, box.w, box.h);
  L.name = 'Opening \u00b7 ' + ffRatioLabel(id, orientation);
  L.ratioId = id;
  L.ratioOrientation = orientation === 'landscape' ? 'landscape' : 'portrait';
  L.ratioValue = +ffRatioValue(id, orientation).toFixed(4);
  addLayerTop(L);
  return L;
}

/* =========================================================================
   UI
   ========================================================================= */
let ffRatioOrientation = 'portrait';
let ffSelectedRatio = '';

function ffRatioFillSelect() {
  const sel = $('#ratioPreset');
  if (!sel || sel.options.length) return;
  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'Frame ratio\u2026';
  sel.appendChild(first);
  FF_RATIOS.forEach(r => {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.label + ' \u2014 ' + r.sizes;
    sel.appendChild(o);
  });
}

function ffUpdateOrientButton() {
  const b = $('#btnRatioOrient');
  if (b) b.textContent = ffRatioOrientation === 'landscape' ? 'Landscape' : 'Portrait';
}

ffRatioFillSelect();
ffUpdateOrientButton();

if ($('#btnRatioOrient')) {
  $('#btnRatioOrient').onclick = () => {
    ffRatioOrientation = ffRatioOrientation === 'portrait' ? 'landscape' : 'portrait';
    ffUpdateOrientButton();
    toast('Frame ratio orientation: ' + ffRatioOrientation);
  };
}

/* Choosing a ratio only records the intent. Nothing is added until the
   creator asks for a bare opening or picks a frame design, so the two
   pickers never fight over the canvas. */
if ($('#ratioPreset')) {
  $('#ratioPreset').onchange = (ev) => {
    ffSelectedRatio = ev.target.value || '';
    if (!ffSelectedRatio) return;
    const r = ffRatio(ffSelectedRatio);
    toast(r.label + ' selected \u00b7 ' + r.sizes + ' \u00b7 ratio ' +
      ffRatioValue(ffSelectedRatio, ffRatioOrientation).toFixed(3) +
      ' \u2014 now add an opening or pick a frame design');
  };
}

if ($('#btnAddRatioFrame')) {
  $('#btnAddRatioFrame').onclick = () => {
    if (!ffSelectedRatio) { toast('Pick a frame ratio first'); return; }
    const L = ffAddRatioFrame(ffSelectedRatio, ffRatioOrientation);
    if (!L) return;
    toast('Added ' + L.name + ' \u00b7 ratio ' + L.ratioValue.toFixed(3) +
      ' \u2014 this ratio is now checked when you import the AI scene');
  };
}

window.FF_RATIOS = FF_RATIOS;
