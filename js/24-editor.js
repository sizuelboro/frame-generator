'use strict';
/* =========================================================================
   FrameForge Studio - 24-editor.js
   the editor shell: panels, context bar, transform handles, undo, shortcuts
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html. This
   file is loaded last because it wraps functions defined earlier.

   What this adds
   --------------
   The Studio works like a design editor:

     rail + flyout     Frames, Uploads, Text, Elements, Layers; one panel
                       open at a time, click the open one to close it
     context bar       above the canvas, follows the selection: font and
                       size for text, fill for shapes, flip and replace for
                       images, photo controls for an opening; opacity,
                       position, lock, duplicate and delete for everything
     transform         eight resize handles and a rotate handle on images,
                       shapes and text, with smart guides that snap to the
                       canvas and to other layers while moving
     history           undo / redo of every document change
     shortcuts         Ctrl+Z, Ctrl+Shift+Z, Ctrl+D, Ctrl+C / Ctrl+V,
                       Ctrl+] / Ctrl+[ (with Shift: to front / back)
     text              double-click to edit on the canvas; Google Fonts

   How it hooks in
   ---------------
   The earlier files are function declarations in one global scope, so a
   later file can wrap them by reassigning the name; every caller resolves
   the name when it runs and picks up the wrapper (15-download.js does the
   same with download()). Wrapped here: sync, refreshProps, hitLayer,
   drawChrome, setTool, wandMode, applyZoom, pickFile.

   Openings (frame layers) keep their own editing in 05-layers.js: corner
   points, moving, and panning the photo inside. Everything else is
   transformed here, in capture-phase listeners on the canvas area that run
   before the canvas listeners and stops the event when it takes over.
   ========================================================================= */

const ffEl = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
/* shared state, declared first: render() can run before the sections below */
let _ffDrag = null;      // transform in progress
let _ffGuides = [];      // smart guides to draw
let _ffEditing = null;   // text being edited on the canvas

const ffSvg = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;

/* =========================================================================
   Panels
   ========================================================================= */
function ffShowPanel(name, toggle) {
  const open = !document.body.classList.contains('flyout-closed');
  const current = (document.querySelector('.railbtn[aria-selected="true"]') || {}).dataset;
  if (toggle && open && current && current.panel === name) {
    document.body.classList.add('flyout-closed');
    document.querySelectorAll('.railbtn').forEach(b => b.setAttribute('aria-selected', 'false'));
    return;
  }
  document.body.classList.remove('flyout-closed');
  document.querySelectorAll('.railbtn').forEach(b => b.setAttribute('aria-selected', b.dataset.panel === name ? 'true' : 'false'));
  document.querySelectorAll('.fpanel').forEach(p => p.classList.toggle('on', p.dataset.panel === name));
}
document.querySelectorAll('.railbtn').forEach(b => b.addEventListener('click', () => ffShowPanel(b.dataset.panel, true)));
// picking a way to make a frame always shows its steps
document.querySelectorAll('[data-choose],[data-mode-tab]').forEach(b => b.addEventListener('click', () => ffShowPanel('frames')));

/* =========================================================================
   History
   =========================================================================
   A snapshot is a deep copy of `doc`. Strings are shared, not copied, so
   fifty snapshots of a design with a 2 MB data URL do not hold fifty
   copies of it. Change detection uses a signature in which every long
   string (image data) is reduced to its length and tail. */
const FF_HISTORY_MAX = 80;
const _ffHist = { stack: [], i: -1, t: 0, lock: false };

function ffClone(v) {
  if (Array.isArray(v)) return v.map(ffClone);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = ffClone(v[k]);
    return o;
  }
  return v;
}
function ffSig(d) {
  return JSON.stringify(d, (k, v) => (typeof v === 'string' && v.length > 256 ? v.length + ':' + v.slice(-48) : v));
}
function ffHistBusy() {
  return !!(drag || _ffDrag || _ffEditing || _ffHist.lock);
}
function ffHistSchedule() {
  clearTimeout(_ffHist.t);
  _ffHist.t = setTimeout(ffHistCommit, 300);
}
function ffHistCommit() {
  clearTimeout(_ffHist.t);
  if (ffHistBusy()) { ffHistSchedule(); return; }
  const sig = ffSig(doc);
  const top = _ffHist.stack[_ffHist.i];
  if (top && top.sig === sig) return;
  _ffHist.stack = _ffHist.stack.slice(0, _ffHist.i + 1);
  _ffHist.stack.push({ doc: ffClone(doc), sig });
  if (_ffHist.stack.length > FF_HISTORY_MAX) _ffHist.stack.shift();
  _ffHist.i = _ffHist.stack.length - 1;
  ffHistButtons();
}
function ffHistButtons() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (u) u.disabled = _ffHist.i <= 0;
  if (r) r.disabled = _ffHist.i >= _ffHist.stack.length - 1;
}
function ffHistRestore(entry) {
  _ffHist.lock = true;
  doc = ffClone(entry.doc);
  sel = null; contentEdit = null; contentCache.clear();
  sizePill(); applyZoom();
  // Generate tracks the layers it drew by id; pick them up from the
  // restored document so the panel shows the shape and style it has.
  if (window.ffStudioMode === 'generate' && typeof ffGenAdopt === 'function') {
    ffGen.overlayId = ffGen.frameId = null;
    ffGenAdopt();
    ffGenRenderPanel();
  }
  sync();
  _ffHist.lock = false;
  ffHistButtons();
}
function ffUndo() {
  if (!ffHistBusy()) ffHistCommit();
  if (_ffHist.i <= 0) return false;
  _ffHist.i--;
  ffHistRestore(_ffHist.stack[_ffHist.i]);
  return true;
}
function ffRedo() {
  if (_ffHist.i >= _ffHist.stack.length - 1) return false;
  _ffHist.i++;
  ffHistRestore(_ffHist.stack[_ffHist.i]);
  return true;
}
if ($('#btnUndo')) $('#btnUndo').onclick = ffUndo;
if ($('#btnRedo')) $('#btnRedo').onclick = ffRedo;
// edits that only call render() (sliders, colour pickers) end in a change
document.addEventListener('change', ffHistSchedule, true);

/* =========================================================================
   Geometry of a selectable layer
   =========================================================================
   Every transformable layer is a rectangle in its own rotated frame: an
   origin O (what it rotates around, as render() draws it) and a local
   rect relative to O. Images and shapes rotate around their centre; text
   rotates around its anchor (L.x, L.y), the rect offset by alignment. */
function ffTransformable(L) {
  return !!L && L.type !== 'frame' && L.visible !== false;
}
function ffBox(L) {
  const rot = (L.rotation || 0) * Math.PI / 180;
  if (L.type === 'text') {
    const tw = Math.max(4, textW(ctx, L)), th = L.size * 1.25 * String(L.text).split('\n').length;
    const ax = L.align === 'center' ? -tw / 2 : L.align === 'right' ? -tw : 0;
    return { ox: L.x, oy: L.y, rot, x: ax, y: 0, w: tw, h: th };
  }
  return { ox: L.x + L.w / 2, oy: L.y + L.h / 2, rot, x: -L.w / 2, y: -L.h / 2, w: L.w, h: L.h };
}
function ffToWorld(b, lx, ly) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { x: b.ox + lx * c - ly * s, y: b.oy + lx * s + ly * c };
}
function ffToLocal(b, p) {
  const dx = p.x - b.ox, dy = p.y - b.oy, c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}
