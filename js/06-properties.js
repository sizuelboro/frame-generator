'use strict';
/* =========================================================================
   FrameForge Studio - 06-properties.js
   property panel binding and layer list
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* ---------------------------- inspector ----------------------------
   The right panel answers three questions without a click:

     How will it look?   a live preview drawn the way Pixopik draws an
                         empty frame (sky placeholder in the opening,
                         artwork on top, cropped like the export)
     Where am I?         a status list: mode, artwork, opening, shape
     What now?           one sentence that follows the steps on the left

   Canvas settings are folded away: Export for Pixopik crops for you, so
   most creators never need them. Selecting a layer shows its own controls
   with the preview kept on top. */

/* One sentence saying what to do now, following the steps on the left. */
function ffNextTip() {
  const mode = window.ffStudioMode;
  const art = doc.layers.some(l => l.type === 'overlay' && !l.frameDesignId);
  const opening = doc.layers.some(l => l.type === 'frame');
  if (!mode) return 'Pick <b>Generate</b> to have a frame drawn for you, or <b>From image</b> to use your own frame PNG.';
  if (mode === 'generate') return opening
    ? 'Change the shape, style or border on the left until it looks right, then <b>Export for Pixopik</b>.'
    : 'Click a <b>style</b> on the left to draw a frame.';
  if (!art) return '<b>Upload your frame PNG</b> on the left, or drop it on the canvas.';
  if (!opening) return 'Click <b>inside the opening</b> of your frame on the canvas.';
  return 'Drag a corner point if the opening needs adjusting, then <b>Export for Pixopik</b>.';
}

const ffIcon = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;
const FF_LAYER_ICON = { frame: 'rect', image: 'image', overlay: 'layers', shadow: 'shadow', text: 'text', shape: 'shape' };

/* ---- live preview ---- */
/* Everything that ends up in the overlay PNG; openings are not artwork. */
const FF_LIVE_ART = ['overlay', 'shadow', 'image', 'text', 'shape'];
const FF_LIVE_W = 248, FF_LIVE_H = 192;   // CSS pixels inside .live
const _ffLive = { cv: null, t: 0, retries: 0 };

function ffLiveOpenings() {
  return doc.layers
    .filter(l => l.type === 'frame' && l.visible !== false && l.points && l.points.length >= 3)
    .sort((a, b) => { const p = bbox(a.points), q = bbox(b.points); return q.w * q.h - p.w * p.h; });
}

function ffLiveHtml() {
  return `
    <div class="insp">
      <h2>Preview in Pixopik</h2>
      <div class="live" id="liveSlot"></div>
      <div class="livecap"><i></i><span id="liveCap">The sky shows where the photo goes</span></div>
    </div>`;
}

/* The canvas element is kept across re-renders of the panel, so a redraw
   never flashes empty while the creator drags a corner. */
function ffLiveMount() {
  const slot = $('#liveSlot');
  if (!slot) return;
  if (!_ffLive.cv) { _ffLive.cv = document.createElement('canvas'); _ffLive.cv.id = 'livePreview'; }
  slot.appendChild(_ffLive.cv);
  _ffLive.retries = 0;
  ffLiveSchedule();
}

/* Throttled, not debounced: while a corner is dragged the preview keeps
   up every ~90 ms instead of waiting for the pointer to stop. A timer, not
   requestAnimationFrame, which never fires in a background tab. */
function ffLiveSchedule() {
  if (_ffLive.t) return;
  _ffLive.t = setTimeout(() => { _ffLive.t = 0; ffLiveDraw(); }, 90);
}

