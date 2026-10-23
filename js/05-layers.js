'use strict';
/* =========================================================================
   FrameForge Studio - 05-layers.js
   layer creation, hit-testing, snapshots, tools, toasts
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* =========================================================================
   LAYER FACTORIES
   ========================================================================= */
function newFrame(kind, x, y, w, h) {
  const pts = kind === 'persp'
    ? [{ x: x + w * 0.06, y: y + h * 0.04 }, { x: x + w, y }, { x: x + w * 0.97, y: y + h }, { x, y: y + h * 0.94 }]
    : [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  return {
    id: uid(), type: 'frame', name: kind === 'persp' ? 'Perspective Frame' : 'Screen Frame',
    frameType: kind === 'persp' ? 'perspective' : 'rect',
    visible: true, locked: false, opacity: 1, points: pts,
    content: null
  };
}
const emptyContent = (src) => ({ src, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, fit: 'cover' });

/* A frame only shows through a mockup's transparent screen when it sits
   underneath the artwork, so new frames go straight below the lowest
   overlay or shadow instead of on top where the user had to reorder them. */
function addLayerTop(L) {
  const under = L.type === 'frame' ? doc.layers.findIndex(l => l.type === 'overlay' || l.type === 'shadow') : -1;
  if (under > -1) doc.layers.splice(under, 0, L); else doc.layers.push(L);
  sel = L.id; sync();
}

/* =========================================================================
   POINTER INTERACTION
   ========================================================================= */
function toScene(ev) {
  const r = cv.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * doc.canvas.w, y: ((ev.clientY - r.top) / r.height) * doc.canvas.h };
}
function hitLayer(p) {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const L = doc.layers[i];
    if (!L.visible || L.locked) continue;
    if (L.type === 'frame') { if (inPoly(p, L.points)) return L; }
    else if (L.type === 'text') {
      const w = textW(ctx, L), h = L.size * 1.25 * String(L.text).split('\n').length;
      if (p.x >= L.x - 4 && p.x <= L.x + w + 4 && p.y >= L.y - 4 && p.y <= L.y + h + 4) return L;
    } else if (p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h) return L;
  }
  return null;
}
function hitCorner(p, L) {
  if (!L || L.type !== 'frame' || L.locked || L.publishMode==='silhouette') return -1;
  const r = 9 / zoom;
  for (let i = 0; i < L.points.length; i++) if (dist(p, L.points[i]) <= r) return i;
  return -1;
}

cv.addEventListener('pointerdown', (ev) => {
  cv.setPointerCapture(ev.pointerId);
  const p = toScene(ev);

  if (tool === 'frameRect' || tool === 'framePersp') {
    drag = { mode: 'create', kind: tool === 'framePersp' ? 'persp' : 'rect', start: p, cur: p };
    return;
  }
  if (tool === 'text') {
    addLayerTop({ id: uid(), type: 'text', name: 'Text', visible: true, locked: false, opacity: 1,
      text: 'Your text', x: p.x, y: p.y, size: 44, color: '#2C2C2B', weight: 700, align: 'left', rotation: 0 });
    setTool('select'); return;
  }
  if (tool === 'shape') {
    addLayerTop({ id: uid(), type: 'shape', name: 'Shape', visible: true, locked: false, opacity: 1,
      shape: 'rect', x: p.x - 100, y: p.y - 70, w: 200, h: 140, fill: '#E5F2FC', radius: 12, rotation: 0 });
    setTool('select'); return;
  }

  const cur = layer(sel);
  const ci = hitCorner(p, cur);
  if (ci >= 0) { drag = { mode: 'corner', id: cur.id, i: ci }; toast('Drag corner · Shift = constrain'); return; }

  const L = hitLayer(p);
  if (!L) { sel = null; contentEdit = null; sync(); return; }

  if (contentEdit === L.id && L.type === 'frame' && L.content) {
    drag = { mode: 'pan', id: L.id, start: p, o: { x: L.content.offsetX, y: L.content.offsetY } };
  } else {
    sel = L.id;
    if (contentEdit && contentEdit !== L.id) contentEdit = null;
    drag = { mode: 'move', id: L.id, start: p, snap: snapshot(L) };
  }
  sync();
});

function snapshot(L) {
  return L.type === 'frame' ? { points: L.points.map(q => ({ ...q })) } : { x: L.x, y: L.y };
}