function ffCorners(b) {
  return [ffToWorld(b, b.x, b.y), ffToWorld(b, b.x + b.w, b.y), ffToWorld(b, b.x + b.w, b.y + b.h), ffToWorld(b, b.x, b.y + b.h)];
}
function ffInBox(L, p) {
  const b = ffBox(L), q = ffToLocal(b, p), pad = L.type === 'text' ? 4 : 0;
  return q.x >= b.x - pad && q.x <= b.x + b.w + pad && q.y >= b.y - pad && q.y <= b.y + b.h + pad;
}
function ffAABB(L) {
  if (L.type === 'frame') return bbox(L.points);
  const c = ffCorners(ffBox(L));
  const xs = c.map(q => q.x), ys = c.map(q => q.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/* Hit-testing follows the rotated box, and text alignment, which the
   original rectangle test in 05-layers.js did not know about. */
hitLayer = function (p) {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const L = doc.layers[i];
    if (!L.visible || L.locked) continue;
    if (L.type === 'frame') { if (inPoly(p, L.points)) return L; }
    else if (ffInBox(L, p)) return L;
  }
  return null;
};
/* Topmost layer under the point, locked ones included: clicking a locked
   layer selects it (to unlock it), it just cannot be dragged. */
function ffHitAny(p) {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const L = doc.layers[i];
    if (!L.visible) continue;
    if (L.type === 'frame' ? inPoly(p, L.points) : ffInBox(L, p)) return L;
  }
  return null;
}

/* Handles: four corners, four sides (hidden when the edge is too short to
   hold them), and a rotate handle below. Text resizes by its corners only:
   it scales the font size, which keeps the proportions. */
