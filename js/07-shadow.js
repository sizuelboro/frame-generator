'use strict';
/* =========================================================================
   FrameForge Studio - 07-shadow.js
   shadow layer, export, fit-canvas, cloud publish, bleed
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* =========================================================================
   ADD / FILE ACTIONS
   ========================================================================= */
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => actions[b.dataset.act]()));

let ffShadowStrength = 0.35;

/* ---------------- shadow layer (natural light on the artwork) ----------------
   A shadow layer is pure black with a derived alpha channel. It sits above the
   drop-target frame, so whatever the buyer drops in is tinted by it and the
   mockup reads as real room light.

   Alpha is hard-capped below the 128 "this pixel is artwork" threshold used by
   detectOpening() and the auto-bleed alpha map, so a shadow can never be
   mistaken for a frame border. */
const SHADOW_MAX_ALPHA = 115;
/* A shadow harvested from an AI scene is a measurement of real light, not a
   decorative drop shadow, so flattening it to 115 throws away most of the
   depth the model actually rendered. The opening is already known by then,
   so the "never look like a border" ceiling does not apply and it gets its
   own, much higher cap. */
const SHADOW_SCENE_MAX_ALPHA = 230;
async function buildShadowSource(src, strength, maxAlpha) {
  const img = await loadImg(src);
  const w = Math.max(1, img.naturalWidth), h = Math.max(1, img.naturalHeight);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const im = x.getImageData(0, 0, w, h), d = im.data, n = w * h;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) clear++;
  const useAlpha = clear > n * 0.02;            // already a transparent shadow PNG
  let reference = 255;
  if (!useAlpha) {
    // Treat the brightest part of the plate as "no shadow" so a light wall does
    // not tint the whole artwork. 95th percentile ignores specular highlights.
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[Math.min(255, Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]))]++;
    let seen = 0; const target = n * 0.95;
    for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= target) { reference = Math.max(1, v); break } }
  }
  const lid = Math.max(1, Math.min(255, maxAlpha || SHADOW_MAX_ALPHA));
  const cap = Math.round(lid * Math.max(0, Math.min(1, strength / 0.45)));
  for (let i = 0; i < d.length; i += 4) {
    let amount;
    if (useAlpha) amount = d[i + 3] / 255;
    else { const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; amount = Math.max(0, Math.min(1, (reference - lum) / reference)); }
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = Math.min(lid, Math.round(amount * cap));
  }
  x.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}
function shadowLayer() {
  const picked = doc.layers.find(L => L.id === sel && L.type === 'shadow');
  if (picked) return picked;
  const all = doc.layers.filter(L => L.type === 'shadow');
  return all[all.length - 1] || null;
}
async function restyleShadowLayer(L, strength) {
  L.strength = Math.max(0.02, Math.min(0.45, strength));
  L.shadowSrc = await buildShadowSource(L.src, L.strength, L.maxAlpha);
  contentCache.clear(); sync(); updateShadowButton();
}
function updateShadowButton() {
  const button = $('#btnShadowStrength');
  if (button) button.textContent = `Shadow: ${Math.round(ffShadowStrength * 100)}%`;
}

const actions = {
  async addImage() {
    const f = await pickFile(); if (!f) return;
    const m = await loadMeta(f.src);
    const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h, 1);
    addLayerTop({ id: uid(), type: 'image', name: f.name.replace(/\.[^.]+$/, '') || 'Image', visible: true, locked: false, opacity: 1,
      src: f.src, x: (doc.canvas.w - m.w * s) / 2, y: (doc.canvas.h - m.h * s) / 2, w: m.w * s, h: m.h * s, rotation: 0 });
  },
  async addShadow() {
    const f = await pickFile(); if (!f) return;
    const raw = await uiPrompt('Shadow strength', String(Math.round(ffShadowStrength * 100)), 'Percent of light the shadow removes (5-45). Dark areas of the image become shadow; the brightest area stays clear.');
    if (raw == null) return;
    const strength = Math.max(0.02, Math.min(0.45, (parseFloat(raw) || 35) / 100));
    ffShadowStrength = strength;
    const m = await loadMeta(f.src);
    const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h);
    const shadowSrc = await buildShadowSource(f.src, strength);
    addLayerTop({ id: uid(), type: 'shadow', name: f.name.replace(/\.[^.]+$/, '') || 'Shadow', visible: true, locked: true, opacity: 1,
      src: f.src, shadowSrc, strength, x: (doc.canvas.w - m.w * s) / 2, y: (doc.canvas.h - m.h * s) / 2, w: m.w * s, h: m.h * s, rotation: 0 });
    updateShadowButton();
    toast(`Shadow layer added at ${Math.round(strength * 100)}% and locked on top`);
  },
  async addOverlay() {
    const f = await pickFile(); if (!f) return;
    const m = await loadMeta(f.src);
    const s = Math.min(doc.canvas.w / m.w, doc.canvas.h / m.h);
    addLayerTop({ id: uid(), type: 'overlay', name: f.name.replace(/\.[^.]+$/, '') || 'Mockup overlay', visible: true, locked: true, opacity: 1,
      src: f.src, x: (doc.canvas.w - m.w * s) / 2, y: (doc.canvas.h - m.h * s) / 2, w: m.w * s, h: m.h * s, rotation: 0 });
    toast('Overlay added and locked on top');
  }
};