function ffLiveAlphaBox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 3) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function ffLiveDraw() {
  const slot = $('#liveSlot'), c = _ffLive.cv, cap = $('#liveCap');
  if (!slot || !c || !c.isConnected) return;
  const fr = ffLiveOpenings()[0] || null;

  // artwork at a small scale, only to find its bounds and draw the thumbnail
  const k = Math.min(1, 640 / Math.max(doc.canvas.w, doc.canvas.h));
  const art = document.createElement('canvas');
  art.width = Math.max(1, Math.round(doc.canvas.w * k));
  art.height = Math.max(1, Math.round(doc.canvas.h * k));
  const ax = art.getContext('2d', { willReadFrequently: true });
  render(ax, { scale: k, chrome: false, only: FF_LIVE_ART, bg: false });
  let artBox = null;
  try { artBox = ffLiveAlphaBox(ax.getImageData(0, 0, art.width, art.height).data, art.width, art.height); } catch (e) { artBox = null; }
  if (artBox) artBox = { x: artBox.x / k, y: artBox.y / k, w: artBox.w / k, h: artBox.h / k };

  // the same crop Export for Pixopik makes: artwork plus the opening
  const boxes = [artBox, fr ? bbox(fr.points) : null].filter(Boolean);
  let empty = slot.querySelector('.liveempty');
  if (!boxes.length) {
    c.style.display = 'none';
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'liveempty';
      empty.innerHTML = ffIcon('image') + '<span>Your frame appears here as soon as there is something on the canvas.</span>';
      slot.appendChild(empty);
    }
    if (cap) cap.textContent = 'Nothing to preview yet';
    ffLiveShape(null);
    return;
  }
  if (empty) empty.remove();
  c.style.display = '';
  const x0 = Math.max(0, Math.min(...boxes.map(b => b.x))), y0 = Math.max(0, Math.min(...boxes.map(b => b.y)));
  const x1 = Math.min(doc.canvas.w, Math.max(...boxes.map(b => b.x + b.w))), y1 = Math.min(doc.canvas.h, Math.max(...boxes.map(b => b.y + b.h)));
  const box = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  const aspect = box.w / box.h;

  const cssW = aspect >= FF_LIVE_W / FF_LIVE_H ? FF_LIVE_W : FF_LIVE_H * aspect;
  const cssH = cssW / aspect;
  c.width = Math.max(1, Math.round(cssW * 2));
  c.height = Math.max(1, Math.round(cssH * 2));
  c.style.width = Math.round(cssW) + 'px';
  c.style.height = Math.round(cssH) + 'px';
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  const s = c.width / box.w;

  if (fr) {
    x.save();
    x.setTransform(s, 0, 0, s, -box.x * s, -box.y * s);
    x.clip(fr.publishMode === 'silhouette' && typeof _silhouettePath2D === 'function' ? _silhouettePath2D(fr) : ffPolyPath(fr.points));
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (typeof ffPxDrawPlaceholder === 'function') ffPxDrawPlaceholder(x, c.width, c.height);
    else { x.fillStyle = FF_UI.sky; x.fillRect(0, 0, c.width, c.height); }
    x.restore();
  }
  x.drawImage(art, box.x * k, box.y * k, box.w * k, box.h * k, 0, 0, c.width, c.height);

  const n = ffLiveOpenings().length;
  if (cap) cap.textContent = !fr ? 'No opening yet: nothing for a photo to drop into'
    : n > 1 ? 'Largest of ' + n + ' openings shown · a Pixopik frame holds one'
    : 'The sky shows where the photo goes';
  ffLiveShape(aspect);

  // an image still decoding draws as nothing; look again once it has
  const pending = doc.layers.some(l => FF_LIVE_ART.includes(l.type) && l.visible !== false && l.src &&
    !(imgCache.get(l.src) || {}).ready);
  if (pending && _ffLive.retries++ < 20) ffLiveSchedule();
}

/* "4:5 portrait" when the crop is a common shape, otherwise the number. */
function ffAspectLabel(a) {
  if (!(a > 0)) return '\u2014';
  if (Math.abs(a - 1) < 0.015) return '1:1 square';
  const pairs = [[4, 5], [3, 4], [2, 3], [9, 16], [5, 7], [1, 2]];
  for (const [p, q] of pairs) {
    if (Math.abs(a - p / q) / (p / q) < 0.015) return p + ':' + q + ' portrait';
    if (Math.abs(a - q / p) / (q / p) < 0.015) return q + ':' + p + ' landscape';
  }
  return a.toFixed(2) + (a < 1 ? ' portrait' : ' landscape');
}
function ffLiveShape(aspect) {
  const el = $('#stShape');
  if (!el) return;
  el.textContent = aspect ? ffAspectLabel(aspect) : '\u2014';
  el.closest('li').className = aspect ? 'ok' : '';
}