const FF_HANDLES = [['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0]];
const FF_HIT_PX = 9;
function ffHandles(L) {
  const b = ffBox(L), out = [];
  for (const [id, sx, sy] of FF_HANDLES) {
    const side = sx === 0 || sy === 0;
    if (side && (L.type === 'text' || (sx === 0 ? b.w : b.h) * zoom < 44)) continue;
    out.push(Object.assign({ id, sx, sy, side }, ffToWorld(b, b.x + (sx + 1) / 2 * b.w, b.y + (sy + 1) / 2 * b.h)));
  }
  out.push(Object.assign({ id: 'rot', sx: 0, sy: 0 }, ffToWorld(b, b.x + b.w / 2, b.y + b.h + 28 / zoom)));
  return out;
}
function ffHitHandle(L, p) {
  if (!ffTransformable(L) || L.locked) return null;
  return ffHandles(L).find(h => dist(h, p) <= (h.id === 'rot' ? 12 : FF_HIT_PX) / zoom) || null;
}
function ffHandleCursor(L, h) {
  if (h.id === 'rot') return 'grab';
  const a = (Math.atan2(h.sy, h.sx) + (L.rotation || 0) * Math.PI / 180) * 180 / Math.PI;
  const n = ((Math.round(a / 45) % 4) + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][n];
}

/* =========================================================================
   Transform drags
   ========================================================================= */
const FF_SNAP_PX = 6;

function ffSnapTargets(L) {
  const xs = [0, doc.canvas.w / 2, doc.canvas.w], ys = [0, doc.canvas.h / 2, doc.canvas.h];
  doc.layers.forEach(o => {
    if (o === L || o.visible === false) return;
    if (o.type === 'frame' && !(o.points && o.points.length >= 3)) return;
    const a = ffAABB(o);
    xs.push(a.x, a.x + a.w / 2, a.x + a.w);
    ys.push(a.y, a.y + a.h / 2, a.y + a.h);
  });
  return { xs, ys };
}

function ffDragStart(L, p, handle) {
  const b = ffBox(L);
  if (!handle) {
    _ffDrag = { mode: 'move', id: L.id, start: p, x0: L.x, y0: L.y, targets: ffSnapTargets(L), moved: false };
  } else if (handle.id === 'rot') {
    _ffDrag = { mode: 'rotate', id: L.id, b0: b, a0: Math.atan2(p.y - b.oy, p.x - b.ox), r0: L.rotation || 0 };
  } else {
    _ffDrag = { mode: 'resize', id: L.id, h: handle, b0: b, size0: L.size };
  }
  return _ffDrag;
}

function ffDragMove(p, mods) {
  const d = _ffDrag;
  if (!d) return;
  const L = layer(d.id);
  if (!L) return;
  const m = mods || {};
  _ffGuides = [];
  d.label = null;
  d.at = p;

  if (d.mode === 'move') {
    L.x = d.x0 + (p.x - d.start.x);
    L.y = d.y0 + (p.y - d.start.y);
    d.moved = d.moved || dist(p, d.start) * zoom > 2;
    if (!m.alt) {
      const tol = FF_SNAP_PX / zoom, a = ffAABB(L);
      const snap = (edges, lines) => {
        let best = null;
        edges.forEach(e => lines.forEach(t => { const dd = t - e; if (Math.abs(dd) <= tol && (!best || Math.abs(dd) < Math.abs(best.d))) best = { d: dd, at: t }; }));
        return best;
      };
      const sx = snap([a.x, a.x + a.w / 2, a.x + a.w], d.targets.xs);
      const sy = snap([a.y, a.y + a.h / 2, a.y + a.h], d.targets.ys);
      if (sx) { L.x += sx.d; _ffGuides.push({ x: sx.at }); }
      if (sy) { L.y += sy.d; _ffGuides.push({ y: sy.at }); }
    }
    L.x = Math.round(L.x); L.y = Math.round(L.y);
  } else if (d.mode === 'rotate') {
    const b = d.b0;
    let deg = d.r0 + (Math.atan2(p.y - b.oy, p.x - b.ox) - d.a0) * 180 / Math.PI;
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    if (m.shift) deg = Math.round(deg / 15) * 15;
    else { const near = Math.round(deg / 45) * 45; if (Math.abs(deg - near) < 3) deg = near; }
    if (deg <= -180) deg += 360;
    L.rotation = Math.round(deg);
    d.label = L.rotation + '\u00b0';
  } else if (d.mode === 'resize') {
    const b = d.b0, h = d.h, q = ffToLocal(b, p);
    if (L.type === 'text') {
      const A = { x: b.x + (1 - h.sx) / 2 * b.w, y: b.y + (1 - h.sy) / 2 * b.h };
      const C = { x: b.x + (1 + h.sx) / 2 * b.w, y: b.y + (1 + h.sy) / 2 * b.h };
      const vx = C.x - A.x, vy = C.y - A.y;
      const s = Math.max(0.05, ((q.x - A.x) * vx + (q.y - A.y) * vy) / (vx * vx + vy * vy || 1));
      L.size = Math.max(6, Math.round(d.size0 * s));
      const k = L.size / d.size0;
      const o = ffToWorld(b, A.x * (1 - k), A.y * (1 - k));
      L.x = Math.round(o.x); L.y = Math.round(o.y);
      d.label = L.size + ' px';
    } else {
      const ax = -h.sx * b.w / 2, ay = -h.sy * b.h / 2;
      let w = b.w, hh = b.h;
      // images keep their proportions from a corner (Shift frees them);
      // shapes are free (Shift keeps them)
      const keep = !h.side && (L.type === 'shape' ? !!m.shift : !m.shift);
      if (keep) {
        const cx = h.sx * b.w, cy = h.sy * b.h;
        const s = Math.max(0.01, ((q.x - ax) * cx + (q.y - ay) * cy) / (cx * cx + cy * cy || 1));
        w = Math.max(4, b.w * s); hh = Math.max(4, b.h * s);
      } else {
        if (h.sx) w = Math.max(4, (q.x - ax) * h.sx);
        if (h.sy) hh = Math.max(4, (q.y - ay) * h.sy);
      }
      const c = ffToWorld(b, ax + (h.sx ? h.sx * w / 2 : 0), ay + (h.sy ? h.sy * hh / 2 : 0));
      L.w = Math.round(w); L.h = Math.round(hh);
      L.x = Math.round(c.x - L.w / 2); L.y = Math.round(c.y - L.h / 2);
      d.label = L.w + ' \u00d7 ' + L.h;
    }
  }
}

function ffDragEnd() {
  const d = _ffDrag;
  _ffDrag = null;
  _ffGuides = [];
  if (d) sync();
  return d;
}

/* ---- pointer routing ----
   Listened for on the whole canvas area, not just the canvas: a layer that
   touches the page edge has handles half outside it, and those must still
   be grabbable. Clicking the empty area around the page deselects. */
const ffOnStage = (t) => t === cv || t === board || t === wrap;
function ffOwnsPointer(ev) {
  return ffOnStage(ev.target) && ev.button === 0 && tool === 'select' && !(typeof _wandOn !== 'undefined' && _wandOn);
}
wrap.addEventListener('pointerdown', (ev) => {
  ffMenuClose();
  if (!ffOwnsPointer(ev) || _ffEditing) return;
  const p = toScene(ev);
  const cur = layer(sel);
  const onCanvas = ev.target === cv;
  // a selected opening's corner points stay with 05-layers.js
  if (onCanvas && cur && cur.type === 'frame' && hitCorner(p, cur) >= 0) return;
  const handle = ffHitHandle(cur, p);
  let L = handle ? cur : null;
  if (!L) {
    if (!onCanvas) {
      if (sel || contentEdit) { sel = null; contentEdit = null; sync(); }
      return;
    }
    const hit = hitLayer(p);
    if (hit && hit.type === 'frame') return;          // openings: 05-layers.js
    if (hit && contentEdit && hit.id === contentEdit) return;
    L = hit;
    if (!L) {
      // nothing unlocked here: select a locked layer so it can be unlocked
      const any = ffHitAny(p);
      if (any && any.type !== 'frame') {
        ev.stopPropagation();
        sel = any.id; contentEdit = null; sync();
      }
      return;
    }
  }
  ev.stopPropagation();
  ev.preventDefault();
  try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic event */ }
  if (sel !== L.id) { sel = L.id; contentEdit = null; sync(); }
  ffDragStart(L, p, handle);
}, true);

wrap.addEventListener('pointermove', (ev) => {
  if (!ffOnStage(ev.target)) return;
  const p = toScene(ev);
  if (_ffDrag) {
    ev.stopPropagation();
    ffDragMove(p, { shift: ev.shiftKey, alt: ev.altKey });
    render();
    return;
  }
  wrap.style.cursor = '';
  if (tool !== 'select' || drag) return;
  const L = layer(sel);
  const h = ffHitHandle(L, p);
  if (h) {
    ev.stopPropagation();
    const c = ffHandleCursor(L, h);
    cv.style.cursor = c;
    if (ev.target !== cv) wrap.style.cursor = c;
  } else if (ev.target === cv && L && ffTransformable(L) && !L.locked && ffInBox(L, p)) {
    ev.stopPropagation(); cv.style.cursor = 'move';
  }
}, true);

wrap.addEventListener('pointerup', (ev) => {
  if (!_ffDrag) return;
  ev.stopPropagation();
  ffDragEnd();
}, true);

board.addEventListener('dblclick', (ev) => {
  if (ev.target !== cv) return;
  const L = hitLayer(toScene(ev));
  if (L && L.type === 'text') { ev.stopPropagation(); ffEditText(L); }
}, true);

/* ---- selection chrome ---- */
const _ffBaseChrome = drawChrome;
drawChrome = function (c) {
  const L = layer(sel);
  if (L && ffTransformable(L) && !(_ffEditing && _ffEditing.id === L.id)) ffDrawSelection(c, L);
  else if (L && L.type === 'frame') _ffBaseChrome(c);
  ffDrawGuides(c);
};

function ffDrawSelection(c, L) {
  const b = ffBox(L), k = 1 / zoom, pts = ffCorners(b);
  c.save();
  c.beginPath();
  pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
  c.closePath();
  c.lineWidth = 1.5 * k;
  c.strokeStyle = FF_UI.accent;
  if (L.locked) c.setLineDash([5 * k, 4 * k]);
  c.stroke();
  c.setLineDash([]);
  if (!L.locked && !(_ffDrag && _ffDrag.mode === 'move' && _ffDrag.moved)) {
    ffHandles(L).forEach(h => {
      c.save();
      c.translate(h.x, h.y);
      c.rotate(b.rot);
      c.shadowColor = 'rgba(35,35,52,.3)'; c.shadowBlur = 4 * k; c.shadowOffsetY = 1 * k;
      c.fillStyle = '#fff';
      c.beginPath();
      if (h.id === 'rot') c.arc(0, 0, 10 * k, 0, Math.PI * 2);
      else if (h.side) { const lw = h.sx ? 5 : 16, lh = h.sx ? 16 : 5; c.roundRect ? c.roundRect(-lw / 2 * k, -lh / 2 * k, lw * k, lh * k, 2.5 * k) : c.rect(-lw / 2 * k, -lh / 2 * k, lw * k, lh * k); }
      else c.arc(0, 0, 5.5 * k, 0, Math.PI * 2);
      c.fill();
      c.shadowColor = 'transparent';
      c.lineWidth = 1.2 * k; c.strokeStyle = 'rgba(35,35,52,.22)'; c.stroke();
      if (h.id === 'rot') {
        c.beginPath(); c.arc(0, 0, 4.5 * k, -Math.PI * 0.9, Math.PI * 0.6);
        c.lineWidth = 1.6 * k; c.strokeStyle = FF_UI.accent; c.stroke();
        c.beginPath(); c.moveTo(-4.6 * k, -3.6 * k); c.lineTo(-4.4 * k, 0.4 * k); c.lineTo(-1.0 * k, -1.6 * k);
        c.stroke();
      }
      c.restore();
    });
  }
  const d = _ffDrag;
  if (d && d.label && d.at) {
    c.font = `600 ${12 * k}px -apple-system,Segoe UI,Roboto,sans-serif`;
    const tw = c.measureText(d.label).width, x = d.at.x + 16 * k, y = d.at.y + 16 * k;
    c.fillStyle = 'rgba(35,35,52,.92)';
    c.beginPath();
    c.roundRect ? c.roundRect(x, y, tw + 14 * k, 22 * k, 6 * k) : c.rect(x, y, tw + 14 * k, 22 * k);
    c.fill();
    c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillText(d.label, x + 7 * k, y + 11 * k);
  }
  c.restore();
}

function ffDrawGuides(c) {
  if (!_ffGuides.length) return;
  c.save();
  c.strokeStyle = '#e0398f';
  c.lineWidth = 1 / zoom;
  _ffGuides.forEach(g => {
    c.beginPath();
    if (g.x != null) { c.moveTo(g.x, 0); c.lineTo(g.x, doc.canvas.h); }
    else { c.moveTo(0, g.y); c.lineTo(doc.canvas.w, g.y); }
    c.stroke();
  });
  c.restore();
}

/* =========================================================================
   Layer operations
   ========================================================================= */
let _ffClip = null, _ffPasteN = 0;

function ffOffsetLayer(L, d) {
  if (L.type === 'frame') L.points = L.points.map(q => ({ x: q.x + d, y: q.y + d }));
  else { L.x += d; L.y += d; }
}
function ffInsertCopy(src, after) {
  const c = ffClone(src);
  c.id = uid();
  delete c.frameDesignId;      // a copy is ordinary artwork, not Generate's frame
  delete c.ratioId;
  ffOffsetLayer(c, 20);
  const i = after ? doc.layers.findIndex(l => l.id === after.id) : -1;
  if (i > -1) doc.layers.splice(i + 1, 0, c); else doc.layers.push(c);
  sel = c.id; contentEdit = null;
  sync();
  return c;
}
function ffDuplicate(L) {
  if (!L) return null;
  const c = ffInsertCopy(L, L);
  c.name = String(L.name || 'Layer').replace(/( copy)+$/, '') + ' copy';
  refreshLayers();
  toast('Duplicated');
  return c;
}
function ffCopy(L) { if (L) { _ffClip = ffClone(L); _ffPasteN = 0; toast('Copied'); } }
function ffPaste() {
  if (!_ffClip) return null;
  _ffPasteN++;
  const c = ffInsertCopy(_ffClip, null);
  if (_ffPasteN > 1) { ffOffsetLayer(c, 20 * (_ffPasteN - 1)); sync(); }
  return c;
}
function ffOrder(L, how) {
  if (!L) return;
  const i = doc.layers.indexOf(L);
  if (how === 'up') return moveLayer(L.id, 1);
  if (how === 'down') return moveLayer(L.id, -1);
  doc.layers.splice(i, 1);
  if (how === 'front') doc.layers.push(L); else doc.layers.unshift(L);
  sync();
}
function ffToggleLock(L) {
  if (!L) return;
  L.locked = !L.locked;
  if (L.locked && contentEdit === L.id) contentEdit = null;
  sync();
  toast(L.locked ? 'Locked' : 'Unlocked');
}
function ffDelete(L) { if (L) removeLayer(L.id); }

/* =========================================================================
   Fonts
   ========================================================================= */
/* Loaded from Google Fonts in index.html. [family, fallback]. */
const FF_FONTS = [
  ['Inter', 'sans-serif'], ['Poppins', 'sans-serif'], ['Montserrat', 'sans-serif'], ['Oswald', 'sans-serif'],
  ['Bebas Neue', 'sans-serif'], ['Playfair Display', 'serif'], ['Lora', 'serif'], ['Merriweather', 'serif'],
  ['Cinzel', 'serif'], ['Dancing Script', 'cursive'], ['Great Vibes', 'cursive'], ['Pacifico', 'cursive'],
  ['Caveat', 'cursive'], ['Amatic SC', 'cursive'], ['Creepster', 'cursive']
];
const ffFontCss = (name) => {
  const f = FF_FONTS.find(x => x[0] === name);
  return f ? `"${f[0]}", ${f[1]}` : null;
};
const ffFontName = (L) => { const m = /"([^"]+)"/.exec(L.font || ''); return m ? m[1] : 'System'; };