function sizePill() { $('#sizePill').textContent = `${doc.canvas.w} × ${doc.canvas.h}`; }

function download(blobOrUrl, name) {
  const a = document.createElement('a');
  a.download = name;
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.click();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportCanvas(opts) {
  const scale = opts.scale || 2;
  const off = document.createElement('canvas');
  off.width = Math.round(doc.canvas.w * scale);
  off.height = Math.round(doc.canvas.h * scale);
  const c = off.getContext('2d');
  contentCache.clear();
  render(c, { scale, chrome: false, quality: 'export', only: opts.only || null, bg: opts.bg !== false });
  contentCache.clear();
  render();
  return off;
}

/* Tighten the document around visible overlay pixels and frame geometry. */
$('#btnFitCanvas').onclick = async () => {
  const overlays = doc.layers.filter(l => l.visible && l.type === 'overlay');
  const frames = doc.layers.filter(l => l.visible && l.type === 'frame');
  if (!overlays.length) { toast('Add a transparent mockup overlay first'); return; }

  const pad = await uiNumber({
    title: 'Trim canvas to mockup',
    message: 'Trims the document to the visible overlay pixels and frame geometry.',
    label: 'Padding around mockup (canvas pixels)',
    value: 20, min: 0, max: 300, step: 1,
    hint: 'Keeps a margin so the overlay edge is not clipped.',
    confirmLabel: 'Trim canvas',
  });
  if (pad == null) return;

  const off = exportCanvas({ scale: 1, only: ['overlay'], bg: false });
  const pixels = off.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, off.width, off.height).data;
  let minX = off.width, minY = off.height, maxX = -1, maxY = -1;
  for (let y = 0; y < off.height; y++) {
    for (let x = 0; x < off.width; x++) {
      if (pixels[(y * off.width + x) * 4 + 3] > 3) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  frames.forEach(f => f.points.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }));
  if (maxX < minX || maxY < minY) { toast('No visible mockup pixels found'); return; }

  const x0 = Math.max(0, Math.floor(minX - pad));
  const y0 = Math.max(0, Math.floor(minY - pad));
  const x1 = Math.min(doc.canvas.w, Math.ceil(maxX + 1 + pad));
  const y1 = Math.min(doc.canvas.h, Math.ceil(maxY + 1 + pad));
  const newW = Math.max(8, x1 - x0), newH = Math.max(8, y1 - y0);
  if (newW === doc.canvas.w && newH === doc.canvas.h && x0 === 0 && y0 === 0) {
    toast('Canvas is already fitted'); return;
  }

  doc.layers.forEach(l => {
    if (l.type === 'frame') l.points.forEach(p => { p.x -= x0; p.y -= y0; });
    else { if (typeof l.x === 'number') l.x -= x0; if (typeof l.y === 'number') l.y -= y0; }
  });
  doc.canvas.w = newW;
  doc.canvas.h = newH;
  contentCache.clear();
  sizePill();
  fit();
  sync();
  toast(`Canvas fitted to ${newW} × ${newH} with ${pad}px padding`);
};