/* ---- status ---- */
function ffStatusHtml() {
  const mode = window.ffStudioMode;
  const overlays = doc.layers.filter(l => l.type === 'overlay' && l.visible !== false);
  const gen = overlays.find(l => l.frameDesignId);
  const art = overlays.find(l => !l.frameDesignId);
  const openings = ffLiveOpenings();
  const running = typeof ffDetect !== 'undefined' && ffDetect === 'running';
  const design = gen && typeof ffFrameDesign === 'function' ? ffFrameDesign(gen.frameDesignId) : null;

  const artText = gen ? (design ? design.label : 'Generated') + ' moulding'
    : art ? String(art.name || 'Frame image').replace(/\s*overlay$/i, '') : 'None yet';
  const openText = running ? 'Finding\u2026'
    : openings.length > 1 ? openings.length + ' openings'
    : openings.length ? openings[0].points.length + ' points'
    : 'Not set';
  const rows = [
    ['Mode', mode === 'generate' ? 'Generate' : mode === 'image' ? 'From image' : 'Not chosen', mode ? 'on' : ''],
    ['Artwork', artText, gen || art ? 'ok' : ''],
    ['Opening', openText, running ? 'on' : openings.length > 1 ? 'warn' : openings.length ? 'ok' : ''],
    ['Aspect', '\u2014', '', 'stShape'],
    ['Export', openings.length ? 'Ready' : 'Needs an opening', openings.length ? 'ok' : '']
  ];
  return `
    <div class="insp">
      <h2>Status</h2>
      <ul class="status">${rows.map(r => `<li class="${r[2]}"><i class="dot"></i><span>${r[0]}</span><b${r[3] ? ` id="${r[3]}"` : ''} title="${esc(r[1])}">${esc(r[1])}</b></li>`).join('')}</ul>
    </div>`;
}