/* A canvas does not ask the browser to fetch a web font, so ask for every
   font a text layer uses and redraw once it has arrived. */
const _ffFontsAsked = new Set();
function ffEnsureFonts() {
  if (!document.fonts || !document.fonts.load) return;
  doc.layers.forEach(L => {
    if (L.type !== 'text') return;
    const name = ffFontName(L);
    if (name === 'System') return;
    const key = (L.italic ? 'italic ' : '') + (L.weight || 600) + ' "' + name + '"';
    if (_ffFontsAsked.has(key)) return;
    _ffFontsAsked.add(key);
    document.fonts.load(key.replace(' "', ' 40px "')).then(() => { render(); ffLiveSchedule(); }).catch(() => {});
  });
}

/* =========================================================================
   Text: presets, combinations, editing on the canvas
   ========================================================================= */
const FF_TEXT_PRESETS = {
  heading: { text: 'Add a heading', size: 76, weight: 800, font: 'Inter' },
  subheading: { text: 'Add a subheading', size: 46, weight: 600, font: 'Inter' },
  body: { text: 'Add a little bit of body text', size: 28, weight: 400, font: 'Inter' }
};
const FF_TEXT_COMBOS = [
  { text: 'Happy Halloween', font: 'Creepster', size: 84, weight: 400, color: '#e8711a' },
  { text: 'Save the Date', font: 'Great Vibes', size: 92, weight: 400, color: '#5146d8' },
  { text: 'BIG SALE', font: 'Bebas Neue', size: 120, weight: 400, color: '#232334' },
  { text: 'Our Wedding', font: 'Playfair Display', size: 68, weight: 700, color: '#8a6d3b' },
  { text: 'hello there!', font: 'Pacifico', size: 64, weight: 400, color: '#d6493d' },
  { text: 'Family Memories', font: 'Amatic SC', size: 80, weight: 700, color: '#2f9461' }
];

function ffAddText(spec, edit) {
  const size = spec.size || 40;
  const L = {
    id: uid(), type: 'text', name: String(spec.text).slice(0, 28), visible: true, locked: false, opacity: 1,
    text: spec.text, size, weight: spec.weight || 600, color: spec.color || '#232334',
    font: ffFontCss(spec.font) || ffFontCss('Inter'), align: 'center', rotation: 0,
    x: Math.round(doc.canvas.w / 2), y: Math.round(doc.canvas.h / 2 - size * 0.625)
  };
  doc.layers.push(L);
  sel = L.id; contentEdit = null;
  sync();
  if (edit) setTimeout(() => ffEditText(L, true), 0);
  return L;
}
document.querySelectorAll('[data-text]').forEach(b => b.addEventListener('click', () => ffAddText(FF_TEXT_PRESETS[b.dataset.text], true)));
(function renderCombos() {
  const box = $('#textCombos');
  if (!box) return;
  FF_TEXT_COMBOS.forEach(s => {
    const b = ffEl('button', 'combo', s.text);
    b.style.fontFamily = ffFontCss(s.font);
    b.style.fontWeight = s.weight;
    b.style.color = s.color;
    b.style.fontSize = Math.round(Math.min(30, s.size * 0.3)) + 'px';
    b.title = s.font;
    b.onclick = () => ffAddText(s, false);
    box.appendChild(b);
  });
})();

/* Editing on the canvas: a textarea laid exactly over the text, in the
   same font at the current zoom. The layer is hidden while it is edited
   so the two never show at once. */