/* Cloudflare Worker/R2 live Canva library publishing. */
const FF_WORKER_URL_KEY = 'frameforge.cloudflareWorkerUrl';
const FF_WORKER_TOKEN_KEY = 'frameforge.cloudflareAdminToken';
const FF_OPENING_BLEED_KEY = 'frameforge.openingBleed';
const ffSavedOpeningBleed = localStorage.getItem(FF_OPENING_BLEED_KEY);
let ffOpeningBleed = ffSavedOpeningBleed == null ? 6 : Math.max(0, Math.min(20, Number(ffSavedOpeningBleed) || 0));

function polygonSignedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/* Constant-distance polygon expansion. The Canva image extends beneath the
   opaque overlay, hiding antialiasing gaps without changing the artwork. */
function makeOverlayAlphaMap(canvas = null) {
  try {
    const c = canvas || exportCanvas({ scale: 1, only: ['overlay'], bg: false });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    return {
      data: ctx.getImageData(0, 0, c.width, c.height).data,
      w: c.width,
      h: c.height,
      sx: c.width / doc.canvas.w,
      sy: c.height / doc.canvas.h
    };
  } catch (error) {
    console.warn('Auto-safe bleed could not inspect overlay alpha', error);
    return null;
  }
}

function overlayAlphaAt(map, x, y) {
  if (!map) return 0;
  const cx = Math.round(x * map.sx), cy = Math.round(y * map.sy);
  const rx = Math.max(1, Math.round(map.sx)), ry = Math.max(1, Math.round(map.sy));
  let total = 0, count = 0;
  for (let yy = cy - ry; yy <= cy + ry; yy++) {
    for (let xx = cx - rx; xx <= cx + rx; xx++) {
      if (xx < 0 || yy < 0 || xx >= map.w || yy >= map.h) continue;
      total += map.data[(yy * map.w + xx) * 4 + 3];
      count++;
    }
  }
  return count ? total / count : 0;
}

function openingWithBleed(points, bleed = ffOpeningBleed, alphaMap = null) {
  if (!points || points.length < 3 || !(bleed > 0)) return (points || []).map(p => ({ x: p.x, y: p.y }));
  const orientation = polygonSignedArea(points) >= 0 ? 1 : -1;
  const normal = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return orientation > 0 ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
  };
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const n0 = normal(p0, p1), n1 = normal(p1, p2);
    let bx = n0.x + n1.x, by = n0.y + n1.y;
    const bl = Math.hypot(bx, by);
    if (bl < 0.0001) { bx = n1.x; by = n1.y; }
    else { bx /= bl; by /= bl; }
    const dot = Math.max(0.34, bx * n1.x + by * n1.y);
    const targetDistance = Math.min(bleed / dot, bleed * 2.8);
    let distance = alphaMap ? targetDistance : 0;

    /* Follow this vertex's outward bisector through the rendered overlay.
       Once an opaque border is found, stop before its outer transparent edge.
       Thin borders therefore get a small bleed; thick borders get the full value. */
    if (alphaMap) {
      const step = 0.5;
      let enteredBorder = false, lastCovered = 0, clearRun = 0;
      for (let d = step; d <= targetDistance + 0.001; d += step) {
        const alpha = overlayAlphaAt(alphaMap, p1.x + bx * d, p1.y + by * d);
        if (alpha >= 105) {
          enteredBorder = true;
          lastCovered = d;
          clearRun = 0;
        } else if (enteredBorder) {
          clearRun += step;
          if (clearRun >= 1.5) break;
        }
      }
      if (enteredBorder) distance = Math.min(targetDistance, Math.max(0.5, lastCovered - 0.75));
      else distance = 0;
    }

    out.push({
      x: Math.max(0, Math.min(doc.canvas.w, p1.x + bx * distance)),
      y: Math.max(0, Math.min(doc.canvas.h, p1.y + by * distance))
    });
  }
  return out;
}

if ($('#btnShadowStrength')) $('#btnShadowStrength').onclick = async () => {
  const L = shadowLayer();
  if (!L) { toast('Add a shadow layer first (Add · Shadow layer)'); return; }
  const raw = await uiPrompt('Shadow strength', String(Math.round((L.strength || ffShadowStrength) * 100)), 'Percent of light the shadow removes (5-45). Higher looks stronger; the cap keeps the opening detectable.');
  if (raw == null) return;
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) { toast('Enter a number from 5 to 45'); return; }
  ffShadowStrength = Math.max(0.02, Math.min(0.45, value / 100));
  await restyleShadowLayer(L, ffShadowStrength);
  toast(`Shadow rebuilt at ${Math.round(ffShadowStrength * 100)}%`);
};

