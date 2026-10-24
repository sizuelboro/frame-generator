'use strict';
/* =========================================================================
   FrameForge Studio - 08-files.js
   export, project files, saved mockups, zoom, drag & drop, demo scene
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

$('#btnExport').onclick = () => {
  const off = exportCanvas({ scale: 2 });
  off.toBlob(b => download(b, 'mockup.png'), 'image/png');
  toast('Exported at 2× — mockup.png');
};
$('#btnExportOverlay').onclick = () => {
  const off = exportCanvas({ scale: 2, only: ['overlay','shadow'], bg: false });
  off.toBlob(b => download(b, 'overlay-transparent.png'), 'image/png');
  const alphaMap = makeOverlayAlphaMap(off);
  const frames = doc.layers.filter(l => l.type === 'frame')
    .map(l => ({ name: l.name, frameType: l.frameType, points: openingWithBleed(l.points, ffOpeningBleed, alphaMap), originalPoints: l.points, openingBleed: ffOpeningBleed, bleedMode: 'alpha-aware' }));
  download(new Blob([JSON.stringify({ canvas: doc.canvas, openingBleed: ffOpeningBleed, frames }, null, 2)], { type: 'application/json' }), 'frame-coords.json');
  toast('Overlay PNG + frame coordinates exported');
};

$('#btnSaveJson').onclick = () => {
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), 'design.json');
  toast('design.json saved — reopen it anytime');
};
$('#btnLoadJson').onclick = () => {
  const inp = $('#jsonPick');
  inp.value = '';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(String(fr.result));
        if (!d.layers) throw 0;
        doc = d; sel = null; contentEdit = null; contentCache.clear(); sizePill(); fit(); sync();
        toast('Design loaded');
      } catch (e) { toast('That file is not a FrameForge design'); }
    };
    fr.readAsText(f);
  };
  inp.click();
};

/* ---------------------------- reusable mockups ---------------------------- */
const TPL_KEY = 'frameforge.mockups.v1';
const tplAll = () => { try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch { return []; } };
const tplSave = (a) => localStorage.setItem(TPL_KEY, JSON.stringify(a));


function refreshTpls() {
  const box = $('#tplList');
  const list = tplAll();
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="empty">Build a mockup (overlay + frame), then use <b>File → Save as reusable mockup</b>. It is stored in this browser with empty frames, ready for any new artwork.</div>';
    return;
  }
  list.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tpl';
    el.innerHTML = `
      <div class="thumb" style="background-image:url(${t.thumb})"></div>
      <div class="nm">${esc(t.name)}${t.doc && t.doc.kind === 'scene' ? ' <span style="font-size:10px;padding:1px 5px;border-radius:4px;background:#1f6f43;color:#d9f5e4;vertical-align:middle">Scene</span>' : ''}</div>
      <button class="btn sm" data-use="${t.id}">Use</button>
      <button class="iconbtn" data-rm="${t.id}" title="Delete">×</button>`;
    el.querySelector('[data-use]').onclick = () => {
      doc = JSON.parse(JSON.stringify(t.doc));
      sel = null; contentEdit = null; contentCache.clear(); sizePill(); fit(); sync();
      const fr = doc.layers.find(l => l.type === 'frame');
      if (fr) { sel = fr.id; sync(); toast('Mockup loaded · set an image in the frame'); }
    };
    el.querySelector('[data-rm]').onclick = () => { tplSave(tplAll().filter(x => x.id !== t.id)); refreshTpls(); };
    box.appendChild(el);
  });
}

/* ---------------------------- zoom ---------------------------- */
function applyZoom() {
  if (!cv) return;
  cv.style.width = doc.canvas.w * zoom + 'px';
  cv.style.height = doc.canvas.h * zoom + 'px';
  board.style.width = doc.canvas.w * zoom + 'px';
  board.style.height = doc.canvas.h * zoom + 'px';
  $('#zoomVal').textContent = Math.round(zoom * 100) + '%';
}
function fit() {
  const pad = 56;
  const z = Math.min((wrap.clientWidth - pad) / doc.canvas.w, (wrap.clientHeight - pad) / doc.canvas.h, 1);
  zoom = clamp(z, 0.08, 1); applyZoom();
}
$('#zoomIn').onclick = () => { zoom = clamp(zoom * 1.15, 0.08, 4); applyZoom(); };
$('#zoomOut').onclick = () => { zoom = clamp(zoom / 1.15, 0.08, 4); applyZoom(); };
$('#zoomFit').onclick = fit;
window.addEventListener('resize', () => { applyZoom(); });