/* The canvas draws text with its em box at the top of each 1.25 line; a
   textarea centres the em box in the line, so it sits half the leading
   lower. The extra width keeps the caret visible at the end of a line. */
const FF_EDIT_PAD = 6;
function ffEditPlace(L, ta) {
  const b = ffBox(L), lead = L.size * 0.125 * zoom;
  const pad = L.align === 'center' ? FF_EDIT_PAD : L.align === 'right' ? FF_EDIT_PAD * 2 : 0;
  ta.style.left = (b.ox + b.x) * zoom - pad + 'px';
  ta.style.top = b.oy * zoom - lead + 'px';
  ta.style.width = b.w * zoom + FF_EDIT_PAD * 2 + 'px';
  ta.style.height = b.h * zoom + 'px';
  ta.style.transformOrigin = (-b.x * zoom + pad) + 'px ' + lead + 'px';
  ta.style.transform = b.rot ? `rotate(${b.rot}rad)` : '';
}
function ffEditText(L, selectAll) {
  ffEditClose();
  if (!L || L.type !== 'text' || L.locked) return;
  const ta = ffEl('textarea', 'textedit');
  ta.value = L.text;
  ta.spellcheck = false;
  ta.style.font = `${L.italic ? 'italic ' : ''}${L.weight || 600} ${L.size * zoom}px ${L.font || '-apple-system,Segoe UI,Roboto,sans-serif'}`;
  ta.style.color = L.color;
  ta.style.textAlign = L.align || 'left';
  ffEditPlace(L, ta);
  board.appendChild(ta);
  _ffEditing = { id: L.id, ta, zoom };
  render();
  ta.focus();
  if (selectAll) ta.select();
  ta.addEventListener('input', () => { L.text = ta.value; ffEditPlace(L, ta); });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ffEditClose(); }
  });
  ta.addEventListener('blur', () => ffEditClose());
}
function ffEditClose() {
  const e = _ffEditing;
  if (!e) return;
  _ffEditing = null;
  e.ta.remove();
  const L = layer(e.id);
  if (L) {
    if (!String(L.text).trim()) { removeLayer(L.id); return; }
    L.name = String(L.text).split('\n')[0].slice(0, 28) || 'Text';
  }
  sync();
}

/* While a text is edited, the main canvas leaves it out: the textarea is
   the text. Exports and the preview pass a target, so they are untouched. */
const _ffBaseRender = render;
render = function (target, opts) {
  const L = !target && _ffEditing ? layer(_ffEditing.id) : null;
  if (!L) return _ffBaseRender(target, opts);
  const v = L.visible;
  L.visible = false;
  try { return _ffBaseRender(target, opts); } finally { L.visible = v; }
};

/* =========================================================================
   Elements and uploads
   ========================================================================= */
const FF_PALETTE = ['#232334', '#626277', '#ffffff', '#eeedf3', '#5146d8', '#8b7ff0', '#d6493d', '#f08a5d',
  '#e8711a', '#f2c94c', '#2f9461', '#7bc47f', '#2d9cdb', '#bcd9ef', '#8a6d3b', '#000000'];
const FF_SHAPES = [
  { id: 'square', shape: 'rect', w: 260, h: 260, radius: 0 },
  { id: 'rounded', shape: 'rect', w: 260, h: 260, radius: 40 },
  { id: 'circle', shape: 'ellipse', w: 260, h: 260 },
  { id: 'oval', shape: 'ellipse', w: 340, h: 220 },
  { id: 'pill', shape: 'rect', w: 360, h: 110, radius: 55 },
  { id: 'banner', shape: 'rect', w: 420, h: 130, radius: 0 },
  { id: 'line', shape: 'rect', w: 420, h: 10, radius: 5 },
  { id: 'card', shape: 'rect', w: 300, h: 400, radius: 18 }
];
let ffShapeFill = '#5146d8';

function ffAddShape(spec) {
  const L = {
    id: uid(), type: 'shape', name: spec.id.charAt(0).toUpperCase() + spec.id.slice(1), visible: true, locked: false, opacity: 1,
    shape: spec.shape, w: spec.w, h: spec.h, radius: spec.radius || 0, fill: ffShapeFill, rotation: 0,
    x: Math.round((doc.canvas.w - spec.w) / 2), y: Math.round((doc.canvas.h - spec.h) / 2)
  };
  doc.layers.push(L);
  sel = L.id; contentEdit = null;
  sync();
  return L;
}
(function renderElements() {
  const grid = $('#shapeGrid'), sw = $('#shapeSwatches');
  if (grid) FF_SHAPES.forEach(s => {
    const b = ffEl('button', 'eitem');
    b.title = s.id; b.dataset.shape = s.id;
    const i = ffEl('i');
    const k = 34 / Math.max(s.w, s.h);
    i.style.width = Math.max(3, s.w * k) + 'px'; i.style.height = Math.max(3, s.h * k) + 'px';
    i.style.borderRadius = s.shape === 'ellipse' ? '50%' : (s.radius || 0) * k + 'px';
    b.appendChild(i);
    b.onclick = () => ffAddShape(s);
    grid.appendChild(b);
  });
  const paint = () => {
    if (!sw) return;
    sw.textContent = '';
    FF_PALETTE.forEach(c => {
      const d = ffEl('button', 'sw' + (c === ffShapeFill ? ' on' : ''));
      d.style.background = c; d.title = c;
      d.onclick = () => { ffShapeFill = c; paint(); if (grid) grid.querySelectorAll('i').forEach(x => (x.style.background = c)); };
      sw.appendChild(d);
    });
  };
  paint();
  if (grid) grid.querySelectorAll('i').forEach(x => (x.style.background = ffShapeFill));
})();

/* Every image picked this session, for one-click reuse. */
const _ffUploads = [];
const _ffBasePick = pickFile;
pickFile = function (accept) {
  return _ffBasePick(accept).then((f) => {
    if (f && !_ffUploads.some(u => u.src === f.src)) {
      _ffUploads.unshift({ src: f.src, name: f.name });
      if (_ffUploads.length > 24) _ffUploads.pop();
      ffRenderUploads();
    }
    return f;
  });
};
async function ffAddImageFrom(u) {
  const m = await loadMeta(u.src);
  const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h, 1);
  addLayerTop({ id: uid(), type: 'image', name: ffNiceName(u.name, 'Image'), visible: true, locked: false, opacity: 1,
    src: u.src, x: (doc.canvas.w - m.w * s) / 2, y: (doc.canvas.h - m.h * s) / 2, w: m.w * s, h: m.h * s, rotation: 0 });
}
function ffRenderUploads() {
  const g = $('#uploadsGrid');
  if (!g) return;
  g.textContent = '';
  if (!_ffUploads.length) { g.appendChild(ffEl('div', 'dropzone', 'Images you upload appear here. Click one to add it again.')); g.style.display = 'block'; return; }
  g.style.display = '';
  _ffUploads.forEach(u => {
    const b = ffEl('button', 'uitem');
    b.title = 'Add ' + u.name;
    const img = ffEl('img'); img.src = u.src; img.alt = '';
    b.appendChild(img);
    b.appendChild(ffEl('span', '', u.name));
    b.onclick = () => ffAddImageFrom(u);
    g.appendChild(b);
  });
}
ffRenderUploads();