function updateOpeningBleedButton() {
  const button = $('#btnOpeningBleed');
  if (button) button.textContent = `Auto bleed: ${ffOpeningBleed}px`;
}
updateOpeningBleedButton();
updateShadowButton();
if ($('#btnOpeningBleed')) $('#btnOpeningBleed').onclick = async () => {
  const value = await uiNumber({
    title: 'Auto-safe bleed',
    message: 'This is a maximum, not a forced amount. FrameForge measures overlay opacity along every opening vertex and automatically uses less bleed on thin borders.',
    label: 'Maximum bleed (pixels)',
    value: ffOpeningBleed, min: 0, max: 20, step: 0.5,
    hint: '6px suits most borders. Try 8px for rough or torn edges.',
  });
  if (value == null) return;
  ffOpeningBleed = Math.round(Math.max(0, Math.min(20, value)) * 10) / 10;
  localStorage.setItem(FF_OPENING_BLEED_KEY, String(ffOpeningBleed));
  updateOpeningBleedButton();
  toast(`Auto-safe bleed max set to ${ffOpeningBleed}px · thin borders will use less`);
};

function framePath(points, smooth) {
  if (!points || points.length < 3) return '';
  const n = v => String(Math.round(Number(v) * 10) / 10);
  if (!smooth) return 'M ' + n(points[0].x) + ' ' + n(points[0].y) + ' ' + points.slice(1).map(p => 'L ' + n(p.x) + ' ' + n(p.y)).join(' ') + ' Z';
  // Safe corner-aware smoothing: sharp silhouette details stay as lines;
  // only locally smooth runs receive short cubic handles. Unlike unrestricted
  // Catmull-Rom this cannot throw long loops across narrow hair/arm contours.
  const reduceOne = src => {
    if(src.length<=16)return src;
    let at=0,best=Infinity;
    for(let i=0;i<src.length;i++){
      const a=src[(i-1+src.length)%src.length],b=src[i],c=src[(i+1)%src.length];
      const area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
      const span=Math.hypot(c.x-a.x,c.y-a.y)||1;
      const score=area*span;
      if(score<best){best=score;at=i}
    }
    return src.filter((_,i)=>i!==at);
  };
  const tangent = (pts,i) => {
    const a=pts[(i-1+pts.length)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];
    const d1=Math.hypot(b.x-a.x,b.y-a.y),d2=Math.hypot(c.x-b.x,c.y-b.y);
    if(d1<.01||d2<.01)return{x:0,y:0};
    const u1={x:(b.x-a.x)/d1,y:(b.y-a.y)/d1},u2={x:(c.x-b.x)/d2,y:(c.y-b.y)/d2};
    const dot=u1.x*u2.x+u1.y*u2.y;
    if(dot<.72)return{x:0,y:0}; // preserve corners, tips and narrow cuts
    const tx=u1.x+u2.x,ty=u1.y+u2.y,tl=Math.hypot(tx,ty)||1;
    const amount=Math.min(d1,d2)*.16*Math.min(1,(dot-.72)/.28);
    return{x:tx/tl*amount,y:ty/tl*amount};
  };
  const curve = pts => {
    const out=['M'+n(pts[0].x)+' '+n(pts[0].y)];
    for(let i=0;i<pts.length;i++){
      const a=pts[i],b=pts[(i+1)%pts.length],ta=tangent(pts,i),tb=tangent(pts,(i+1)%pts.length);
      if((Math.abs(ta.x)+Math.abs(ta.y)<.01)||(Math.abs(tb.x)+Math.abs(tb.y)<.01))out.push('L'+n(b.x)+' '+n(b.y));
      else out.push('C'+n(a.x+ta.x)+' '+n(a.y+ta.y)+' '+n(b.x-tb.x)+' '+n(b.y-tb.y)+' '+n(b.x)+' '+n(b.y));
    }
    return out.join('')+'Z';
  };
  let pts=points.slice(),path=curve(pts);
  // Simplify to a little under the budget so later encoding stays safe.
  const target=FF_LIMITS.PATH_BUDGET-80;
  while(new TextEncoder().encode(path).length>target&&pts.length>16){pts=reduceOne(pts);path=curve(pts)}
  return path;
}
async function cloudLibraryConfig(force) {
  let base = localStorage.getItem(FF_WORKER_URL_KEY) || '';
  let token = sessionStorage.getItem(FF_WORKER_TOKEN_KEY) || '';
  if (!force && base && token) return { base, token };

  const result = await uiForm({
    title: 'Cloud library settings',
    message: 'FrameForge publishes frames to your own Cloudflare Worker and R2 bucket.',
    confirmLabel: 'Save settings',
    fields: [
      {
        name: 'base', label: 'Cloudflare Worker URL', type: 'url', value: base,
        placeholder: 'https://frameforge-library.YOUR-SUBDOMAIN.workers.dev',
        hint: 'Remembered in this browser.',
      },
      {
        name: 'token', label: 'Admin token', type: 'password', value: token,
        placeholder: 'Paste your ADMIN_TOKEN',
        hint: 'Kept for this tab only, never written to disk. Do not share it with buyers.',
      },
    ],
    validate: (values) => {
      const url = values.base.replace(/\/+$/, '');
      if (!/^https:\/\//i.test(url) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(url)) {
        return 'Enter an HTTPS Worker URL (http://localhost is allowed for development).';
      }
      if (!values.token) return 'The admin token is required to publish or delete frames.';
      return null;
    },
  });
  if (result == null) return null;

  base = result.base.replace(/\/+$/, '');
  token = result.token;
  localStorage.setItem(FF_WORKER_URL_KEY, base);
  sessionStorage.setItem(FF_WORKER_TOKEN_KEY, token);
  return { base, token };
}
$('#btnLibrarySettings').onclick = async () => {
  const config = await cloudLibraryConfig(true);
  if (config) toast('Cloud library settings saved');
};
async function cloudLibraryData(config){const response=await fetch(config.base+'/api/frames',{cache:'no-store'}),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data}
function cloudFolderPicker(data,config){return new Promise(resolve=>{
  let folders=Array.isArray(data.folders)?data.folders.slice():[],selectedId=localStorage.getItem('frameforge.lastFolderId')||'';
  if(selectedId&&!folders.some(x=>x.id===selectedId))selectedId='';
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node};
  const back=el('div','ff-folder-backdrop'),card=el('section','ff-folder-dialog');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-labelledby','ff-folder-title');
  const head=el('div','ff-folder-head'),titles=el('div','ff-folder-titles'),eyebrow=el('div','ff-folder-eyebrow','FRAMEFORGE'),title=el('h2','', 'Choose publish folder');title.id='ff-folder-title';const sub=el('p','', 'Select where this frame or batch should appear in Canva.');titles.append(eyebrow,title,sub);const close=el('button','ff-folder-icon','×');close.type='button';close.setAttribute('aria-label','Cancel');head.append(titles,close);
  const list=el('div','ff-folder-list'),createWrap=el('div','ff-folder-create'),newButton=el('button','ff-folder-new','＋ New folder'),fieldRow=el('div','ff-folder-fieldrow'),field=el('input','ff-folder-input'),add=el('button','ff-folder-add','Create');field.type='text';field.maxLength=80;field.placeholder='Folder name';field.setAttribute('aria-label','New folder name');fieldRow.append(field,add);createWrap.append(newButton,fieldRow);
  const error=el('div','ff-folder-error');error.setAttribute('role','alert');
  const actions=el('div','ff-folder-actions'),cancel=el('button','ff-folder-secondary','Cancel'),use=el('button','ff-folder-primary','Use folder');cancel.type=use.type='button';actions.append(cancel,use);
  card.append(head,list,createWrap,error,actions);back.append(card);document.body.append(back);
  const selected=()=>selectedId?(folders.find(x=>x.id===selectedId)||null):{id:'',name:'Uncategorized'};
  const render=()=>{list.textContent='';const rows=[{id:'',name:'Uncategorized',builtin:true},...folders];for(const folder of rows){const row=el('button','ff-folder-row'+(folder.id===selectedId?' selected':''));row.type='button';row.dataset.folderId=folder.id;const icon=el('span','ff-folder-row-icon',folder.builtin?'⌂':'▰'),label=el('span','ff-folder-row-label',folder.name),check=el('span','ff-folder-check',folder.id===selectedId?'✓':'');row.append(icon,label,check);row.onclick=()=>{selectedId=folder.id;render()};list.append(row)}};
  const finish=value=>{document.removeEventListener('keydown',onKey);back.remove();resolve(value)};
  const onKey=e=>{if(e.key==='Escape')finish(null)};document.addEventListener('keydown',onKey);close.onclick=cancel.onclick=()=>finish(null);back.onmousedown=e=>{if(e.target===back)finish(null)};
  use.onclick=()=>{const folder=selected();if(!folder)return;localStorage.setItem('frameforge.lastFolderId',folder.id);finish({id:folder.id,name:folder.name,data:{...data,folders}})};
  newButton.onclick=()=>{fieldRow.classList.add('show');newButton.style.display='none';field.focus()};
  const create=async()=>{const name=field.value.trim();if(!name)return;error.textContent='';add.disabled=true;add.textContent='Creating…';try{const response=await fetch(config.base+'/api/folders',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+config.token},body:JSON.stringify({name})}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);if(!result.folder||!result.folder.id)throw new Error('Worker did not return the created folder');folders=Array.isArray(result.folders)?result.folders:[...folders,result.folder];selectedId=result.folder.id;field.value='';fieldRow.classList.remove('show');newButton.style.display='';render()}catch(e){error.textContent=String(e.message||e)}finally{add.disabled=false;add.textContent='Create'}};
  add.onclick=create;field.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();create()}};render();setTimeout(()=>{const active=list.querySelector('.selected');if(active)active.focus();else list.querySelector('button')?.focus()},0);
})}
/* preloaded lets a caller reuse a manifest it already fetched, so publishing
   reads /api/frames once for both the name check and this picker. */
