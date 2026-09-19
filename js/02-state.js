'use strict';
/* =========================================================================
   FrameForge Studio - 02-state.js
   limits, document state, image cache, file loading
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

'use strict';
/* =========================================================================
   FrameForge — mockup frame studio
   Layer engine + true 4-point perspective warp (homography + triangle mesh)
   ========================================================================= */

/* ---------------------------- limits ----------------------------
   FF_LIMITS is defined by js/01-limits.js, generated from
   shared/frameforge-limits.js. Never hardcode a path budget below. */
const FF_PATH_BUDGET = FF_LIMITS.PATH_BUDGET;
/* Simplifier target: stop under the budget so the final encode has room. */
const FF_PATH_TARGET = FF_LIMITS.PATH_BUDGET - 80;
const FF_MAX_PATHS_SINGLE = FF_LIMITS.MAX_PATHS_SINGLE;
const FF_MAX_PATHS_MULTI = FF_LIMITS.MAX_PATHS_MULTI;

/* ---------------------------- state ---------------------------- */
let doc = { canvas: { w: 1200, h: 800, bg: '#FFFFFF' }, layers: [] };
let sel = null;          // selected layer id
let contentEdit = null;  // frame id whose inner image is being edited
let tool = 'select';
let zoom = 1;
let drag = null;

const uid = () => 'l' + Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const $ = (s) => document.querySelector(s);

const cv = $('#cv'), ctx = cv.getContext('2d');
const board = $('#board'), wrap = $('#wrap');

/* ---------------------------- image cache ---------------------------- */
const imgCache = new Map();
function getImg(src) {
  if (!src) return null;
  let e = imgCache.get(src);
  if (!e) {
    e = { img: new Image(), ready: false };
    e.img.onload = () => { e.ready = true; contentCache.clear(); render(); refreshLayers(); };
    e.img.src = src;
    imgCache.set(src, e);
  }
  return e.ready ? e.img : null;
}
function loadMeta(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
    i.src = src;
  });
}
function pickFile(accept) {
  return new Promise((res) => {
    const inp = $('#filePick');
    inp.value = '';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return res(null);
      const fr = new FileReader();
      fr.onload = () => res({ src: String(fr.result), name: f.name });
      fr.readAsDataURL(f);
    };
    inp.click();
  });
}