/* =========================================================================
   Popovers
   ========================================================================= */
let _ffPop = null;
function ffPopClose() { if (_ffPop) { _ffPop.el.remove(); _ffPop = null; } }
function ffPop(anchor, key, build) {
  if (_ffPop && _ffPop.key === key) { ffPopClose(); return null; }
  ffPopClose();
  const el = ffEl('div', 'cpop');
  build(el);
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
  el.style.top = Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 8) + 'px';
  _ffPop = { el, key, anchor };
  return el;
}
document.addEventListener('mousedown', (e) => {
  if (_ffPop && !_ffPop.el.contains(e.target) && !_ffPop.anchor.contains(e.target)) ffPopClose();
}, true);

function ffColorPop(pop, current, apply) {
  pop.appendChild(ffEl('h4', '', 'Colour'));
  const grid = ffEl('div', 'swatches');
  FF_PALETTE.forEach(c => {
    const d = ffEl('button', 'sw' + (String(current).toLowerCase() === c ? ' on' : ''));
    d.style.background = c; d.title = c;
    d.onclick = () => { apply(c, true); ffPopClose(); };
    grid.appendChild(d);
  });
  pop.appendChild(grid);
  const row = ffEl('div', 'prow');
  row.style.marginTop = '12px';
  row.appendChild(ffEl('span', '', 'Custom'));
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#5146d8';
  inp.style.width = '64px';
  inp.oninput = () => apply(inp.value, false);
  inp.onchange = () => apply(inp.value, true);
  row.appendChild(inp);
  pop.appendChild(row);
}
function ffSliderPop(pop, title, min, max, value, unit, apply) {
  pop.appendChild(ffEl('h4', '', title));
  const row = ffEl('div', 'prow');
  const r = document.createElement('input');
  r.type = 'range'; r.min = min; r.max = max; r.value = value;
  const n = document.createElement('input');
  n.type = 'number'; n.className = 'inp num'; n.min = min; n.max = max; n.value = value;
  r.oninput = () => { n.value = r.value; apply(+r.value, false); };
  r.onchange = () => apply(+r.value, true);
  n.onchange = () => { const v = clamp(+n.value || 0, min, max); n.value = r.value = v; apply(v, true); };
  row.appendChild(r); row.appendChild(n);
  if (unit) row.appendChild(ffEl('span', 'clabel', unit));
  pop.appendChild(row);
}
function ffListPop(pop, title, items) {
  if (title) pop.appendChild(ffEl('h4', '', title));
  const list = ffEl('div', 'plist');
  items.forEach(it => {
    if (!it) return;
    const b = ffEl('button', it.on ? 'on' : '');
    b.innerHTML = (it.icon ? ffSvg(it.icon) : '') + '<span></span>' + (it.k ? `<span class="k">${it.k}</span>` : '');
    b.children[it.icon ? 1 : 0].textContent = it.label;
    b.onclick = () => { ffPopClose(); it.run(); };
    list.appendChild(b);
  });
  pop.appendChild(list);
}

/* =========================================================================
   Context bar
   ========================================================================= */
function ffCbtn(opts) {
  const b = ffEl('button', 'cbtn' + (opts.cls ? ' ' + opts.cls : '') + (opts.on ? ' on' : '') + (opts.label ? '' : ' icon'));
  b.type = 'button';
  b.innerHTML = (opts.icon ? ffSvg(opts.icon) : '') + (opts.html || '');
  if (opts.label) b.appendChild(document.createTextNode(opts.label));
  if (opts.title) { b.title = opts.title; b.setAttribute('aria-label', opts.title); }
  if (opts.id) b.id = opts.id;
  if (opts.run) b.onclick = (e) => opts.run(b, e);
  return b;
}
const ffSep = () => ffEl('span', 'csep');
const ffMod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '\u2318' : 'Ctrl+';

function ffPositionItems(L) {
  return [
    { icon: 'front', label: 'Bring to front', k: ffMod + '\u21e7]', run: () => ffOrder(L, 'front') },
    { icon: 'up', label: 'Bring forward', k: ffMod + ']', run: () => ffOrder(L, 'up') },
    { icon: 'down', label: 'Send backward', k: ffMod + '[', run: () => ffOrder(L, 'down') },
    { icon: 'back', label: 'Send to back', k: ffMod + '\u21e7[', run: () => ffOrder(L, 'back') }
  ];
}