cv.addEventListener('pointermove', (ev) => {
  if (!drag) {
    const p = toScene(ev);
    const cur = layer(sel);
    cv.style.cursor = hitCorner(p, cur) >= 0 ? 'grab'
      : (contentEdit && cur && inPoly(p, cur.points) ? 'move' : (hitLayer(p) ? 'pointer' : 'default'));
    return;
  }
  const p = toScene(ev);

  if (drag.mode === 'create') { drag.cur = p; render(); previewCreate(); return; }

  const L = layer(drag.id);
  if (!L) return;

  if (drag.mode === 'corner') {
    let q = p;
    if (ev.shiftKey) {
      const o = L.points[(drag.i + 2) % 4];
      q = Math.abs(p.x - o.x) > Math.abs(p.y - o.y) ? { x: p.x, y: L.points[drag.i].y } : { x: L.points[drag.i].x, y: p.y };
    }
    L.points[drag.i] = { x: Math.round(q.x), y: Math.round(q.y) };
    L.frameType = isAxisRect(L.points) ? 'rect' : (L.points.length > 4 ? 'polygon' : 'perspective');
    contentCache.clear();
  } else if (drag.mode === 'move') {
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (L.type === 'frame') {
      L.points = drag.snap.points.map(q => ({ x: Math.round(q.x + dx), y: Math.round(q.y + dy) }));
    } else { L.x = Math.round(drag.snap.x + dx); L.y = Math.round(drag.snap.y + dy); }
  } else if (drag.mode === 'pan') {
    const sp = frameSpace(L.points);
    L.content.offsetX = drag.o.x + (p.x - drag.start.x) / sp.w;
    L.content.offsetY = drag.o.y + (p.y - drag.start.y) / sp.h;
  }
  render(); refreshProps();
});

cv.addEventListener('pointerup', (ev) => {
  if (drag && drag.mode === 'create') {
    const a = drag.start, b = drag.cur;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    drag = null;
    if (w > 14 && h > 14) {
      addLayerTop(newFrame(drag2kind, Math.round(x), Math.round(y), Math.round(w), Math.round(h)));
      toast(doc.layers.some(l => l.type === 'overlay' || l.type === 'shadow') ? 'Frame placed under the mockup · set a preview image in the right panel' : 'Frame created · set an image in the right panel');
    }
    setTool('select'); return;
  }
  drag = null; sync();
});

let drag2kind = 'rect';
cv.addEventListener('dblclick', (ev) => {
  const L = hitLayer(toScene(ev));
  if (L && L.type === 'frame' && L.content) {
    sel = L.id; contentEdit = L.id;
    toast('Content mode · drag to move, scroll to zoom');
  } else if (L && L.type === 'frame') {
    sel = L.id; setImageFor(L);
  }
  sync();
});
cv.addEventListener('wheel', (ev) => {
  const L = layer(contentEdit);
  if (!L || !L.content) return;
  ev.preventDefault();
  L.content.scale = clamp(L.content.scale * (ev.deltaY < 0 ? 1.06 : 1 / 1.06), 0.05, 14);
  render(); refreshProps();
}, { passive: false });

function previewCreate() {
  const a = drag.start, b = drag.cur;
  ctx.save();
  ctx.scale(zoom, zoom);
  ctx.setLineDash([6, 4]); ctx.lineWidth = 1.6 / zoom; ctx.strokeStyle = '#2783DE';
  ctx.fillStyle = 'rgba(39,131,222,.08)';
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/* keyboard */
document.addEventListener('keydown', (ev) => {
  if (/input|textarea|select/i.test(ev.target.tagName)) return;
  const L = layer(sel);
  if (ev.key === 'r' || ev.key === 'R') setTool('frameRect');
  else if (ev.key === 'p' || ev.key === 'P') setTool('framePersp');
  else if (ev.key === 't' || ev.key === 'T') setTool('text');
  else if (ev.key === 's' || ev.key === 'S') setTool('shape');
  else if (ev.key === 'Escape') { setTool('select'); contentEdit = null; sel = null; sync(); }
  else if ((ev.key === 'Delete' || ev.key === 'Backspace') && L && !L.locked) { removeLayer(L.id); }
  else if (ev.key.startsWith('Arrow') && L && !L.locked) {
    ev.preventDefault();
    const d = ev.shiftKey ? 10 : 1;
    const dx = ev.key === 'ArrowLeft' ? -d : ev.key === 'ArrowRight' ? d : 0;
    const dy = ev.key === 'ArrowUp' ? -d : ev.key === 'ArrowDown' ? d : 0;
    if (L.type === 'frame') L.points = L.points.map(q => ({ x: q.x + dx, y: q.y + dy }));
    else { L.x += dx; L.y += dy; }
    render(); refreshProps();
  }
});

/* =========================================================================
   UI
   ========================================================================= */
function setTool(t) {
  tool = t;
  if (t === 'framePersp') drag2kind = 'persp';
  if (t === 'frameRect') drag2kind = 'rect';
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  const names = { select: 'Select', frameRect: 'Rect frame', framePersp: 'Perspective frame', text: 'Text', shape: 'Shape' };
  $('#modePill').textContent = names[t] || 'Select';
  $('#stageMsg').textContent = t === 'select'
    ? 'Click a frame to select · double-click to edit the image inside'
    : (t === 'text' || t === 'shape' ? 'Click on the canvas to place it' : 'Drag on the canvas to draw the frame');
  cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
}
let toastT;
function toast(msg) {
  const h = $('#hint'); h.textContent = msg; h.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => h.classList.remove('show'), 2200);
}
function sync() { render(); refreshLayers(); refreshProps(); }