function refreshProps() {
  const box = $('#right');
  const L = layer(sel);
  if (!L) {
    box.innerHTML = `
      ${ffLiveHtml()}
      ${ffStatusHtml()}
      <div class="insp">
        <div class="nextcard">${ffIcon('info')}<div class="note" id="nextTip">${ffNextTip()}</div></div>
      </div>
      <details class="fold">
        <summary>${ffIcon('settings')}Canvas settings</summary>
        <div class="insp">
          <div class="stack">
            <div class="row">
              <div class="field"><label for="cw">Width</label><input class="inp" type="number" id="cw" value="${doc.canvas.w}"></div>
              <div class="field"><label for="ch">Height</label><input class="inp" type="number" id="ch" value="${doc.canvas.h}"></div>
            </div>
            <div class="field"><label for="cbg">Background</label><input type="color" id="cbg" value="${doc.canvas.bg === 'transparent' ? '#ffffff' : doc.canvas.bg}"></div>
            <button class="btn sm" id="cbgT">Make background transparent</button>
            <div class="note">Export for Pixopik crops to the artwork and its opening, so the canvas size never needs to match the frame.</div>
          </div>
        </div>
      </details>`;
    $('#cw').onchange = (e) => { doc.canvas.w = clamp(+e.target.value || 1200, 50, 6000); sizePill(); sync(); };
    $('#ch').onchange = (e) => { doc.canvas.h = clamp(+e.target.value || 800, 50, 6000); sizePill(); sync(); };
    $('#cbg').oninput = (e) => { doc.canvas.bg = e.target.value; render(); };
    $('#cbgT').onclick = () => { doc.canvas.bg = 'transparent'; render(); toast('Background is now transparent'); };
    ffLiveMount();
    return;
  }

  const i = doc.layers.findIndex(l => l.id === L.id);
  let html = `
    <div class="sect">
      <div class="lhead"><div class="lic">${ffIcon(FF_LAYER_ICON[L.type] || 'layers')}</div><div><b>${esc(L.name)}</b><small>${TYPE_LABEL[L.type]}</small></div></div>
      <div class="stack">
        <div class="field"><label>Name</label><input class="inp" id="pname" value="${esc(L.name)}"></div>
        <div class="row">
          <button class="btn sm" id="up" ${i === doc.layers.length - 1 ? 'disabled' : ''}>↑ Forward</button>
          <button class="btn sm" id="down" ${i === 0 ? 'disabled' : ''}>↓ Backward</button>
        </div>
        <div class="row">
          <button class="btn sm" id="tvis">${L.visible ? 'Hide' : 'Show'}</button>
          <button class="btn sm" id="tlock">${L.locked ? 'Unlock' : 'Lock'}</button>
          <button class="btn sm danger" id="del">Delete</button>
        </div>
        <div class="field"><label>Opacity <span class="val" id="opv">${Math.round((L.opacity ?? 1) * 100)}%</span></label>
          <input type="range" id="op" min="0" max="100" value="${Math.round((L.opacity ?? 1) * 100)}"></div>
      </div>
    </div>`;

  if (L.type === 'frame') {
    const c0 = L.content;
    html += `
    <div class="sect">
      <h2>Frame</h2>
      <div class="stack">
        <div class="seg">
          <button class="chip ${L.frameType === 'rect' ? 'on' : ''}" id="fRect">Rectangle</button>
          <button class="chip ${L.frameType === 'perspective' ? 'on' : ''}" id="fPersp">Perspective</button>
        </div>
        <div class="note">Drag the corner points on the canvas. A photo is warped with a real homography, not stretched.</div>
        <div class="row"><button class="btn sm" id="addPt">+ Add point</button><button class="btn sm" id="resetQuad">Reset to rect</button></div>
        <details class="drawit"><summary>${L.points.length} points</summary><div>${L.points.map((p, n) => `<div class="kv"><span>P${n + 1}</span><b>${Math.round(p.x)}, ${Math.round(p.y)}</b></div>`).join('')}</div></details>
      </div>
    </div>
    <div class="sect">
      <h2>Image inside frame</h2>
      <div class="stack">
        <div class="row">
          <button class="btn sm primary" id="setImg">${c0 ? 'Replace image' : 'Set image'}</button>
          ${c0 ? '<button class="btn sm" id="clrImg">Remove</button>' : ''}
        </div>`;
    if (c0) {
      html += `
        <div class="row">
          <button class="chip ${contentEdit === L.id ? 'on' : ''}" id="ce">${contentEdit === L.id ? 'Content mode: ON' : 'Edit content'}</button>
          <button class="chip ${c0.fit === 'cover' ? 'on' : ''}" id="fit">${c0.fit === 'cover' ? 'Cover' : 'Contain'}</button>
        </div>
        <div class="field"><label>Zoom <span class="val">${c0.scale.toFixed(2)}×</span></label>
          <input type="range" id="cscale" min="5" max="600" value="${Math.round(c0.scale * 100)}"></div>
        <div class="field"><label>Rotate <span class="val">${c0.rotation}°</span></label>
          <input type="range" id="crot" min="-180" max="180" value="${c0.rotation}"></div>
        <div class="row">
          <div class="field"><label>Offset X</label><input class="inp" type="number" step="0.01" id="cox" value="${c0.offsetX.toFixed(2)}"></div>
          <div class="field"><label>Offset Y</label><input class="inp" type="number" step="0.01" id="coy" value="${c0.offsetY.toFixed(2)}"></div>
        </div>
        <button class="btn sm" id="cctr">Center &amp; fit</button>`;
    } else {
      html += `<div class="note">This frame is empty. Empty frames are shown as a dashed placeholder in the editor and are skipped on export — so a saved mockup stays reusable.</div>`;
    }
    html += `</div></div>`;
  } else if (L.type === 'image' || L.type === 'overlay') {
    html += `
    <div class="sect">
      <h2>Transform</h2>
      <div class="stack">
        <div class="row">
          <div class="field"><label>X</label><input class="inp" type="number" id="lx" value="${Math.round(L.x)}"></div>
          <div class="field"><label>Y</label><input class="inp" type="number" id="ly" value="${Math.round(L.y)}"></div>
        </div>
        <div class="row">
          <div class="field"><label>Width</label><input class="inp" type="number" id="lw" value="${Math.round(L.w)}"></div>
          <div class="field"><label>Height</label><input class="inp" type="number" id="lh" value="${Math.round(L.h)}"></div>
        </div>
        <div class="field"><label>Rotate <span class="val">${L.rotation || 0}°</span></label>
          <input type="range" id="lrot" min="-180" max="180" value="${L.rotation || 0}"></div>
        <div class="row"><button class="btn sm" id="lfill">Fit canvas</button><button class="btn sm" id="lreplace">Replace</button></div>
        ${L.type === 'overlay' ? '<div class="note">Keep overlays at the top of the layer list and locked, so the mockup body always covers the artwork.</div>' : ''}
      </div>
    </div>`;
  } else if (L.type === 'text') {
    html += `
    <div class="sect">
      <h2>Text</h2>
      <div class="stack">
        <div class="field"><label>Content</label><textarea class="inp" id="ttxt" rows="3">${esc(L.text)}</textarea></div>
        <div class="row">
          <div class="field"><label>Size</label><input class="inp" type="number" id="tsize" value="${L.size}"></div>
          <div class="field"><label>Weight</label>
            <select class="inp" id="tw">${[400, 500, 600, 700, 800].map(w => `<option ${L.weight == w ? 'selected' : ''}>${w}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>Color</label><input type="color" id="tcol" value="${L.color}"></div>
        <div class="field"><label>Rotate <span class="val">${L.rotation || 0}°</span></label>
          <input type="range" id="trot" min="-180" max="180" value="${L.rotation || 0}"></div>
      </div>
    </div>`;
  } else if (L.type === 'shape') {
    html += `
    <div class="sect">
      <h2>Shape</h2>
      <div class="stack">
        <div class="seg">
          <button class="chip ${L.shape === 'rect' ? 'on' : ''}" id="shR">Rect</button>
          <button class="chip ${L.shape === 'ellipse' ? 'on' : ''}" id="shE">Ellipse</button>
        </div>
        <div class="field"><label>Fill</label><input type="color" id="sfill" value="${L.fill}"></div>
        <div class="row">
          <div class="field"><label>Width</label><input class="inp" type="number" id="lw" value="${Math.round(L.w)}"></div>
          <div class="field"><label>Height</label><input class="inp" type="number" id="lh" value="${Math.round(L.h)}"></div>
        </div>
        <div class="field"><label>Corner radius <span class="val">${L.radius || 0}px</span></label>
          <input type="range" id="srad" min="0" max="120" value="${L.radius || 0}"></div>
      </div>
    </div>`;
  }
  /* An opening gets the two things a creator wants up front, and the
     preview; the layer and geometry controls are folded under Advanced. */
  if (L.type === 'frame') {
    const kind = L.publishMode === 'silhouette' ? 'Silhouette' : L.points.length === 4 ? '4 corner points' : L.points.length + ' points';
    html = `
    <div class="insp">
      <div class="lhead"><div class="lic">${ffIcon('rect')}</div><div><b>Opening</b><small>${kind} \u00b7 drag them on the canvas</small></div></div>
      <div class="row">
        <button class="btn sm primary" id="qPhoto">${ffIcon('photo')}${L.content ? 'Change photo' : 'Try a photo'}</button>
        <button class="btn sm danger" id="qDel">${ffIcon('trash')}Delete</button>
      </div>
    </div>
    ${ffLiveHtml()}
    <details class="fold"><summary>${ffIcon('settings')}Advanced</summary>${html}</details>`;
  } else {
    html = html.replace(/class="sect"/g, 'class="insp"');
  }
  box.innerHTML = html;
  if ($('#qPhoto')) $('#qPhoto').onclick = () => setImageFor(L);
  if ($('#qDel')) $('#qDel').onclick = () => removeLayer(L.id);
  ffLiveMount();
  bindProps(L);
}

function bindProps(L) {
  const on = (s, ev, fn) => { const el = $(s); if (el) el.addEventListener(ev, fn); };
  on('#pname', 'input', e => { L.name = e.target.value; refreshLayers(); });
  on('#up', 'click', () => moveLayer(L.id, 1));
  on('#down', 'click', () => moveLayer(L.id, -1));
  on('#tvis', 'click', () => { L.visible = !L.visible; sync(); });
  on('#tlock', 'click', () => { L.locked = !L.locked; sync(); });
  on('#del', 'click', () => removeLayer(L.id));
  on('#op', 'input', e => { L.opacity = +e.target.value / 100; $('#opv').textContent = e.target.value + '%'; render(); });

  // frame
  on('#fRect', 'click', () => { const b = bbox(L.points); L.points = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]; L.frameType = 'rect'; contentCache.clear(); sync(); });
  on('#resetQuad', 'click', () => { const b = bbox(L.points); L.points = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]; L.frameType = 'rect'; contentCache.clear(); sync(); });
  on('#fPersp', 'click', () => {
    const b = bbox(L.points);
    L.points = [{ x: b.x + b.w * 0.06, y: b.y + b.h * 0.04 }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w * 0.97, y: b.y + b.h }, { x: b.x, y: b.y + b.h * 0.94 }];
    L.frameType = 'perspective'; contentCache.clear(); sync();
  });
  on('#addPt', 'click', () => {
    const p = L.points, n = p.length;
    const mid = { x: (p[n - 1].x + p[0].x) / 2, y: (p[n - 1].y + p[0].y) / 2 };
    L.points = [...p, mid]; L.frameType = 'polygon'; contentCache.clear(); sync();
  });
  on('#setImg', 'click', () => setImageFor(L));
  on('#clrImg', 'click', () => { L.content = null; contentEdit = null; contentCache.clear(); sync(); });
  on('#ce', 'click', () => { contentEdit = contentEdit === L.id ? null : L.id; sync(); });
  on('#fit', 'click', () => { L.content.fit = L.content.fit === 'cover' ? 'contain' : 'cover'; contentCache.clear(); sync(); });
  on('#cscale', 'input', e => { L.content.scale = +e.target.value / 100; contentCache.clear(); render(); });
  on('#cscale', 'change', refreshProps);
  on('#crot', 'input', e => { L.content.rotation = +e.target.value; contentCache.clear(); render(); });
  on('#crot', 'change', refreshProps);
  on('#cox', 'change', e => { L.content.offsetX = +e.target.value || 0; contentCache.clear(); render(); });
  on('#coy', 'change', e => { L.content.offsetY = +e.target.value || 0; contentCache.clear(); render(); });
  on('#cctr', 'click', () => { Object.assign(L.content, { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 }); contentCache.clear(); sync(); });

  // image / overlay / shape
  on('#lx', 'change', e => { L.x = +e.target.value; render(); });
  on('#ly', 'change', e => { L.y = +e.target.value; render(); });
  on('#lw', 'change', e => { L.w = +e.target.value; render(); });
  on('#lh', 'change', e => { L.h = +e.target.value; render(); });
  on('#lrot', 'input', e => { L.rotation = +e.target.value; render(); });
  on('#lrot', 'change', refreshProps);
  on('#lfill', 'click', async () => {
    const m = await loadMeta(L.src);
    const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h);
    L.w = m.w * s; L.h = m.h * s; L.x = (doc.canvas.w - L.w) / 2; L.y = (doc.canvas.h - L.h) / 2;
    sync();
  });
  on('#lreplace', 'click', async () => {
    const f = await pickFile(); if (!f) return;
    L.src = f.src; const m = await loadMeta(f.src);
    const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h);
    L.w = m.w * s; L.h = m.h * s; sync();
  });

  // text
  on('#ttxt', 'input', e => { L.text = e.target.value; render(); });
  on('#tsize', 'change', e => { L.size = +e.target.value || 24; render(); });
  on('#tw', 'change', e => { L.weight = +e.target.value; render(); });
  on('#tcol', 'input', e => { L.color = e.target.value; render(); });
  on('#trot', 'input', e => { L.rotation = +e.target.value; render(); });

  // shape
  on('#shR', 'click', () => { L.shape = 'rect'; sync(); });
  on('#shE', 'click', () => { L.shape = 'ellipse'; sync(); });
  on('#sfill', 'input', e => { L.fill = e.target.value; render(); refreshLayers(); });
  on('#srad', 'input', e => { L.radius = +e.target.value; render(); });
}