function ffCtxRender() {
  const bar = $('#ctxTools');
  if (!bar) return;
  bar.textContent = '';
  const L = layer(sel);
  const cbar = $('#ctxBar');
  if (cbar) cbar.classList.toggle('has-sel', !!L);
  const add = (n) => { bar.appendChild(n); return n; };

  if (!L) {
    add(ffCbtn({ icon: 'settings', label: 'Canvas ' + doc.canvas.w + ' \u00d7 ' + doc.canvas.h, title: 'Canvas size and background', run: () => ffDrawer(true) }));
    const bg = doc.canvas.bg === 'transparent' ? 'transparent' : doc.canvas.bg;
    add(ffCbtn({
      html: `<i class="swatchdot" style="background:${bg === 'transparent' ? 'repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/8px 8px' : bg}"></i>`,
      title: 'Background colour',
      run: (b) => ffPop(b, 'bg', (pop) => {
        ffColorPop(pop, bg, (c, commit) => { doc.canvas.bg = c; render(); if (commit) sync(); });
        const t = ffEl('button', 'btn sm', 'Transparent');
        t.style.marginTop = '10px';
        t.onclick = () => { doc.canvas.bg = 'transparent'; ffPopClose(); sync(); };
        pop.appendChild(t);
      })
    }));
    add(ffSep());
    return;
  }

  if (L.type === 'text') {
    const fname = ffFontName(L);
    const fb = add(ffCbtn({ cls: 'cfont', label: fname, title: 'Font', run: (b) => ffPop(b, 'font', (pop) => {
      pop.appendChild(ffEl('h4', '', 'Font'));
      const list = ffEl('div', 'plist fontlist');
      FF_FONTS.forEach(([name]) => {
        const it = ffEl('button', name === fname ? 'on' : '', name);
        it.style.fontFamily = ffFontCss(name);
        it.onclick = () => { L.font = ffFontCss(name); ffPopClose(); sync(); };
        list.appendChild(it);
      });
      pop.appendChild(list);
    }) }));
    fb.style.fontFamily = L.font || '';
    fb.insertAdjacentHTML('beforeend', ffSvg('chev'));

    const sz = ffEl('div', 'csize');
    const minus = ffEl('button'); minus.innerHTML = ffSvg('minus'); minus.title = 'Smaller';
    const plus = ffEl('button'); plus.innerHTML = ffSvg('plus'); plus.title = 'Larger';
    const n = document.createElement('input'); n.type = 'number'; n.value = L.size; n.min = 6; n.max = 800; n.id = 'ctxSize'; n.setAttribute('aria-label', 'Font size');
    const setSize = (v) => { L.size = clamp(Math.round(v) || L.size, 6, 800); sync(); };
    minus.onclick = () => setSize(L.size - (L.size > 40 ? 4 : 1));
    plus.onclick = () => setSize(L.size + (L.size >= 40 ? 4 : 1));
    n.onchange = () => setSize(+n.value);
    sz.appendChild(minus); sz.appendChild(n); sz.appendChild(plus);
    add(sz);

    add(ffCbtn({ html: `<i class="textA" style="border-color:${L.color}">A</i>`, title: 'Text colour', run: (b) => ffPop(b, 'tcolor', (pop) =>
      ffColorPop(pop, L.color, (c, commit) => { L.color = c; render(); if (commit) sync(); })) }));
    add(ffCbtn({ icon: 'bold', title: 'Bold', on: (L.weight || 600) >= 700, run: () => { L.weight = (L.weight || 600) >= 700 ? 400 : 800; sync(); } }));
    add(ffCbtn({ icon: 'italic', title: 'Italic', on: !!L.italic, run: () => { L.italic = !L.italic; sync(); } }));
    const al = L.align || 'left';
    add(ffCbtn({ icon: al === 'center' ? 'alignc' : al === 'right' ? 'alignr' : 'alignl', title: 'Alignment', run: () => {
      // keep the text where it is on the canvas when its anchor moves
      const b0 = ffBox(L);
      L.align = al === 'left' ? 'center' : al === 'center' ? 'right' : 'left';
      const b1 = ffBox(L), dx = b0.x - b1.x;
      L.x = Math.round(L.x + dx * Math.cos(b0.rot)); L.y = Math.round(L.y + dx * Math.sin(b0.rot));
      sync();
    } }));
    add(ffSep());
  } else if (L.type === 'shape') {
    add(ffCbtn({ html: `<i class="swatchdot" style="background:${L.fill}"></i>`, title: 'Fill colour', run: (b) => ffPop(b, 'fill', (pop) =>
      ffColorPop(pop, L.fill, (c, commit) => { L.fill = c; render(); if (commit) sync(); })) }));
    add(ffCbtn({ icon: 'border', title: 'Rectangle', on: L.shape !== 'ellipse', run: () => { L.shape = 'rect'; sync(); } }));
    add(ffCbtn({ icon: 'frames', title: 'Ellipse', on: L.shape === 'ellipse', run: () => { L.shape = 'ellipse'; sync(); } }));
    if (L.shape !== 'ellipse') add(ffCbtn({ icon: 'radius', title: 'Corner rounding', run: (b) => ffPop(b, 'radius', (pop) =>
      ffSliderPop(pop, 'Corner rounding', 0, Math.round(Math.min(L.w, L.h) / 2), L.radius || 0, 'px', (v, commit) => { L.radius = v; render(); if (commit) sync(); })) }));
    add(ffSep());
  } else if (L.type === 'image' || L.type === 'overlay' || L.type === 'shadow') {
    if (L.type !== 'shadow') add(ffCbtn({ icon: 'refresh', label: 'Replace', title: 'Replace the image, keeping its place', run: () => ffReplaceImage(L) }));
    add(ffCbtn({ icon: 'fliph', label: 'Flip', title: 'Flip', run: (b) => ffPop(b, 'flip', (pop) => ffListPop(pop, '', [
      { icon: 'fliph', label: 'Flip horizontal', on: !!L.flipX, run: () => { L.flipX = !L.flipX; sync(); } },
      { icon: 'flipv', label: 'Flip vertical', on: !!L.flipY, run: () => { L.flipY = !L.flipY; sync(); } }
    ])) }));
    add(ffSep());
  } else if (L.type === 'frame') {
    add(ffCbtn({ id: 'ctxPhoto', cls: 'primary', icon: 'photo', label: L.content ? 'Replace photo' : 'Try a photo', title: 'Preview a photo in the opening (never exported)', run: () => setImageFor(L) }));
    if (L.content) {
      add(ffCbtn({ icon: 'crosshair', label: 'Adjust photo', on: contentEdit === L.id, title: 'Drag to move the photo, scroll to zoom it', run: () => { contentEdit = contentEdit === L.id ? null : L.id; sync(); } }));
      add(ffCbtn({ icon: 'close', title: 'Remove photo', run: () => { L.content = null; contentEdit = null; contentCache.clear(); sync(); } }));
    }
    add(ffSep());
  }

  if (L.type !== 'frame') {
    add(ffCbtn({ icon: 'opacity', title: 'Transparency', run: (b) => ffPop(b, 'opacity', (pop) =>
      ffSliderPop(pop, 'Transparency', 0, 100, Math.round((L.opacity == null ? 1 : L.opacity) * 100), '%', (v, commit) => { L.opacity = v / 100; render(); if (commit) sync(); })) }));
  }
  add(ffCbtn({ icon: 'position', label: 'Position', title: 'Layer order', run: (b) => ffPop(b, 'pos', (pop) => ffListPop(pop, 'Layer order', ffPositionItems(L))) }));
  add(ffSep());
  add(ffCbtn({ icon: L.locked ? 'lock' : 'unlock', on: !!L.locked, title: L.locked ? 'Unlock' : 'Lock', run: () => ffToggleLock(L) }));
  add(ffCbtn({ icon: 'copy', title: 'Duplicate (' + ffMod + 'D)', run: () => ffDuplicate(L) }));
  add(ffCbtn({ icon: 'trash', cls: 'danger', title: 'Delete', run: () => ffDelete(L), id: 'ctxDelete' }));
  add(ffCbtn({ icon: 'settings', title: 'All details', on: document.body.classList.contains('drawer-open'), run: () => ffDrawer() }));
}

async function ffReplaceImage(L) {
  const f = await pickFile();
  if (!f) return;
  const m = await loadMeta(f.src);
  // fit the new picture inside the old box, centred, so nothing jumps
  const cx = L.x + L.w / 2, cy = L.y + L.h / 2, s = Math.min(L.w / m.w, L.h / m.h);
  L.src = f.src; L.w = Math.round(m.w * s); L.h = Math.round(m.h * s);
  L.x = Math.round(cx - L.w / 2); L.y = Math.round(cy - L.h / 2);
  contentCache.clear();
  sync();
}

/* ---- details drawer ---- */
function ffDrawer(open) {
  const on = open == null ? !document.body.classList.contains('drawer-open') : open;
  document.body.classList.toggle('drawer-open', on);
  ffCtxRender();
}
if ($('#drawerClose')) $('#drawerClose').onclick = () => ffDrawer(false);

/* =========================================================================
   Context menu
   ========================================================================= */
