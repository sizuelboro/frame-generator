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

   The shapes are picked in the Generate panel (22-modes.js).
   ========================================================================= */

/* Portrait ratios, expressed short-side : long-side. A-series is one entry
   on purpose - A5 through A1 are all 1:root(2), so the shape is identical
   and only the printed size differs.

   `sizes` is written portrait-first and flipped for display in landscape
   rather than being listed twice, so each preset keeps one source of
   truth. */
const FF_RATIOS = [
  { id: 'iso',   label: 'A-series',  w: 1,  h: 1.41421356, sizes: 'A5, A4, A3, A2, A1' },
  { id: '2-3',   label: '2:3',       w: 2,  h: 3,          sizes: '12\u00d718, 16\u00d724, 20\u00d730, 24\u00d736' },
  { id: '3-4',   label: '3:4',       w: 3,  h: 4,          sizes: '9\u00d712, 12\u00d716, 18\u00d724' },
  { id: '4-5',   label: '4:5',       w: 4,  h: 5,          sizes: '8\u00d710, 16\u00d720' },
  { id: '5-7',   label: '5:7',       w: 5,  h: 7,          sizes: '5\u00d77, 10\u00d714' },
  { id: '11-14', label: '11:14',     w: 11, h: 14,         sizes: '11\u00d714' },
  { id: '1-1',   label: '1:1',       w: 1,  h: 1,          sizes: 'Square prints' },
  /* Not a print size: the shape of a phone story or a wide screen, which is
     what an on-screen Pixopik frame is often cut to. */
  { id: '9-16',  label: '9:16',      w: 9,  h: 16,         sizes: 'Story, widescreen' }
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

/* The ratio family itself flips with the orientation: a 2:3 print hung
   sideways is a 3:2 print. Squares read the same either way. */
function ffRatioFamilyLabel(id, orientation) {
  const r = ffRatio(id);
  if (!r) return '';
  if (orientation !== 'landscape' || r.id === '1-1' || r.id === 'iso') return r.label;
  const parts = r.label.split(':');
  return parts.length === 2 ? parts[1] + ':' + parts[0] : r.label;
}

/* "12x18, 16x24" -> "18x12, 24x16". Entries with nothing to swap, such as
   the A-series names and "Square prints", pass straight through. */
function ffFlipSizes(sizes) {
  return String(sizes).split(', ').map(part => {
    const m = /^(\d+)\u00d7(\d+)$/.exec(part.trim());
    return m ? m[2] + '\u00d7' + m[1] : part;
  }).join(', ');
}

function ffRatioSizes(id, orientation) {
  const r = ffRatio(id);
  if (!r) return '';
  return orientation === 'landscape' ? ffFlipSizes(r.sizes) : r.sizes;
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

window.FF_RATIOS = FF_RATIOS;
