'use strict';
/* =========================================================================
   FrameForge Studio - 06-properties.js
   property panel binding and layer list
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* ---------------------------- properties ---------------------------- */
function refreshProps() {
  const box = $('#right');
  const L = layer(sel);
  if (!L) {
    box.innerHTML = `
      <div class="sect">
        <h2>Canvas</h2>
        <div class="stack">
          <div class="row">
            <div class="field"><label>Width</label><input class="inp" type="number" id="cw" value="${doc.canvas.w}"></div>
            <div class="field"><label>Height</label><input class="inp" type="number" id="ch" value="${doc.canvas.h}"></div>
          </div>
          <div class="field"><label>Background</label><input type="color" id="cbg" value="${doc.canvas.bg === 'transparent' ? '#ffffff' : doc.canvas.bg}"></div>
          <button class="btn sm" id="cbgT">Make background transparent</button>
        </div>
      </div>
      <div class="sect">
        <h2>How it works</h2>
        <div class="note">
          <b>1.</b> Add your mockup as <b>Mockup overlay</b> (screen area must be transparent).<br>
          <b>2.</b> Draw a <b>Rect</b> or <b>Perspective</b> frame over the screen.<br>
          <b>3.</b> Move the frame <b>below</b> the overlay with the ↓ order buttons.<br>
          <b>4.</b> Set an image in the frame, then drag / scroll to fit.<br>
          <b>5.</b> <b>Save as mockup</b> to reuse it later with any image.
        </div>
      </div>`;
    $('#cw').onchange = (e) => { doc.canvas.w = clamp(+e.target.value || 1200, 50, 6000); sizePill(); sync(); };
    $('#ch').onchange = (e) => { doc.canvas.h = clamp(+e.target.value || 800, 50, 6000); sizePill(); sync(); };
    $('#cbg').oninput = (e) => { doc.canvas.bg = e.target.value; render(); };
    $('#cbgT').onclick = () => { doc.canvas.bg = 'transparent'; render(); toast('Background is now transparent'); };
    return;
  }

  const i = doc.layers.findIndex(l => l.id === L.id);
  let html = `
    <div class="sect">
      <h2>${TYPE_LABEL[L.type]}</h2>
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
        <div class="row">
          <button class="chip ${L.frameType === 'rect' ? 'on' : ''}" id="fRect">Rectangle</button>
          <button class="chip ${L.frameType === 'perspective' ? 'on' : ''}" id="fPersp">Perspective</button>
        </div>
        <div class="note">Drag the 4 corner handles on the canvas. The image is warped with a real homography transform — not a stretched rectangle.</div>
        <div class="row"><button class="btn sm" id="addPt">+ Add point</button><button class="btn sm" id="resetQuad">Reset to rect</button></div>
        <div>${L.points.map((p, n) => `<div class="kv"><span>P${n + 1}</span><b>${Math.round(p.x)}, ${Math.round(p.y)}</b></div>`).join('')}</div>
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
        <div class="row">
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
  box.innerHTML = html;
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