/* ---------------------------- drag & drop images ---------------------------- */
// Listen on the whole stage so drops on the empty-state card land too.
const dropZone = $('#wrap') || board;
['dragover', 'drop'].forEach(t => dropZone.addEventListener(t, e => e.preventDefault()));
dropZone.addEventListener('drop', (ev) => {
  const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (!f || !/^image\//.test(f.type)) return;
  const fr = new FileReader();
  fr.onload = () => {
    const src = String(fr.result);
    const p = toScene(ev);
    const target = doc.layers.filter(l => l.type === 'frame' && l.visible).reverse().find(l => inPoly(p, l.points));
    if (target) {
      target.content = emptyContent(src);
      contentCache.clear(); sel = target.id; contentEdit = target.id;
      toast('Dropped into ' + target.name);
      sync();
    } else if (!doc.layers.length) {
      // First image on an empty canvas is the mockup itself.
      loadMeta(src).then(m => {
        const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h);
        addLayerTop({ id: uid(), type: 'overlay', name: f.name.replace(/\.[^.]+$/, '') || 'Mockup overlay', visible: true, locked: true, opacity: 1,
          src, x: (doc.canvas.w - m.w * s) / 2, y: (doc.canvas.h - m.h * s) / 2, w: m.w * s, h: m.h * s, rotation: 0 });
        toast('Mockup added · now click Select design area');
      });
    } else {
      loadMeta(src).then(m => {
        const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h, 1);
        addLayerTop({ id: uid(), type: 'image', name: 'Image', visible: true, locked: false, opacity: 1,
          src, x: p.x - (m.w * s) / 2, y: p.y - (m.h * s) / 2, w: m.w * s, h: m.h * s, rotation: 0 });
      });
    }
  };
  fr.readAsDataURL(f);
});

/* ---------------------------- demo scene ---------------------------- */
function demoArt() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 750;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1200, 750);
  g.addColorStop(0, '#123a63'); g.addColorStop(.55, '#2783DE'); g.addColorStop(1, '#5EC8D8');
  x.fillStyle = g; x.fillRect(0, 0, 1200, 750);
  x.globalAlpha = .18; x.fillStyle = '#fff';
  for (let i = 0; i < 26; i++) { x.beginPath(); x.arc(90 + i * 47, 120 + (i % 5) * 130, 60 + (i % 4) * 26, 0, 7); x.fill(); }
  x.globalAlpha = 1;
  x.fillStyle = '#fff';
  x.font = '700 92px -apple-system,Segoe UI,Roboto,sans-serif';
  x.textAlign = 'center';
  x.fillText('YOUR DESIGN', 600, 370);
  x.font = '500 40px -apple-system,Segoe UI,Roboto,sans-serif';
  x.globalAlpha = .85;
  x.fillText('drops right into the frame', 600, 440);
  return c.toDataURL('image/jpeg', 0.86);
}

function boot() {
  const ov = window.DEMO_OVERLAY;
  const S = window.DEMO_SCREEN || { w: 1200, h: 800, corners: [[172, 66], [1027, 66], [1026, 540], [174, 540]] };
  if (!ov) { // lite build: start empty
    doc = { canvas: { w: 1200, h: 800, bg: '#FFFFFF' }, layers: [] };
    sizePill(); setTool('select'); fit(); refreshTpls(); sync();
    setTimeout(() => toast('Add a mockup overlay, then hit Auto screen'), 700);
    return;
  }
  doc = {
    canvas: { w: S.w, h: S.h, bg: '#FFFFFF' },
    layers: [
      { id: uid(), type: 'frame', name: 'Laptop Screen Frame', frameType: 'rect', visible: true, locked: false, opacity: 1,
        points: S.corners.map(([x, y]) => ({ x, y })), content: emptyContent(demoArt()) },
      { id: uid(), type: 'overlay', name: 'Laptop Mockup Overlay', visible: true, locked: true, opacity: 1,
        src: ov, x: 0, y: 0, w: S.w, h: S.h, rotation: 0 }
    ]
  };
  sizePill(); setTool('select'); fit(); refreshTpls(); sync();
  setTimeout(() => toast('Demo loaded · drop any image onto the screen to swap it'), 700);
}
boot();