const TYPE_LABEL = { frame: 'Frame', image: 'Image', overlay: 'Overlay (locked on top)', shadow: 'Shadow (locked on top)', text: 'Text', shape: 'Shape' };

function refreshLayers() {
  const box = $('#layerList');
  box.innerHTML = '';
  if (!doc.layers.length) { box.innerHTML = '<div class="empty">No layers yet. Add a mockup overlay, then draw a frame on it.</div>'; return; }
  [...doc.layers].reverse().forEach((L) => {
    const el = document.createElement('div');
    el.className = 'layer' + (L.id === sel ? ' on' : '') + (L.visible ? '' : ' dim');
    const src = L.type === 'frame' ? (L.content && L.content.src) : L.src;
    const sub = L.type === 'frame'
      ? (L.frameType === 'rect' ? 'Rect frame' : L.frameType === 'perspective' ? '4-point perspective' : 'Polygon frame') +
        (L.content ? '' : ' · empty')
      : TYPE_LABEL[L.type];
    el.innerHTML = `
      <div class="thumb" ${src ? `style="background-image:url(${src})"` : ''}>${src ? '' :
        (L.type === 'frame' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7D7A75" stroke-width="2"><rect x="3" y="5" width="18" height="14"/></svg>' :
         L.type === 'text' ? '<b style="font-size:13px">T</b>' : '<span style="width:12px;height:12px;border-radius:3px;background:' + (L.fill || '#E6E5E3') + '"></span>')}</div>
      <div class="meta"><div class="nm">${esc(L.name)}</div><div class="ty">${sub}</div></div>
      <button class="iconbtn ${L.visible ? '' : 'act'}" data-vis="${L.id}" title="Show / hide">
        ${L.visible
          ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>'
          : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.2 8.3C4 10 2 12 2 12s3.6 6.5 10 6.5c1 0 2-.2 2.8-.4"/></svg>'}
      </button>
      <button class="iconbtn ${L.locked ? 'act' : ''}" data-lock="${L.id}" title="Lock / unlock">
        ${L.locked
          ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
          : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/></svg>'}
      </button>`;
    el.addEventListener('click', (e) => {
      const v = e.target.closest('[data-vis]'), k = e.target.closest('[data-lock]');
      if (v) { L.visible = !L.visible; sync(); return; }
      if (k) { L.locked = !L.locked; if (L.locked && sel === L.id) contentEdit = null; sync(); return; }
      sel = L.id; contentEdit = null; sync();
    });
    box.appendChild(el);
  });
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function moveLayer(id, dir) {
  const i = doc.layers.findIndex(l => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.layers.length) return;
  [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
  sync();
}
function removeLayer(id) {
  doc.layers = doc.layers.filter(l => l.id !== id);
  if (sel === id) sel = null;
  if (contentEdit === id) contentEdit = null;
  sync();
}
async function setImageFor(L) {
  const f = await pickFile();
  if (!f) return;
  L.content = emptyContent(f.src);
  contentCache.clear();
  sel = L.id; contentEdit = L.id;
  toast('Image placed · drag to move, scroll to zoom');
  sync();
}