async function cloudChooseFolder(config,preloaded){const data=preloaded||await cloudLibraryData(config);if(data.folderSystem!==true)throw new Error('Worker v7.0 is required for folders');return cloudFolderPicker(data,config)}

/* ---------------- publish names never replace an existing entry ----------------
   The Worker keys an entry on slug(id || name), so re-publishing a name that
   already exists used to overwrite that entry in place and orphan the assets
   the old one was still using. A mistyped or repeated name silently destroyed
   published work. Publishing is now create-only and a busy name is numbered
   instead - "Floral Arch", "Floral Arch 2", "Floral Arch 3" - so everything
   ever published stays reachable in the Canva app. Bulk publish has always
   worked this way; these helpers mirror bulkSlug/bulkUniqueName for the
   single-frame path, which keeps the full 120-character name limit. */
const FF_PUBLISH_NAME_MAX = 120;
function cloudPublishSlug(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function cloudUniquePublishName(base, usedSlugs) {
  const clip = v => String(v).slice(0, FF_PUBLISH_NAME_MAX).trim();
  const wanted = clip(String(base || '').trim()) || 'New Mockup Frame';
  if (!usedSlugs.has(cloudPublishSlug(wanted))) return wanted;
  // "Arch 2" must become "Arch 3", not "Arch 2 2".
  const numbered = wanted.match(/^(.*\S)\s+(\d+)$/);
  let root = wanted, next = 2;
  if (numbered && cloudPublishSlug(numbered[1])) { root = numbered[1]; next = Number(numbered[2]) + 1; }
  for (let n = next; n < next + 500; n++) {
    const suffix = ' ' + n;
    const candidate = clip(root.slice(0, Math.max(1, FF_PUBLISH_NAME_MAX - suffix.length)).trim() + suffix);
    if (!usedSlugs.has(cloudPublishSlug(candidate))) return candidate;
  }
  const stamp = ' ' + new Date().toISOString().slice(0, 10) + '-' + String(Date.now()).slice(-4);
  return clip(root.slice(0, Math.max(1, FF_PUBLISH_NAME_MAX - stamp.length)).trim() + stamp);
}
const FF_PUBLISH_RETRIES = 6;
$('#btnPublishCloud').onclick = async () => {
  const all=doc.layers.filter(l=>l.visible&&l.type==='frame'),chosen=sel?layer(sel):null;
  const silhouettes=all.filter(f=>f.publishMode==='silhouette'),overlays=doc.layers.filter(l=>l.visible&&l.type==='overlay');
  const silhouetteMode=!!(chosen&&chosen.type==='frame'&&chosen.publishMode==='silhouette')||(!overlays.length&&silhouettes.length>0);
  const frames=silhouetteMode?[chosen&&chosen.publishMode==='silhouette'?chosen:silhouettes[0]]:all.filter(f=>f.publishMode!=='silhouette');
  if(!frames.length){toast('Create or select a frame first');return}if(!silhouetteMode&&!overlays.length){toast('Add a transparent overlay, or select a Silhouette Frame');return}
  const config=await cloudLibraryConfig(false);if(!config)return;
  /* One manifest read powers the live name check and the folder picker. A
     failed read is not fatal: the Worker is the real guard, because the
     publish below is create-only. */
  let library=null,libraryError=null;
  try{library=await cloudLibraryData(config)}catch(e){libraryError=e}
  const existing=new Map();
  if(library&&Array.isArray(library.frames))for(const entry of library.frames){const key=cloudPublishSlug(entry.id||entry.name);if(key&&!existing.has(key))existing.set(key,entry)}
  const usedSlugs=new Set(existing.keys());
  const named=await uiForm({title:'Publish to your Canva library',message:'A new library entry is always created. An existing frame is never replaced.',confirmLabel:'Publish',fields:[{name:'name',label:'Name shown in the Canva app',value:localStorage.getItem('frameforge.lastPublishName')||'New Mockup Frame',placeholder:'Floral Arch 01',hint:'A name that is already taken is numbered automatically, so the older frame stays in the library.',liveHint:value=>{
    if(!value)return null;
    if(libraryError)return{text:'Could not read the library · publishing still never replaces an entry.',tone:'warn'};
    if(!cloudPublishSlug(value))return{text:'Use at least one letter or number.',tone:'error'};
    const hit=existing.get(cloudPublishSlug(value));
    if(!hit)return{text:'✓ Free · this creates a new entry.',tone:'ok'};
    const when=hit.updatedAt?new Date(hit.updatedAt).toLocaleDateString():'';
    return{text:`⚠ “${hit.name}” already exists${when?' · '+when:''} · this publishes as “${cloudUniquePublishName(value,usedSlugs)}” and keeps the old one.`,tone:'warn'};
  }}],validate:v=>!v.name.trim()?'Enter a name for this frame.':(cloudPublishSlug(v.name)?null:'Use at least one letter or number in the name.')});
  if(!named)return;const name=named.name.trim();localStorage.setItem('frameforge.lastPublishName',name);let folder;try{folder=await cloudChooseFolder(config,library)}catch(e){toast('Folder error: '+String(e.message||e));return}if(!folder)return;
  const alphaMap=silhouetteMode?null:makeOverlayAlphaMap();if(!silhouetteMode&&!alphaMap&&ffOpeningBleed>0)toast('Overlay alpha could not be inspected · publishing without bleed');
  const paths=frames.flatMap(f=>silhouetteMode?((f.pathDs&&f.pathDs.length)?f.pathDs:[f.pathD||framePath(f.points,true)]):[framePath(openingWithBleed(f.points,ffOpeningBleed,alphaMap),false)]).filter(Boolean),overlayPath=silhouetteMode?'':`M 0 0 H ${doc.canvas.w} V ${doc.canvas.h} H 0 Z`,multiElement=!!(silhouetteMode&&frames[0].multiElement&&paths.length>1),smartMask=!!(silhouetteMode&&frames[0].smartMask&&frames[0].smartMaskDataUrl);
  const byteSizes=paths.map(p=>new TextEncoder().encode(p).length),bytes=new TextEncoder().encode([overlayPath,...paths].join('')).length,total=paths.length+(silhouetteMode?0:1);
  // Exact-multi publishes each path as its own Canva shape element, so the
  // budget applies per shape, not to the combined string. Single-shape frames
  // still share one combined budget.
  //
  // Budgets come from FF_LIMITS (generated from shared/frameforge-limits.js)
  // so the Studio, the Worker and the Canva app can never disagree. The
  // Studio used to accept frames the Worker then rejected.
  const overBudget=multiElement?byteSizes.some(b=>b>FF_PATH_BUDGET):bytes>FF_PATH_BUDGET,maxPaths=multiElement?FF_MAX_PATHS_MULTI:FF_MAX_PATHS_SINGLE;
  // Enclosed holes are bridged into their outer ring and then verified. Any
  // that still read as solid are reported here and recorded on the cloud
  // entry, so the Canva app can warn instead of inserting a wrong frame.
  const unbridgedHoles=silhouetteMode?frames.reduce((n,f)=>n+(f.unbridgedHoles||0),0):0;
  const tracedHoles=silhouetteMode?frames.reduce((n,f)=>n+(f.tracedHoles||0),0):0;
  if(unbridgedHoles>0)toast(`${unbridgedHoles} of ${tracedHoles} enclosed hole(s) cannot be cut natively and will publish filled · use Smart Mask for an exact cut-out`);
  else if(tracedHoles>0)toast(`${tracedHoles} enclosed hole(s) bridged and verified`);
  if(!smartMask&&(paths.length>maxPaths||overBudget)){toast(multiElement?`Native Canva path budget exceeded: largest object is ${Math.max(...byteSizes)}/${FF_PATH_BUDGET} safe bytes across ${paths.length}/${maxPaths} objects · simplify the artwork`:`Native Canva path budget exceeded: ${bytes}/${FF_PATH_BUDGET} safe bytes · simplify the artwork`);return}
  const button=$('#btnPublishCloud'),text=button.textContent;button.disabled=true;button.textContent='Publishing…';
  try{const off=silhouetteMode?silhouetteThumbnail(frames):exportCanvas({scale:2,only:['overlay','shadow'],bg:false});const blank=silhouetteMode?silhouetteTransparentOverlay():null,overlayImageData=silhouetteMode?(frames[0].detailOverlayDataUrl||(blank&&blank.toDataURL('image/png'))):undefined;
    const payload={mode:smartMask?'smart-mask':(silhouetteMode?'silhouette':'overlay'),name:cloudUniquePublishName(name,usedSlugs),folderId:folder.id,createOnly:true,w:doc.canvas.w,h:doc.canvas.h,assetWidth:silhouetteMode?doc.canvas.w:off.width,assetHeight:silhouetteMode?doc.canvas.h:off.height,paths:smartMask?[]:paths,multiElement:smartMask?false:multiElement,unbridgedHoles:smartMask?0:unbridgedHoles,smartMask,maskImageData:smartMask?frames[0].smartMaskDataUrl:undefined,imageData:off.toDataURL('image/png'),overlayImageData};
    let response=null,result={};
    /* createOnly means the Worker answers 409 instead of overwriting. Another
       tab or a stale manifest can take a name between the check and the POST,
       so take the next free number and try again rather than failing. */
    for(let attempt=0;attempt<FF_PUBLISH_RETRIES;attempt++){
      response=await fetch(config.base+'/api/frames',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+config.token},body:JSON.stringify(payload)});
      result=await response.json().catch(()=>({}));
      if(response.status===429){const waitMs=Math.min(90000,(Number(response.headers.get('retry-after'))||60)*1000);toast(`Worker rate limit reached · retrying “${payload.name}” in ${Math.ceil(waitMs/1000)}s`);await new Promise(r=>setTimeout(r,waitMs));continue}
      if(response.status===409&&result.code==='NAME_EXISTS'){usedSlugs.add(cloudPublishSlug(payload.name));payload.name=cloudUniquePublishName(name,usedSlugs);continue}
      break;
    }
    if(!response||!response.ok)throw new Error(result.error||`HTTP ${response?response.status:'error'}`);
    if(response.status!==201)throw new Error('Worker did not confirm a no-overwrite create');
    const renamed=payload.name!==name;
    toast(`${payload.name} published to ${folder.name}${renamed?` · “${name}” was taken, that frame was left untouched`:''} as ${silhouetteMode?(multiElement?('exact multi-element silhouette · '+paths.length+' aligned frames'):(frames[0].detailOverlayDataUrl?'smart silhouette + detail overlay':'one silhouette drop target')):'overlay frame'} · ${result.count} frame(s) in library`)}catch(e){toast('Publish failed: '+String(e.message||e))}finally{button.disabled=false;button.textContent=text}
};
