'use strict';
/* =========================================================================
   FrameForge Studio - 08-bulk.js
   bulk publish, saved mockups, zoom, drag & drop, demo scene
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* ---------------- bulk 100 auto-rename + folders v7.0 ---------------- */
function bulkReadFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('Could not read file'));r.readAsDataURL(file)})}
function bulkBaseName(name){return String(name||'Untitled').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim().slice(0,90)||'Untitled'}
function bulkSlug(value){return String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)}
function bulkUniqueName(base,used){base=bulkBaseName(base);if(!bulkSlug(base))base='Item';let n=1,candidate=base;while(!bulkSlug(candidate)||used.has(bulkSlug(candidate))){n++;const suffix=' '+n;candidate=base.slice(0,Math.max(1,90-suffix.length)).trim()+suffix}used.add(bulkSlug(candidate));return candidate}
function bulkNativeBytes(paths){const outer=`M 0 0 H ${doc.canvas.w} V ${doc.canvas.h} H 0 Z`;return new TextEncoder().encode([outer,...paths].join('')).length}
async function bulkLayer(file,mode){const src=await bulkReadFile(file),m=await loadMeta(src),scale=mode==='overlay'?Math.min(doc.canvas.w/m.w,doc.canvas.h/m.h):Math.min(doc.canvas.w/m.w,doc.canvas.h/m.h,1);return{id:uid(),type:mode==='overlay'?'overlay':'image',name:bulkBaseName(file.name),src,x:(doc.canvas.w-m.w*scale)/2,y:(doc.canvas.h-m.h*scale)/2,w:m.w*scale,h:m.h*scale,rotation:0,visible:true,locked:mode==='overlay',opacity:1}}
async function bulkOverlayCanvas(L){const img=await loadImg(L.src),off=document.createElement('canvas');off.width=Math.round(doc.canvas.w*2);off.height=Math.round(doc.canvas.h*2);const x=off.getContext('2d');x.drawImage(img,L.x*2,L.y*2,L.w*2,L.h*2);return off}
function bulkSilhouetteCanvas(paths){const off=document.createElement('canvas');off.width=Math.round(doc.canvas.w*2);off.height=Math.round(doc.canvas.h*2);const x=off.getContext('2d');x.scale(2,2);x.fillStyle='#f3f4f6';x.fillRect(0,0,doc.canvas.w,doc.canvas.h);x.fillStyle='#9ca3af';for(const d of paths)x.fill(new Path2D(d));return off}
async function bulkPrepareOne(file,mode,name,folderId){const L=await bulkLayer(file,mode),originalName=bulkBaseName(file.name);let payload,detection;if(mode==='overlay'){let r=await detectOpening(L);detection='opening';if(!r){r=await autoScreen(L,80);detection='auto-screen'}if(!r)throw new Error('No transparent/checkerboard opening or solid-colour screen found');L.src=r.src;const off=await bulkOverlayCanvas(L),path=framePath(openingWithBleed(r.pts,ffOpeningBleed,makeOverlayAlphaMap(off)),false),paths=[path],bytes=bulkNativeBytes(paths);if(bytes>FF_PATH_BUDGET)throw new Error(`Native Canva path budget exceeded: ${bytes}/${FF_PATH_BUDGET}`);payload={mode:'overlay',name,folderId,createOnly:true,w:doc.canvas.w,h:doc.canvas.h,assetWidth:off.width,assetHeight:off.height,paths,smartMask:false,imageData:off.toDataURL('image/png')}}else{const r=await detectSilhouette(L,36),paths=(r.pathDs&&r.pathDs.length?r.pathDs:[r.pathD]).filter(Boolean);if(!paths.length)throw new Error('No native silhouette path');/* Exact-multi inserts one element per path, so it is measured per path. This branch used to always measure the combined string. */const multi=!!r.multiElement||paths.length>1,maxPathsAllowed=multi?FF_MAX_PATHS_MULTI:FF_MAX_PATHS_SINGLE;if(paths.length>maxPathsAllowed)throw new Error(`Too many native paths: ${paths.length}/${maxPathsAllowed}`);const bytes=multi?Math.max(...paths.map(d=>new TextEncoder().encode(d).length)):bulkNativeBytes(paths);if(bytes>FF_PATH_BUDGET)throw new Error(`Native Canva path budget exceeded: ${bytes}/${FF_PATH_BUDGET}`);const off=bulkSilhouetteCanvas(paths),blank=document.createElement('canvas');blank.width=doc.canvas.w;blank.height=doc.canvas.h;payload={mode:'silhouette',name,folderId,createOnly:true,w:doc.canvas.w,h:doc.canvas.h,assetWidth:doc.canvas.w,assetHeight:doc.canvas.h,paths,multiElement:!!r.multiElement,unbridgedHoles:r.unbridgedHoles||0,smartMask:false,imageData:off.toDataURL('image/png'),overlayImageData:blank.toDataURL('image/png')};detection=r.mode||'native-silhouette'}return{originalName,name,payload,detection}}
let bulkPublishTail=Promise.resolve();
/* A bulk run is a long series of admin writes, so it can legitimately meet
   the Worker's rate limit. A 429 is a "wait", not a failure: back off for the
   Retry-After the Worker asks for and try the same frame again, instead of
   aborting the whole batch partway through. */