let _ffMenu = null;
function ffMenuClose() { if (_ffMenu) { _ffMenu.remove(); _ffMenu = null; } }
function ffMenu(x, y, items) {
  ffMenuClose();
  const m = ffEl('div', 'cmenu');
  items.forEach(it => {
    if (it === '-') { m.appendChild(ffEl('hr')); return; }
    if (!it) return;
    const b = ffEl('button', it.danger ? 'danger' : '');
    b.innerHTML = ffSvg(it.icon || 'cursor') + '<span></span>' + (it.k ? `<span class="k">${it.k}</span>` : '');
    b.children[1].textContent = it.label;
    b.onclick = () => { ffMenuClose(); it.run(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
  _ffMenu = m;
}
document.addEventListener('mousedown', (e) => { if (_ffMenu && !_ffMenu.contains(e.target)) ffMenuClose(); }, true);
cv.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  ffPopClose();
  const p = toScene(ev);
  const L = ffHitAny(p);
  if (L && sel !== L.id) { sel = L.id; contentEdit = null; sync(); }
  if (!L) {
    if (sel) { sel = null; sync(); }
    ffMenu(ev.clientX, ev.clientY, [
      _ffClip ? { icon: 'paste', label: 'Paste', k: ffMod + 'V', run: ffPaste } : null,
      { icon: 'fit', label: 'Fit to screen', run: fit },
      { icon: 'settings', label: 'Canvas settings', run: () => ffDrawer(true) }
    ]);
    return;
  }
  ffMenu(ev.clientX, ev.clientY, [
    L.type === 'frame' ? { icon: 'photo', label: L.content ? 'Replace photo' : 'Try a photo', run: () => setImageFor(L) } : null,
    L.type === 'text' && !L.locked ? { icon: 'text', label: 'Edit text', run: () => ffEditText(L, true) } : null,
    L.type === 'frame' ? '-' : (L.type === 'text' && !L.locked ? '-' : null),
    { icon: 'copy', label: 'Copy', k: ffMod + 'C', run: () => ffCopy(L) },
    _ffClip ? { icon: 'paste', label: 'Paste', k: ffMod + 'V', run: ffPaste } : null,
    { icon: 'copy', label: 'Duplicate', k: ffMod + 'D', run: () => ffDuplicate(L) },
    '-',
    ...ffPositionItems(L),
    '-',
    { icon: L.locked ? 'unlock' : 'lock', label: L.locked ? 'Unlock' : 'Lock', run: () => ffToggleLock(L) },
    { icon: 'settings', label: 'All details', run: () => ffDrawer(true) },
    { icon: 'trash', label: 'Delete', k: 'Del', danger: true, run: () => ffDelete(L) }
  ]);
});

/* =========================================================================
   Shortcuts
   =========================================================================
   Runs on window in the capture phase, before 05-layers.js on document,
   so Ctrl+S or Ctrl+R never switches tools the way a bare S or R does. */
window.addEventListener('keydown', (ev) => {
  if (_ffEditing) return;
  const t = ev.target;
  if (t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable)) return;
  if (document.querySelector('.dlg-back,.pxback')) return;
  if (ev.key === 'Escape' && (_ffPop || _ffMenu)) { ffPopClose(); ffMenuClose(); ev.stopPropagation(); return; }
  const mod = ev.ctrlKey || ev.metaKey;
  if (!mod) {
    const L = layer(sel);
    if (ev.key === 'Enter' && L && L.type === 'text') { ev.preventDefault(); ev.stopPropagation(); ffEditText(L, true); }
    return;
  }
  ev.stopPropagation();
  const k = ev.key.toLowerCase(), L = layer(sel);
  const take = () => ev.preventDefault();
  if (k === 'z') { take(); if (ev.shiftKey) ffRedo(); else ffUndo(); }
  else if (k === 'y') { take(); ffRedo(); }
  else if (k === 'd' && L) { take(); ffDuplicate(L); }
  else if (k === 'c' && L) { ffCopy(L); }
  else if (k === 'v' && _ffClip) { take(); ffPaste(); }
  else if ((k === ']' || k === '}') && L) { take(); ffOrder(L, ev.shiftKey ? 'front' : 'up'); }
  else if ((k === '[' || k === '{') && L) { take(); ffOrder(L, ev.shiftKey ? 'back' : 'down'); }
}, true);

/* =========================================================================
   Zoom dock
   ========================================================================= */
const _ffBaseApplyZoom = applyZoom;
applyZoom = function () {
  _ffBaseApplyZoom();
  const r = $('#zoomRange');
  if (r) r.value = String(Math.round(zoom * 100));
  if (_ffEditing && _ffEditing.zoom !== zoom) ffEditClose();
};
if ($('#zoomRange')) $('#zoomRange').addEventListener('input', (e) => { zoom = clamp(+e.target.value / 100, 0.08, 4); applyZoom(); });
// Ctrl + wheel (and a trackpad pinch) zooms the canvas
wrap.addEventListener('wheel', (ev) => {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();
  ev.stopPropagation();
  zoom = clamp(zoom * Math.exp(-ev.deltaY * 0.0025), 0.08, 4);
  applyZoom();
}, { passive: false, capture: true });

/* Fit leaves room for the context bar above and the docks below, so no
   handle ends up under the zoom controls. */
fit = function () {
  const z = Math.min((wrap.clientWidth - 96) / doc.canvas.w, (wrap.clientHeight - 136) / doc.canvas.h, 1);
  zoom = clamp(z, 0.08, 1);
  applyZoom();
};
if ($('#zoomFit')) $('#zoomFit').onclick = () => fit();

/* =========================================================================
   Preview card, design name, tool state
   ========================================================================= */
(function previewCard() {
  const card = $('#pxFloat'), head = $('#pxFloatToggle');
  if (!card || !head) return;
  // folded by default so it never covers the artwork; the choice is kept
  let closed = true;
  try { closed = localStorage.getItem('frameforge.preview.closed') !== '0'; } catch (e) { /* storage blocked */ }
  const set = (c) => {
    card.classList.toggle('closed', c);
    head.setAttribute('aria-expanded', c ? 'false' : 'true');
    try { localStorage.setItem('frameforge.preview.closed', c ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (!c) ffLiveSchedule();
  };
  set(closed);
  head.onclick = () => set(!card.classList.contains('closed'));
  const more = $('#pxMore');
  if (more) more.onclick = () => {
    const on = !card.classList.contains('more');
    card.classList.toggle('more', on);
    more.textContent = on ? 'Hide status' : 'Status';
  };
  head.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(!card.classList.contains('closed')); } };
})();

const FF_UNTITLED = 'Untitled frame';
if ($('#docName')) {
  const n = $('#docName');
  n.addEventListener('input', () => { doc.name = n.value.trim().slice(0, 40); });
  n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') n.blur(); });
  n.addEventListener('blur', () => { if (!n.value.trim()) n.value = FF_UNTITLED; doc.name = n.value.trim(); sync(); });
}

function ffToolState() {
  document.body.classList.toggle('tool-active', tool !== 'select' || (typeof _wandOn !== 'undefined' && _wandOn));
}
const _ffBaseSetTool = setTool;
setTool = function (t) { _ffBaseSetTool(t); ffToolState(); };
const _ffBaseWand = wandMode;
wandMode = function (on) { _ffBaseWand(on); ffToolState(); };

/* =========================================================================
   Wiring into sync
   ========================================================================= */
const _ffBaseRefreshProps = refreshProps;
refreshProps = function () {
  _ffBaseRefreshProps();
  const tip = $('#nextTip');
  if (tip) tip.innerHTML = ffNextTip();
};
const _ffBaseSync = sync;
sync = function () {
  _ffBaseSync();
  ffCtxRender();
  ffEnsureFonts();
  const n = $('#docName');
  if (n && document.activeElement !== n) n.value = doc.name || FF_UNTITLED;
  if (!_ffHist.lock) ffHistSchedule();
};

ffToolState();
fit();
sync();
ffHistCommit();

window.ffUndo = ffUndo;
window.ffRedo = ffRedo;
window.ffShowPanel = ffShowPanel;
window.ffAddText = ffAddText;
window.ffAddShape = ffAddShape;
window.ffDuplicate = ffDuplicate;
window.ffEditText = ffEditText;