const BULK_RATE_LIMIT_RETRIES = 6;
function bulkPublishPrepared(prepared,config,state){
  const publish=async()=>{
    let rateLimitRetries=0;
    for(let attempt=0;attempt<1000;attempt++){
      const response=await fetch(config.base+'/api/frames',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+config.token},body:JSON.stringify(prepared.payload)});
      const result=await response.json().catch(()=>({}));
      if(response.status===429){
        if(rateLimitRetries++>=BULK_RATE_LIMIT_RETRIES)throw new Error('Worker rate limit did not clear; try again in a minute');
        const retryAfter=Number(response.headers.get('retry-after'))||60;
        const waitMs=Math.min(90000,retryAfter*1000)+rateLimitRetries*500;
        toast(`Worker rate limit reached · waiting ${Math.ceil(waitMs/1000)}s then continuing “${prepared.name}”`);
        await new Promise(r=>setTimeout(r,waitMs));
        continue;
      }
      if(response.status===409&&result.code==='NAME_EXISTS'){prepared.name=bulkUniqueName(prepared.originalName,state.used);prepared.payload.name=prepared.name;continue}
      if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);
      if(response.status!==201)throw new Error('Worker did not confirm a no-overwrite create');
      return{originalName:prepared.originalName,publishedName:prepared.name,detection:prepared.detection};
    }
    throw new Error('Could not allocate a unique name')
  };
  const task=bulkPublishTail.then(publish);bulkPublishTail=task.catch(()=>{});return task
}
if($('#btnBulk100'))$('#btnBulk100').onclick=async()=>{const raw=await uiPrompt('Bulk 100 mode','overlay','Enter overlay or silhouette. Duplicate names are numbered automatically.');if(raw==null)return;const mode=String(raw).trim().toLowerCase();if(!['overlay','silhouette'].includes(mode)){toast('Enter overlay or silhouette');return}const config=await cloudLibraryConfig(false);if(!config)return;let folder;try{folder=await cloudChooseFolder(config)}catch(e){toast('Bulk stopped: '+String(e.message||e));return}if(!folder)return;const used=new Set((folder.data.frames||[]).map(x=>bulkSlug(x.id||x.name)).filter(Boolean)),input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;input.onchange=async()=>{const files=[...(input.files||[])].slice(0,100);if(!files.length)return;const button=$('#btnBulk100'),old=button.textContent;button.disabled=true;bulkPublishTail=Promise.resolve();const results=new Array(files.length),names=files.map(file=>bulkUniqueName(file.name,used)),state={used};let cursor=0,done=0;const run=async()=>{while(true){const i=cursor++;if(i>=files.length)return;try{const r=await bulkPublishPrepared(await bulkPrepareOne(files[i],mode,names[i],folder.id),config,state);results[i]={file:files[i].name,originalName:r.originalName,publishedName:r.publishedName,renamed:r.originalName!==r.publishedName,folderId:folder.id,folderName:folder.name,status:'published',detection:r.detection}}catch(e){results[i]={file:files[i].name,publishedName:names[i],folderName:folder.name,status:'failed',error:String(e.message||e)}}done++;button.textContent=`Bulk ${done}/${files.length}`}};try{await Promise.all(Array.from({length:Math.min(3,files.length)},run));const ok=results.filter(x=>x.status==='published').length,failed=results.length-ok,renamed=results.filter(x=>x.renamed&&x.status==='published').length,report={mode,folderId:folder.id,folderName:folder.name,total:files.length,published:ok,renamed,failed,processingConcurrency:3,publishingConcurrency:1,noOverwrite:true,results};download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),`frameforge-bulk-${mode}-report.json`);toast(`Bulk complete in ${folder.name} · ${ok} published · ${renamed} renamed · ${failed} failed`)}finally{button.disabled=false;button.textContent=old}};input.click()}

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
    box.innerHTML = '<div class="empty">Build a mockup (overlay + frame), then hit <b>Save as mockup</b>. It is stored in this browser with empty frames, ready for any new artwork.</div>';
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
['dragover', 'drop'].forEach(t => board.addEventListener(t, e => e.preventDefault()));
board.addEventListener('drop', (ev) => {
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
