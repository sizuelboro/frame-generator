'use strict';
/* =========================================================================
   FrameForge Studio - 11-detect.js
   auto screen detection and opening -> frame detection
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* ------------------------- auto screen detection -------------------------
   Takes a mockup image whose screen area is filled with one solid colour
   (yellow / green / magenta etc.), makes that colour transparent, and creates
   a matching frame layer underneath the mockup. One click = reusable mockup. */

function _domColour(d, w, h) {
  const bins = new Map();
  const step = Math.max(1, Math.round(Math.max(w, h) / 500));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 60 || (mx - mn) / mx < 0.3) continue; // skip white / grey / black
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      let e = bins.get(k);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; bins.set(k, e); }
      e.n++; e.r += r; e.g += g; e.b += b;
    }
  }
  let best = null;
  bins.forEach(e => { if (!best || e.n > best.n) best = e; });
  if (!best || best.n < 25) return null;
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n, n: best.n };
}

async function autoScreen(L, tol) {
  tol = tol || 80;
  const img = await loadImg(L.src);
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;

  const t = _domColour(d, w, h);
  if (!t) return null;

  const hard = tol * tol * 3;
  const soft = hard * 3.2;
  let TL = null, TR = null, BR = null, BL = null, cleared = 0;
  /* Remember which pixels were fully knocked out so separate screens can be
     told apart below. The corner trackers stay global so a single-screen
     mockup keeps returning exactly the quad it always did. */
  const clearedMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 8) continue;
      const dr = d[i] - t.r, dg = d[i + 1] - t.g, db = d[i + 2] - t.b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist > soft) continue;
      if (dist > hard) { // feather the anti-aliased rim
        d[i + 3] = Math.round(d[i + 3] * ((dist - hard) / (soft - hard)));
        continue;
      }
      d[i + 3] = 0; cleared++;
      clearedMask[y * w + x] = 1;
      const s = x + y, f = x - y;
      if (!TL || s < TL.k) TL = { x, y, k: s };
      if (!BR || s > BR.k) BR = { x, y, k: s };
      if (!TR || f > TR.k) TR = { x, y, k: f };
      if (!BL || f < BL.k) BL = { x, y, k: f };
    }
  }
  if (cleared < (w * h) * 0.005) return null;
  ctx.putImageData(im, 0, 0);

  const sx = L.w / w, sy = L.h / h;
  const span = Math.max(L.w, L.h);
  const toDoc = corners => corners.map(p => ({ x: L.x + p.x * sx, y: L.y + p.y * sy }));
  const isAxisQuad = q => Math.abs(q[0].y - q[1].y) < span * 0.012 &&
                          Math.abs(q[2].y - q[3].y) < span * 0.012 &&
                          Math.abs(q[0].x - q[3].x) < span * 0.012 &&
                          Math.abs(q[1].x - q[2].x) < span * 0.012;

  const pts = toDoc([TL, TR, BR, BL]);
  const axis = isAxisQuad(pts);

  /* Several separate screens in one photo (a 3-poster room shot) used to
     collapse into one giant quad spanning all of them, because the corner
     trackers above are global. Label the cleared pixels and derive a quad
     per screen. `pts` / `axis` are left untouched, and callers only switch
     to `quads` when there is genuinely more than one screen. */
  const quads = [];
  let skipped = 0;
  try {
    const parts = _components(clearedMask, w, h);
    const minSize = Math.max(24, Math.round(w * h * FF_MIN_OPENING_AREA_RATIO));
    for (let n = 0; n < parts.items.length; n++) {
      const box = parts.items[n];
      if (box.size < minSize || quads.length >= FF_MAX_OPENINGS) { skipped++; continue }
      let a = null, b = null, cc = null, e = null;
      for (let y = box.minY; y <= box.maxY; y++) {
        for (let x = box.minX; x <= box.maxX; x++) {
          if (parts.labels[y * w + x] !== box.id) continue;
          const s = x + y, f = x - y;
          if (!a || s < a.k) a = { x, y, k: s };
          if (!cc || s > cc.k) cc = { x, y, k: s };
          if (!b || f > b.k) b = { x, y, k: f };
          if (!e || f < e.k) e = { x, y, k: f };
        }
      }
      if (!a || !b || !cc || !e) { skipped++; continue }
      const quad = toDoc([a, b, cc, e]);
      quads.push({ pts: quad, axis: isAxisQuad(quad), size: box.size });
    }
  } catch (error) {
    quads.length = 0;
    skipped = 0;
  }

  return { src: c.toDataURL('image/png'), pts, axis, quads, skipped, cleared, colour: t };
}

async function autoScreenApply(L, tol) {
  const res = await autoScreen(L, tol);
  if (!res) { toast('No solid-colour screen found — fill the screen area with one flat colour first'); return false; }

  L.src = res.src;
  L.type = 'overlay';
  L.locked = true;
  if (!/overlay|mockup/i.test(L.name || '')) L.name = (L.name || 'Mockup') + ' Overlay';

  /* One quad per screen. With a single screen this is res.pts / res.axis,
     i.e. exactly the geometry this function has always produced. */
  let regions = [{ pts: res.pts, axis: res.axis }];
  if (res.quads && res.quads.length > 1) {
    const ordered = _readingOrder(res.quads.map(q => q.pts));
    regions = ordered.map(pts => ({ pts, axis: res.quads.find(q => q.pts === pts).axis }));
  }

  doc.layers = doc.layers.filter(x => x.id !== L.id);
  const frames = regions.map((region, index) => ({
    id: uid(), type: 'frame',
    name: regions.length > 1 ? 'Screen Frame ' + (index + 1) : 'Screen Frame',
    frameType: region.axis ? 'rect' : 'perspective',
    visible: true, locked: false, opacity: 1,
    points: region.pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    content: null
  }));
  frames.forEach(fr => doc.layers.push(fr));   // frames below
  doc.layers.push(L);                          // mockup on top
  sel = frames[0].id;
  contentCache.clear(); imgCache.delete(res.src);
  sync();

  const skipNote = res.skipped > 0 ? ' · ' + res.skipped + ' tiny region' + (res.skipped === 1 ? '' : 's') + ' skipped' : '';
  toast(regions.length > 1
    ? 'Screens punched out · ' + regions.length + ' frames created' + skipNote + ' · drop an image in each'
    : 'Screen punched out · ' + (regions[0].axis ? 'rect' : '4-point') + ' frame created' + skipNote + ' · drop an image in');
  return true;
}

if ($('#btnAutoScreen')) {
  $('#btnAutoScreen').onclick = async () => {
    let L = layer(sel);
    if (!L || (L.type !== 'image' && L.type !== 'overlay')) {
      const cands = doc.layers.filter(x => x.type === 'image' || x.type === 'overlay');
      if (cands.length === 1) L = cands[0];
      else { toast('Select the mockup image layer first'); return; }
    }
    const raw = await uiPrompt('Colour tolerance', '80', 'How close a pixel must be to the screen colour. Try 80; raise it if a rim remains.');
    if (raw == null) return;
    const tol = parseInt(raw, 10);
    await autoScreenApply(L, isFinite(tol) ? Math.max(10, Math.min(200, tol)) : 80);
  };
}

/* ---------------------- opening -> frame detection ----------------------
   For cut-out artwork (floral arch, photo frame, ornament, phone with the
   screen knocked out...) the opening is either
     a) really transparent, or
     b) a flattened grey/white "transparency checkerboard" baked into pixels.
   Both are detected here: the largest interior background region is traced
   and turned into a polygon frame, and the artwork is made transparent. */

function _holeComponent(w, h, isBg) {
  const lab = new Int32Array(w * h).fill(-1); // -1 = unvisited, 0 = outside
  const stack = [];
  const push = i => { if (lab[i] === -1 && isBg(i)) { lab[i] = 0; stack.push(i) } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  let next = 1, bestLab = 0, bestSize = 0;
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== -1 || !isBg(i)) continue;
    const id = next++;
    let size = 0;
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      size++;
      if (x > 0 && lab[j - 1] === -1 && isBg(j - 1)) { lab[j - 1] = id; stack.push(j - 1) }
      if (x < w - 1 && lab[j + 1] === -1 && isBg(j + 1)) { lab[j + 1] = id; stack.push(j + 1) }
      if (y > 0 && lab[j - w] === -1 && isBg(j - w)) { lab[j - w] = id; stack.push(j - w) }
      if (y < h - 1 && lab[j + w] === -1 && isBg(j + w)) { lab[j + w] = id; stack.push(j + w) }
    }
    if (size > bestSize) { bestSize = size; bestLab = id }
  }
  return { lab, bestLab, bestSize, outsideBg: true };
}

/* --- morphology on a 0/1 mask (separable, radius r) --- */
function _morph(src, w, h, r, grow) {
  const pass = (inp) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          const s = inp[y * w + xx];
          v = grow ? (v | s) : (v & s);
        }
        out[y * w + x] = v;
      }
    }
    const out2 = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          const s = out[yy * w + x];
          v = grow ? (v | s) : (v & s);
        }
        out2[y * w + x] = v;
      }
    }
    return out2;
  };
  return pass(src);
}

/* fill enclosed gaps inside a mask */
function _fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const st = [];
  const push = i => { if (!seen[i] && !mask[i]) { seen[i] = 1; st.push(i) } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (st.length) {
    const i = st.pop(), x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (mask[i] || !seen[i]) ? 1 : 0;
  return out;
}

/* largest 4-connected component of a mask */
function _largest(mask, w, h) {
  const lab = new Int32Array(w * h).fill(0);
  let next = 0, bestLab = 0, bestSize = 0;
  const st = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] || !mask[i]) continue;
    const id = ++next;
    let size = 0;
    lab[i] = id; st.push(i);
    while (st.length) {
      const j = st.pop(), x = j % w, y = (j - x) / w;
      size++;
      if (x > 0 && !lab[j - 1] && mask[j - 1]) { lab[j - 1] = id; st.push(j - 1) }
      if (x < w - 1 && !lab[j + 1] && mask[j + 1]) { lab[j + 1] = id; st.push(j + 1) }
      if (y > 0 && !lab[j - w] && mask[j - w]) { lab[j - w] = id; st.push(j - w) }
      if (y < h - 1 && !lab[j + w] && mask[j + w]) { lab[j + w] = id; st.push(j + w) }
    }
    if (size > bestSize) { bestSize = size; bestLab = id }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = lab[i] === bestLab ? 1 : 0;
  return { mask: out, size: bestSize };
}


/* Foreground connected components for shared-photo multi-object silhouettes. */
function _components(mask,w,h){
  const labels=new Int32Array(w*h),items=[],stack=[];let id=0;
  for(let i=0;i<w*h;i++){
    if(labels[i]||!mask[i])continue;const cid=++id;let size=0,minX=w,minY=h,maxX=0,maxY=0;labels[i]=cid;stack.push(i);
    while(stack.length){const q=stack.pop(),x=q%w,y=(q-x)/w;size++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      if(x&&mask[q-1]&&!labels[q-1]){labels[q-1]=cid;stack.push(q-1)}if(x<w-1&&mask[q+1]&&!labels[q+1]){labels[q+1]=cid;stack.push(q+1)}
      if(y&&mask[q-w]&&!labels[q-w]){labels[q-w]=cid;stack.push(q-w)}if(y<h-1&&mask[q+w]&&!labels[q+w]){labels[q+w]=cid;stack.push(q+w)}
    }
    items.push({id:cid,size,minX,minY,maxX,maxY});
  }
  items.sort((a,b)=>b.size-a.size);return{labels,items};
}
function _componentMask(labels,id){const out=new Uint8Array(labels.length);for(let i=0;i<labels.length;i++)if(labels[i]===id)out[i]=1;return out}
function _splitThinHorizontal(mask,w,h){
  const up=new Uint16Array(w*h),down=new Uint16Array(w*h),thin=new Uint8Array(w*h),clean=mask.slice(),runMin=Math.max(24,Math.round(w*.04));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(mask[i])up[i]=1+(y?up[i-w]:0)}
  for(let y=h-1;y>=0;y--)for(let x=0;x<w;x++){const i=y*w+x;if(mask[i])down[i]=1+(y<h-1?down[i+w]:0)}
  for(let i=0;i<mask.length;i++)if(mask[i]&&up[i]+down[i]-1<=4)thin[i]=1;
  for(let y=0;y<h;y++){let x=0;while(x<w){if(!thin[y*w+x]){x++;continue}const a=x;while(x<w&&thin[y*w+x])x++;if(x-a>=runMin)for(let q=a;q<x;q++)clean[y*w+q]=0}}
  return clean;
}
/* Multi-only separation. Working single silhouettes never enter this pass. */
function _splitMultiHorizontalDetails(mask,w,h){
  const up=new Uint16Array(w*h),down=new Uint16Array(w*h),clean=mask.slice();
  const lowerStart=Math.round(h*.66),upperRun=Math.max(24,Math.round(w*.04)),lowerRun=Math.max(14,Math.round(w*.014)),lowerThickness=Math.max(12,Math.round(h*.026));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(mask[i])up[i]=1+(y?up[i-w]:0)}
  for(let y=h-1;y>=0;y--)for(let x=0;x<w;x++){const i=y*w+x;if(mask[i])down[i]=1+(y<h-1?down[i+w]:0)}
  for(let y=0;y<h;y++){const thick=y>=lowerStart?lowerThickness:4,run=y>=lowerStart?lowerRun:upperRun;let x=0;while(x<w){const i=y*w+x;if(!mask[i]||up[i]+down[i]-1>thick){x++;continue}const a=x;while(x<w){const q=y*w+x;if(!mask[q]||up[q]+down[q]-1>thick)break;x++}if(x-a>=run)for(let q=a;q<x;q++)clean[y*w+q]=0}}
  return clean;
}
function _multiHeroComponents(parts,w,h){const largest=parts.items[0];if(!largest)return[];const minSize=Math.max(250,largest.size*.008),minHeight=Math.max(18,h*.035);return parts.items.filter(c=>{const bw=c.maxX-c.minX+1,bh=c.maxY-c.minY+1;return c.size>=minSize&&bh>=minHeight&&bw/bh<=5}).slice(0,12)}
function _silhouettePath2D(L){const p=new Path2D(),ds=L.pathDs&&L.pathDs.length?L.pathDs:[L.pathD||framePath(L.points,true)];for(const d of ds)if(d)p.addPath(new Path2D(d));return p}
function _detailOverlayDataUrl(mask,L,w,h){
  const m=document.createElement('canvas');m.width=w;m.height=h;const mx=m.getContext('2d'),im=mx.createImageData(w,h);
  for(let i=0;i<mask.length;i++)if(mask[i]){const q=i*4;im.data[q]=12;im.data[q+1]=12;im.data[q+2]=12;im.data[q+3]=255}mx.putImageData(im,0,0);
  const out=document.createElement('canvas');out.width=Math.max(2,Math.round(doc.canvas.w));out.height=Math.max(2,Math.round(doc.canvas.h));const ox=out.getContext('2d');ox.imageSmoothingEnabled=true;ox.imageSmoothingQuality='high';ox.drawImage(m,L.x,L.y,L.w,L.h);return out.toDataURL('image/png');
}
/* ---------------------------------------------------------------------
   Enclosed-hole handling

   Canva shape paths allow exactly one M command, so a fully enclosed hole
   (a donut centre, the gap inside a handle) cannot be shipped as its own
   subpath. The bridging in _multiObjectPath stitches inner rings into the
   outer ring with zero-width bridges, which keeps one M while still
   describing the hole.

   Whether the hole then reads as a hole depends entirely on winding: an
   inner ring must wind opposite to the ring that contains it. Callers used
   to be trusted to pre-reverse their rings, and any caller that did not
   produced a silently filled hole.

   These helpers make winding explicit and then verify the result, so a hole
   that still cannot be expressed is counted and reported instead of
   shipping a wrong frame.
   --------------------------------------------------------------------- */

/* Signed area of a ring of {x,y} points. */
function _ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return a / 2;
}

/* A point that is definitely strictly inside a ring. The centroid can fall
   outside a concave ring, so fall back to a bounded scan. */
function _pointInsideRing(ring) {
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p.x; cy += p.y; }
  cx /= ring.length; cy /= ring.length;
  if (inPoly({ x: cx, y: cy }, ring)) return { x: cx, y: cy };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const steps = 9;
  for (let iy = 1; iy < steps; iy++) {
    for (let ix = 1; ix < steps; ix++) {
      const q = { x: minX + (maxX - minX) * (ix / steps), y: minY + (maxY - minY) * (iy / steps) };
      if (inPoly(q, ring)) return q;
    }
  }
  return null;
}

/* Count how many hole rings the finished path actually knocks out.
   Uses the same nonzero winding rule Canva fills with, so this is a real
   check rather than an assumption. */
function _countFilledHoles(pathD, loops, roles) {
  if (!pathD || !roles) return 0;
  let filled = 0;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1; probe.height = 1;
    const ctx = probe.getContext('2d');
    const path = new Path2D(pathD);
    for (let i = 0; i < loops.length; i++) {
      if (roles[i] !== 'hole' || !loops[i] || loops[i].length < 3) continue;
      const inside = _pointInsideRing(loops[i]);
      if (!inside) { filled++; continue; }
      // Inside the hole the path must NOT be filled.
      if (ctx.isPointInPath(path, inside.x, inside.y, 'nonzero')) filled++;
    }
  } catch {
    // Probing failed; report every hole as unverified rather than claim success.
    return roles.filter((r) => r === 'hole').length;
  }
  return filled;
}

function _multiObjectPath(raw,L,w,h,allowReduce=true,byteLimit=FF_LIMITS.PATH_BUDGET,roles=null){
  const sx=L.w/w,sy=L.h/h;
  const area=pts=>{let a=0;for(let i=0,j=pts.length-1;i<pts.length;j=i++)a+=pts[j].x*pts[i].y-pts[i].x*pts[j].y;return a};
  const snap=pts=>{const out=[];for(const p of pts){const q={x:Math.round(L.x+p[0]*sx),y:Math.round(L.y+p[1]*sy)};if(!out.length||q.x!==out[out.length-1].x||q.y!==out[out.length-1].y)out.push(q)}if(out.length>1&&out[0].x===out[out.length-1].x&&out[0].y===out[out.length-1].y)out.pop();return out};
  // Keep each ring's role attached to it through filtering and sorting.
  // Previously roles were positional and any reorder lost them.
  let tagged=raw.map((r,i)=>({pts:snap(r),role:roles?(roles[i]||'solid'):null})).filter(x=>x.pts.length>=3);
  if(!tagged.length)return null;
  tagged.sort((a,b)=>Math.abs(area(b.pts))-Math.abs(area(a.pts)));

  // Make winding explicit: the outer ring sets the reference direction and
  // every hole is forced to oppose it. This is what turns a bridged inner
  // ring into an actual knockout under the nonzero fill rule.
  if(roles){
    const outerSign=Math.sign(area(tagged[0].pts))||1;
    for(const t of tagged){
      const want=t.role==='hole'?-outerSign:outerSign;
      if((Math.sign(area(t.pts))||want)!==want)t.pts=[...t.pts].reverse();
    }
  }
  let loops=tagged.map(t=>t.pts);
  const loopRoles=roles?tagged.map(t=>t.role):null;
  const num=n=>String(Math.round(n)),join=(a,b)=>a+(b<0?'':' ')+b;
  const rotateNear=(pts,a)=>{let bi=0,bd=Infinity;for(let i=0;i<pts.length;i++){const d=(pts[i].x-a.x)**2+(pts[i].y-a.y)**2;if(d<bd){bd=d;bi=i}}return[...pts.slice(bi),...pts.slice(0,bi)]};
  const walk=()=>{const base=loops[0];if(loops.length===1)return base;const attached=new Map;for(let j=1;j<loops.length;j++){let bi=0,hi=0,bd=Infinity;for(let i=0;i<base.length;i++)for(let k=0;k<loops[j].length;k++){const d=(base[i].x-loops[j][k].x)**2+(base[i].y-loops[j][k].y)**2;if(d<bd){bd=d;bi=i;hi=k}}const z=[...loops[j].slice(hi),...loops[j].slice(0,hi)];if(!attached.has(bi))attached.set(bi,[]);attached.get(bi).push(z)}const seq=[];for(let i=0;i<base.length;i++){seq.push(base[i]);for(const z of attached.get(i)||[])seq.push(z[0],...z.slice(1),z[0],base[i])}seq.push(base[0]);return seq};
  const encode=()=>{const pts=walk();let out='M'+join(num(pts[0].x),pts[0].y),state='',prev=pts[0];for(let i=1;i<pts.length;i++){const p=pts[i],dx=p.x-prev.x,dy=p.y-prev.y,pair=join(num(dx),dy),opts=[[(state==='l'?(dx<0?'':' '):'l')+pair,'l']];if(dy===0)opts.push([(state==='h'?(dx<0?'':' '):'h')+num(dx),'h']);if(dx===0)opts.push([(state==='v'?(dy<0?'':' '):'v')+num(dy),'v']);opts.sort((a,b)=>a[0].length-b[0].length);out+=opts[0][0];state=opts[0][1];prev=p}return out+'z'};
  const candidate=(pts,loopIndex)=>{const sign=Math.sign(area(pts))||1;let best=null;for(let i=0;i<pts.length;i++){const a=pts[(i-1+pts.length)%pts.length],b=pts[i],c=pts[(i+1)%pts.length],cross=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),concave=cross*sign<0;let score=Math.max(.01,Math.abs(cross));const inX=b.x-a.x,inY=b.y-a.y,outX=c.x-b.x,outY=c.y-b.y,inLen=Math.hypot(inX,inY),outLen=Math.hypot(outX,outY);if(inLen&&outLen){const cos=Math.max(-1,Math.min(1,(inX*outX+inY*outY)/(inLen*outLen))),turn=1-cos;score+=turn*14;if(turn>.35)score*=1+turn*7}if(concave)score*=16;if(loopIndex>0)score*=32;const ux=a.x-b.x,uy=a.y-b.y,vx=c.x-b.x,vy=c.y-b.y,ul=Math.hypot(ux,uy),vl=Math.hypot(vx,vy);if(concave&&ul&&vl&&(ux*vx+uy*vy)/(ul*vl)>-.3)score*=4;if(!best||score<best.score)best={i,score}}return best};
  let path=encode(),guard=0;if(!allowReduce&&new TextEncoder().encode(path).byteLength>byteLimit)return null;
  while(new TextEncoder().encode(path).byteLength>byteLimit&&guard++<5000){let pick=null;for(let j=0;j<loops.length;j++){if(loops[j].length<=6)continue;const c=candidate(loops[j],j);if(c&&(!pick||c.score<pick.score))pick={...c,j}}if(!pick)return null;loops[pick.j]=loops[pick.j].filter((_,i)=>i!==pick.i);path=encode()}
  const bytes=new TextEncoder().encode(path).byteLength;
  if(bytes>byteLimit||((path.match(/[Mm]/g)||[]).length!==1))return null;
  // Verify the holes rather than assume them. holesFilled counts rings that
  // still read as solid, which is exactly what the publish step needs to
  // warn about.
  const holesTotal=loopRoles?loopRoles.filter(r=>r==='hole').length:0;
  const holesFilled=loopRoles?_countFilledHoles(path,loops,loopRoles):0;
  return{path,loops,bytes,holesTotal,holesFilled};
}

/* artwork mask -> largest enclosed opening, robust to texture and thin cuts */
/* Interior background regions of the artwork, before any region is picked.
   Extracted so the single-opening and multi-opening paths can share one
   (fairly expensive) morphology pass instead of running it twice. */
function _holeMask(isBg, w, h) {
  const art = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) art[i] = isBg(i) ? 0 : 1;
  const r = Math.max(2, Math.round(Math.max(w, h) / 160));
  let closed = _morph(art, w, h, r, true);      // dilate: seal thin cuts / watermark lines
  closed = _morph(closed, w, h, r, false);      // erode back
  const filled = _fillHoles(closed, w, h);
  const hole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) hole[i] = (filled[i] && !closed[i]) ? 1 : 0;
  return { hole, r };
}

function _openingMask(isBg, w, h, pre = null) {
  const { hole, r } = pre || _holeMask(isBg, w, h);
  let best = _largest(hole, w, h);
  let mask = _fillHoles(best.mask, w, h);
  const s = Math.max(1, Math.round(r / 2));
  mask = _morph(mask, w, h, s, true);
  mask = _morph(mask, w, h, s, false);
  let size = 0;
  for (let i = 0; i < w * h; i++) if (mask[i]) size++;
  return { mask, size };
}

/* --- multi-opening tuning -------------------------------------------------
   A qualifying opening must cover at least this share of the mockup image.
   Below it we are looking at dust, JPEG noise, a watermark gap or the 1px
   seam around a badly cut border - never a real drop target. Regions that
   fail the test are counted and reported, never silently dropped. */
const FF_MIN_OPENING_AREA_RATIO = 0.003;   // 0.3% of the image
const FF_MAX_OPENINGS = 12;                // sanity cap on runaway detection

/* Every interior background region, not just the biggest one.
   _openingMask() above keeps only `_largest(...)`, which is why a room
   mockup with three posters used to yield one frame over the largest poster
   while the other two were discarded without any warning.

   items[0] is always the largest region, so it matches what _openingMask()
   returns and the caller can keep its original treatment. It is exempt from
   the area filter for that reason; every later region must pass. Each mask
   goes through the same fill-holes + open cycle as _openingMask(), so a lone
   opening traces to exactly the same geometry as before. */
function _openingMasks(isBg, w, h, opts = {}) {
  const minRatio = opts.minRatio == null ? FF_MIN_OPENING_AREA_RATIO : opts.minRatio;
  const maxCount = opts.maxCount == null ? FF_MAX_OPENINGS : opts.maxCount;
  /* detectOpening() already has geometry for the largest region and only
     needs its bounding box here, so it opts out of that mask and pays no
     morphology at all for a single-opening mockup. */
  const primaryMask = opts.primaryMask !== false;
  const { hole, r } = opts.pre || _holeMask(isBg, w, h);
  const parts = _components(hole, w, h);        // sorted largest first
  const minSize = Math.max(24, Math.round(w * h * minRatio));
  const s = Math.max(1, Math.round(r / 2));
  const items = [];
  let skipped = 0;

  for (let n = 0; n < parts.items.length; n++) {
    const box = parts.items[n];
    if (n > 0 && (box.size < minSize || items.length >= maxCount)) { skipped++; continue }
    if (n === 0 && !primaryMask) { items.push({ mask: null, size: box.size, box }); continue }
    let mask = _fillHoles(_componentMask(parts.labels, box.id), w, h);
    mask = _morph(mask, w, h, s, true);
    mask = _morph(mask, w, h, s, false);
    let size = 0;
    for (let i = 0; i < w * h; i++) if (mask[i]) size++;
    items.push({ mask, size, box });
  }
  return { items, skipped };
}

/* Detection returns regions largest first, which is meaningless to a person
   looking at the mockup. Frames are created in reading order instead, so
   "Opening Frame 1" is the top-left one. Rows are grouped with a tolerance
   of half the shortest opening so a slightly uneven gallery wall still reads
   left to right rather than zig-zagging. */
function _readingOrder(regions) {
  const boxed = regions.map((pts, index) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      const px = p.x == null ? p[0] : p.x, py = p.y == null ? p[1] : p.y;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
    return { pts, index, x0, y0, h: y1 - y0 };
  });
  const shortest = Math.min(...boxed.map(b => b.h).filter(h => h > 0));
  const band = Math.max(1, (Number.isFinite(shortest) ? shortest : 1) * 0.5);
  boxed.sort((a, b) => {
    const rowA = Math.round(a.y0 / band), rowB = Math.round(b.y0 / band);
    if (rowA !== rowB) return rowA - rowB;
    if (a.x0 !== b.x0) return a.x0 - b.x0;
    return a.index - b.index;
  });
  return boxed.map(b => b.pts);
}

/* Outline one opening region: a near-rectangular poster becomes a clean
   4-point quad, anything else is traced. Mirrors the rectangularity test
   detectOpening() applies to the primary opening. */
async function _openingLoop(item, w, h) {
  const box = item.box;
  const boxArea = (box.maxX - box.minX + 1) * (box.maxY - box.minY + 1);
  const rectangularity = boxArea ? item.size / boxArea : 0;
  if (rectangularity >= 0.82) {
    return [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]];
  }
  const loop = await _maskOutline(item.mask, w, h);
  return loop && loop.length >= 3 ? loop : null;
}

/* All contours, including tiny inner white cut-outs. */
async function _maskOutlines(mask,w,h,maxPoints=90,startEps=2,minArea=1){
  const signedArea=lp=>{let a=0;for(let i=0,j=lp.length-1;i<lp.length;j=i++)a+=lp[j][0]*lp[i][1]-lp[i][0]*lp[j][1];return a/2};
  const traceMask=async source=>{
    const m=document.createElement('canvas');m.width=w;m.height=h;const mc=m.getContext('2d'),mi=mc.createImageData(w,h);
    for(let i=0;i<w*h;i++)if(source[i])mi.data[i*4+3]=255;mc.putImageData(mi,0,0);
    const tr=traceAlpha(await loadImg(m.toDataURL('image/png')),128,900),out=[];
    for(let loop of tr.loops.sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)))){
      loop=loop.map(q=>[q[0]*tr.scale,q[1]*tr.scale]);if(Math.abs(signedArea(loop))<minArea)continue;
      let eps=startEps,simp=simplify(loop,eps);while(simp.length>maxPoints&&eps<60){eps*=1.2;simp=simplify(loop,eps)}
      if(simp.length>3&&simp[0][0]===simp[simp.length-1][0]&&simp[0][1]===simp[simp.length-1][1])simp.pop();if(simp.length>=3)out.push(simp);
    }return out;
  };
  const outer=await traceMask(mask);if(!outer.length)return[];
  // traceAlpha follows the foreground edge but may omit fully enclosed white
  // islands. Detect those islands explicitly so hand/hair openings exist
  // before any byte-budget simplification starts.
  const background=new Uint8Array(mask.length);for(let i=0;i<mask.length;i++)background[i]=mask[i]?0:1;
  const cc=_components(background,w,h),holes=[],minHoleArea=Math.max(40,w*h*.00045);
  // MAX_TRACED_HOLES bounds how many knockouts one contour can carry, because
  // every extra ring competes for the same path byte budget. Holes beyond the
  // cap are dropped, and a dropped hole publishes as solid. Count every
  // candidate so the caller can report that loss instead of shipping a frame
  // with silently filled holes.
  const MAX_TRACED_HOLES=6;
  let holesFound=0;
  for(const comp of cc.items){
    const touches=comp.minX===0||comp.minY===0||comp.maxX===w-1||comp.maxY===h-1;
    if(touches||comp.size<Math.max(minHoleArea,minArea))continue;
    holesFound++;
    if(holes.length>=MAX_TRACED_HOLES)continue;
    let holeMask=_componentMask(cc.labels,comp.id);holeMask=_morph(holeMask,w,h,1,true);const traced=await traceMask(holeMask);if(!traced.length)continue;let hole=traced[0];
    // Hole winding must oppose the primary foreground contour.
    if(Math.sign(signedArea(hole))===Math.sign(signedArea(outer[0])))hole=[...hole].reverse();holes.push(hole);
  }
  const result=[outer[0],...holes];
  // Array-attached metadata keeps every existing array caller working.
  result.holesFound=holesFound;
  result.holesIncluded=holes.length;
  return result;
}
async function _maskOutline(mask,w,h,maxPoints=90){const loops=await _maskOutlines(mask,w,h,maxPoints,2,4);return loops[0]||null}

/* Native SVG silhouette path. Keep the original cubic geometry instead of
   rasterising and retracing it. Significant dark contours are combined into
   one Canva drop-target path; unsupported SVGs fall back to alpha tracing. */
function _svgSilhouettePath(L){
  if(!/^data:image\/svg\+xml/i.test(L.src||''))return null;
  try{
    const comma=L.src.indexOf(','),head=L.src.slice(0,comma),body=L.src.slice(comma+1);
    const text=/;base64/i.test(head)?decodeURIComponent(escape(atob(body))):decodeURIComponent(body);
    const xml=new DOMParser().parseFromString(text,'image/svg+xml');
    if(xml.querySelector('parsererror'))return null;
    const root=xml.documentElement,vb=(root.getAttribute('viewBox')||`0 0 ${root.getAttribute('width')||L.w} ${root.getAttribute('height')||L.h}`).trim().split(/[ ,]+/).map(Number);
    if(vb.length<4||vb.some(v=>!Number.isFinite(v))||!vb[2]||!vb[3])return null;
    const dark=p=>{const f=(p.getAttribute('fill')||'black').trim().toLowerCase();if(f==='none'||f==='white'||f==='#fff'||f==='#ffffff')return false;const m=f.match(/^#([0-9a-f]{6})$/);if(!m)return f==='black'||!p.hasAttribute('fill');const q=parseInt(m[1],16),r=q>>16,g=q>>8&255,b=q&255;return .2126*r+.7152*g+.0722*b<55};
    const supported=[...xml.querySelectorAll('path')].filter(p=>/^[\s0-9eE+.,MLCZmlcz-]+$/.test(p.getAttribute('d')||''));
    const all=supported.filter(dark);if(!all.length)return null;const longest=Math.max(...all.map(p=>(p.getAttribute('d')||'').length));
    const white=p=>{const f=(p.getAttribute('fill')||'').trim().toLowerCase();return f==='white'||f==='#fff'||f==='#ffffff'};
    const solids=all.filter(p=>(p.getAttribute('d')||'').length>=longest*.1);
    // Significant white SVG contours are deliberate knockouts (hair gaps,
    // enclosed openings). Their source winding is preserved in the compound
    // path so Canva keeps them transparent instead of turning them into frame.
    const holes=supported.filter(p=>white(p)&&(p.getAttribute('d')||'').length>=longest*.05);
    const chosen=[...solids,...holes];
    const fmt=v=>{let z=String(Math.round(v));return z==='-0'?'0':z},join=(a,z)=>a&&z[0]!=='-'?a+' '+z:a+z;
    const parseShape=p=>{
      const d=p.getAttribute('d')||'',tok=d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)||[];
      let sx=1,sy=1,tx=0,ty=0;const tr=p.getAttribute('transform')||'';
      const sm=tr.match(/scale\s*\(\s*([-+\d.eE]+)(?:[ ,]+([-+\d.eE]+))?\s*\)/);if(sm){sx=+sm[1];sy=sm[2]==null?sx:+sm[2]}
      const mm=tr.match(/matrix\s*\(\s*([-+\d.eE]+)[ ,]+0[ ,]+0[ ,]+([-+\d.eE]+)[ ,]+([-+\d.eE]+)[ ,]+([-+\d.eE]+)\s*\)/);if(mm){sx=+mm[1];sy=+mm[2];tx=+mm[3];ty=+mm[4]}
      const point=(x,y)=>({x:L.x+(((x*sx+tx)-vb[0])/vb[2])*L.w,y:L.y+(((y*sy+ty)-vb[1])/vb[3])*L.h});
      let i=0,cmd='',cur=null,start=null;const segs=[],need={M:2,L:2,C:6};
      while(i<tok.length){if(/^[A-Za-z]$/.test(tok[i]))cmd=tok[i++];if(cmd==='Z'||cmd==='z'){cmd='';continue}if(!need[cmd])return null;const n=need[cmd],v=tok.slice(i,i+n).map(Number);if(v.length<n||v.some(x=>!Number.isFinite(x)))return null;i+=n;
        if(cmd==='M'){if(start)return null;cur=start=point(v[0],v[1]);cmd='L'}
        else if(cmd==='L'){if(!cur)return null;const to=point(v[0],v[1]);segs.push({k:'L',from:cur,to});cur=to}
        else {if(!cur)return null;const c1=point(v[0],v[1]),c2=point(v[2],v[3]),to=point(v[4],v[5]);segs.push({k:'C',from:cur,c1,c2,to});cur=to}
      }
      if(!start||!segs.length)return null;
      const vertices=[start,...segs.map(q=>q.to)];let area=0;for(let j=0;j<vertices.length;j++){const u=vertices[j],v=vertices[(j+1)%vertices.length];area+=u.x*v.y-v.x*u.y}
      return{start,segs,area};
    };
    const encodeShape=(shape,reverse,anchor)=>{
      let start=shape.start,segs=shape.segs;
      if(reverse){segs=[...segs].reverse().map(q=>q.k==='C'?{k:'C',from:q.to,c1:q.c2,c2:q.c1,to:q.from}:{k:'L',from:q.to,to:q.from});start=segs[0].from}
      if(anchor&&segs.length){let bi=0,bd=Infinity;for(let i=0;i<segs.length;i++){const p=segs[i].from,d=(p.x-anchor.x)**2+(p.y-anchor.y)**2;if(d<bd){bd=d;bi=i}}segs=[...segs.slice(bi),...segs.slice(0,bi)];start=segs[0].from}
      // Quantize absolute geometry first, then calculate relative deltas.
      // Rounding each delta independently accumulates drift and separates
      // a white knockout from the exact outer-boundary touch point.
      const snap=q=>({x:Math.round(q.x),y:Math.round(q.y)});start=snap(start);
      segs=segs.map(q=>q.k==='C'?{k:'C',from:snap(q.from),c1:snap(q.c1),c2:snap(q.c2),to:snap(q.to)}:{k:'L',from:snap(q.from),to:snap(q.to)});
      let cur=start,prev='',out='M '+fmt(cur.x)+' '+fmt(cur.y);
      for(const q of segs){if(q.k==='L'){const first=fmt(q.to.x-cur.x);let z=(prev==='l'?(first[0]==='-'?'':' '):'l')+first;z=join(z,fmt(q.to.y-cur.y));out+=z;cur=q.to;prev='l'}else{const vals=[q.c1.x-cur.x,q.c1.y-cur.y,q.c2.x-cur.x,q.c2.y-cur.y,q.to.x-cur.x,q.to.y-cur.y];const first=fmt(vals[0]);let z=(prev==='c'?(first[0]==='-'?'':' '):'c')+first;for(let k=1;k<6;k++)z=join(z,fmt(vals[k]));out+=z;cur=q.to;prev='c'}}
      return out+'z';
    };
    const parsed=chosen.map(p=>({shape:parseShape(p),hole:white(p)}));if(parsed.some(x=>!x.shape))return null;
    const primary=parsed.find(x=>!x.hole);if(!primary)return null;const outerSign=Math.sign(primary.shape.area)||1;
    const verts=s=>[s.start,...s.segs.map(q=>q.to)],others=parsed.filter(x=>x!==primary);let anchor=primary.shape.start;
    if(others.length){let best=Infinity;for(const p of verts(primary.shape)){let score=0;for(const x of others){let md=Infinity;for(const q of verts(x.shape)){const d=(p.x-q.x)**2+(p.y-q.y)**2;if(d<md)md=d}score+=md}if(score<best){best=score;anchor=p}}}
    const parts=parsed.map(x=>{const sign=Math.sign(x.shape.area)||outerSign,desired=x.hole?-outerSign:outerSign;return encodeShape(x.shape,sign!==desired,anchor)});
    if(parts.some(x=>!x))return null;
    // Canva allows multiple ShapePath objects, but each individual `d` may
    // contain only one M command. Convert solids + knockout contours into one
    // bridged contour: duplicated zero-width bridges preserve winding/holes
    // while keeping the path valid as a single native drop target.
    const mainMove=/^M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/.exec(parts[0]);if(!mainMove)return null;
    const ox=mainMove[1],oy=mainMove[2];let pathD=parts[0].replace(/z$/i,'');
    for(const part of parts.slice(1)){const m=/^M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/.exec(part);if(!m)return null;const rest=part.slice(m[0].length).replace(/z$/i,'');pathD+='L '+m[1]+' '+m[2]+rest+'L '+ox+' '+oy}
    pathD+='Z';
    const moveCount=(pathD.match(/[Mm]/g)||[]).length;
    return moveCount===1&&new TextEncoder().encode(pathD).length<=FF_PATH_TARGET?pathD:null;
  }catch{return null}
}

/* Subject silhouette -> one polygon frame. Alpha is preferred; opaque images
   use a border-connected colour key so cuts reaching the edge stay open. */
function _nativeSilhouetteQuality(pathDs,mask,L,w,h){
  const c=document.createElement('canvas');c.width=Math.max(2,Math.ceil(doc.canvas.w));c.height=Math.max(2,Math.ceil(doc.canvas.h));const x=c.getContext('2d',{willReadFrequently:true}),p=new Path2D();for(const d of pathDs)if(d)p.addPath(new Path2D(d));x.fill(p);const out=x.getImageData(0,0,c.width,c.height).data;let fg=0,bg=0,miss=0,extra=0;
  for(let sy=1;sy<h;sy+=2)for(let sx=1;sx<w;sx+=2){const expected=!!mask[sy*w+sx],px=Math.max(0,Math.min(c.width-1,Math.round(L.x+sx/w*L.w))),py=Math.max(0,Math.min(c.height-1,Math.round(L.y+sy/h*L.h))),filled=out[(py*c.width+px)*4+3]>127;if(expected){fg++;if(!filled)miss++}else{bg++;if(filled)extra++}}
  return{missRate:fg?miss/fg:1,extraRate:bg?extra/bg:1};
}
async function detectSilhouette(L, tolerance) {
  const img=await loadImg(L.src);
  if(Math.abs(L.rotation||0)>.01) throw new Error('Reset layer rotation before tracing');
  const w0=img.naturalWidth,h0=img.naturalHeight,k=Math.min(1,1000/Math.max(w0,h0));
  const w=Math.max(4,Math.round(w0*k)),h=Math.max(4,Math.round(h0*k));
  const c=document.createElement('canvas'); c.width=w;c.height=h;
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0,w,h);
  const d=x.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);
  let transparent=0,mode='alpha'; for(let i=3;i<d.length;i+=4) if(d[i]<128) transparent++;
  if(transparent>w*h*.002){for(let i=0;i<w*h;i++) mask[i]=d[i*4+3]>=128?1:0}
  else{
    mode='background';
    const samples=[[0,0],[w-1,0],[0,h-1],[w-1,h-1],[w>>1,0],[w>>1,h-1],[0,h>>1],[w-1,h>>1]].map(([a,b])=>{const q=(b*w+a)*4;return[d[q],d[q+1],d[q+2]]});
    const t2=tolerance*tolerance*3,near=p=>{const q=p*4;return samples.some(v=>{const r=d[q]-v[0],g=d[q+1]-v[1],b=d[q+2]-v[2];return r*r+g*g+b*b<=t2})};
    const out=new Uint8Array(w*h),st=[];const push=p=>{if(p>=0&&p<w*h&&!out[p]&&near(p)){out[p]=1;st.push(p)}};
    for(let a=0;a<w;a++){push(a);push((h-1)*w+a)}for(let b=0;b<h;b++){push(b*w);push(b*w+w-1)}
    while(st.length){const p=st.pop(),a=p%w;if(a)push(p-1);if(a<w-1)push(p+1);if(p>=w)push(p-w);if(p<w*(h-1))push(p+w)}
    for(let i=0;i<w*h;i++)mask[i]=near(i)?0:1;
  }
  const cc=_components(mask,w,h),largest=cc.items[0];if(!largest)throw new Error('No usable silhouette found');
  const coverage=cc.items.reduce((n,c)=>n+c.size,0)/(w*h);if(coverage<.005)throw new Error('No usable silhouette found');if(coverage>.96)throw new Error('Background was not detected');
  const sx=L.w/w,sy=L.h/h,nativePath=_svgSilhouettePath(L);
  if(nativePath){const outline=await _maskOutline(_componentMask(cc.labels,largest.id),w,h,90);if(!outline)throw new Error('Could not trace silhouette');return{mode:'svg-vector',pathD:nativePath,pts:outline.map(p=>({x:+(L.x+p[0]*sx).toFixed(1),y:+(L.y+p[1]*sy).toFixed(1)})),objectCount:1}}
  const baseClean=_splitThinHorizontal(mask,w,h),baseParts=_components(baseClean,w,h),partLargest=baseParts.items[0];if(!partLargest)throw new Error('No usable silhouette found after separating objects');
  const minSize=Math.max(18,w*h*.00018),minHeroSize=Math.max(300,partLargest.size*.01),minHeroHeight=Math.max(5,h*.04),basePicked=baseParts.items.filter(c=>c.size>=minHeroSize&&(c.maxY-c.minY+1)>=minHeroHeight).slice(0,8);
  const multiCandidate=basePicked.length>1,clean=multiCandidate?_splitMultiHorizontalDetails(mask,w,h):baseClean,parts=multiCandidate?_components(clean,w,h):baseParts,picked=multiCandidate?_multiHeroComponents(parts,w,h):basePicked,outlines=[],pathDs=[],validIds=[];
  const heroPieces=[];
  for(const comp of picked){
    const cm=_componentMask(parts.labels,comp.id),bh=comp.maxY-comp.minY+1;
    // The connected couple gets two aligned frame bands. This gives hair and
    // lower-leg cut-outs their own path budgets instead of simplifying both
    // people into one path budget's worth of contour.
    const splitPerson=multiCandidate&&comp.minX>w*.25&&bh>h*.45,masks=[];
    if(splitPerson){const cut=Math.round(comp.minY+bh*.56),top=new Uint8Array(cm.length),bottom=new Uint8Array(cm.length);for(let i=0;i<cm.length;i++)if(cm[i]){const y=(i-i%w)/w;if(y<=cut+1)top[i]=1;if(y>=cut-1)bottom[i]=1}masks.push(top,bottom)}else masks.push(cm);
    // A part mask can hold several disconnected pieces (for example the band
    // below the split line holds each person's legs separately). _maskOutlines
    // returns only the largest outer contour, so tracing a band as a whole
    // silently dropped every smaller piece. Trace each connected piece on its
    // own: nothing is lost and each piece gets its own byte budget.
    for(const partMask of masks){
      const pieces=_components(partMask,w,h),usablePieces=pieces.items.filter(p=>p.size>=Math.max(60,minSize));
      for(const piece of (usablePieces.length?usablePieces:pieces.items.slice(0,1))){
        const pieceMask=_componentMask(pieces.labels,piece.id),loops=await _maskOutlines(pieceMask,w,h,2400,.25,.5),usable=loops.filter(Boolean);
        if(!usable.length)continue;
        // Holes the tracer never included (over the cap, or under the minimum
        // area) are dropped before any path is built, so they always publish
        // filled. Count them alongside holes that failed verification.
        const droppedHoles=Math.max(0,(loops.holesFound||0)-(loops.holesIncluded||0));
        // _maskOutlines returns [outer, ...enclosed holes]; declare that so
        // winding is normalised and hole survival can be verified.
        const pieceRoles=usable.map((_,i)=>i===0?'solid':'hole');
        const exact=_multiObjectPath(usable,L,w,h,true,FF_LIMITS.PATH_BUDGET,pieceRoles);if(!exact)continue;
        heroPieces.push({comp:comp.id,path:exact.path,mask:pieceMask,loops:usable,holesTotal:(exact.holesTotal||0)+droppedHoles,holesFilled:(exact.holesFilled||0)+droppedHoles});
      }
    }
  }
  if(!heroPieces.length)throw new Error('Could not trace separated silhouette objects');
  // Judge every traced object on its own. An object whose native path cannot
  // stay faithful inside Canva's byte budget (fine palm fronds, hair strands)
  // is decoration, not a photo opening: publish it as pixel-accurate overlay
  // artwork instead of failing the whole trace or shipping a mangled frame.
  const coveredMask=new Uint8Array(w*h);
  // Enclosed holes that survived bridging vs. holes that still read as solid.
  let tracedHoles=0,unbridgedHoles=0;
  for(const piece of heroPieces){
    const q=_nativeSilhouetteQuality([piece.path],piece.mask,L,w,h);
    piece.ok=q.missRate<=.06&&q.extraRate<=.06;piece.missRate=q.missRate;
    if(piece.ok){pathDs.push(piece.path);outlines.push(...piece.loops);validIds.push(piece.comp);unbridgedHoles+=piece.holesFilled||0;tracedHoles+=piece.holesTotal||0;for(let i=0;i<piece.mask.length;i++)if(piece.mask[i])coveredMask[i]=1}
  }
  // If nothing cleared the strict bar, keep the single most faithful object so
  // the user still gets a usable frame, and say so instead of failing outright.
  let fallback=false;
  if(!pathDs.length){
    const best=heroPieces.slice().sort((a,b)=>a.missRate-b.missRate)[0];
    if(!best||best.missRate>.14)throw new Error(`No object could be traced accurately enough for a native Canva frame (best object lost ${Math.round((best?best.missRate:1)*100)}%). Try a cleaner silhouette.`);
    best.ok=true;fallback=true;pathDs.push(best.path);outlines.push(...best.loops);validIds.push(best.comp);unbridgedHoles+=best.holesFilled||0;tracedHoles+=best.holesTotal||0;
    for(let i=0;i<best.mask.length;i++)if(best.mask[i])coveredMask[i]=1;
  }
  const demoted=heroPieces.filter(p=>!p.ok).length,demotedMask=new Uint8Array(w*h);
  for(const piece of heroPieces)if(!piece.ok)for(let i=0;i<piece.mask.length;i++)if(piece.mask[i]&&!coveredMask[i])demotedMask[i]=1;
  // Demoted objects already failed the native-path budget, so they must bypass
  // the detail packer entirely and go straight to the overlay image.
  const keep=new Set(validIds),detailMask=new Uint8Array(w*h);let detailPixels=0;for(let i=0;i<mask.length;i++)if(mask[i]&&!coveredMask[i]&&!demotedMask[i]){detailMask[i]=1;detailPixels++}
  let detailOverlayDataUrl=null,detailFrameCount=0,nativeDetailMask=null;
  if(multiCandidate&&detailPixels){const dc=_components(detailMask,w,h),groups=[],packed=new Uint8Array(w*h);let pending=[],pendingIds=[];
    const flush=(ids,loops)=>{if(!loops.length)return;const done=_multiObjectPath(loops,L,w,h,false,FF_PATH_TARGET)||_multiObjectPath(loops,L,w,h,true,FF_PATH_TARGET);if(!done)return;groups.push(done.path);for(const id of ids)for(let i=0;i<w*h;i++)if(dc.labels[i]===id)packed[i]=1};
    for(const comp of dc.items.filter(c=>c.size>=4)){let loops=await _maskOutlines(_componentMask(dc.labels,comp.id),w,h,2000,.35,.5);if(!loops.length)continue;
      let alone=_multiObjectPath(loops,L,w,h,false,FF_PATH_TARGET);if(!alone)alone=_multiObjectPath(loops,L,w,h,true,FF_PATH_TARGET);if(!alone)continue;
      const trial=_multiObjectPath([...pending,...loops],L,w,h,false,1750);if(trial){pending=[...pending,...loops];pendingIds.push(comp.id)}else{flush(pendingIds,pending);pending=loops;pendingIds=[comp.id]}}
    flush(pendingIds,pending);
    if(groups.length&&pathDs.length+groups.length<=12){pathDs.push(...groups);detailFrameCount=groups.length;nativeDetailMask=packed;
      let left=0;for(let i=0;i<w*h;i++)if((detailMask[i]&&!packed[i])||demotedMask[i])left++;detailPixels=left;
      if(left)detailOverlayDataUrl=_detailOverlayDataUrl(Uint8Array.from({length:w*h},(_,i)=>((detailMask[i]&&!packed[i])||demotedMask[i])?1:0),L,w,h);
    }else{detailPixels=0;for(let i=0;i<w*h;i++)if(detailMask[i]||demotedMask[i])detailPixels++;detailOverlayDataUrl=_detailOverlayDataUrl(Uint8Array.from({length:w*h},(_,i)=>(detailMask[i]||demotedMask[i])?1:0),L,w,h)}
  }else{detailPixels=0;for(let i=0;i<w*h;i++)if(detailMask[i]||demotedMask[i])detailPixels++;if(detailPixels)detailOverlayDataUrl=_detailOverlayDataUrl(Uint8Array.from({length:w*h},(_,i)=>(detailMask[i]||demotedMask[i])?1:0),L,w,h)}
  // The gate may only judge what the native paths were SUPPOSED to cover.
  // Anything deliberately routed to the overlay image is output, not shape loss.
  const expectedMask=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++)if(coveredMask[i]||(nativeDetailMask&&nativeDetailMask[i]))expectedMask[i]=1;
  const qa=_nativeSilhouetteQuality(pathDs,expectedMask,L,w,h),gateLimit=fallback?.16:.06;
  if(qa.missRate>gateLimit||qa.extraRate>gateLimit)throw new Error(`Traced objects lost ${Math.round(qa.missRate*100)}% of their shape. Try a cleaner silhouette.`);
  if(fallback)toast(`Only one object could be traced natively and it lost ${Math.round(qa.missRate*100)}% of its detail · check the frame edge before publishing`);
  else if(demoted||detailPixels)toast(`${pathDs.length} native frame object(s) · ${demoted?demoted+' fine-detail object(s) and ':''}remaining detail published as overlay artwork`);
  const pts=outlines.flat().map(p=>({x:+(L.x+p[0]*sx).toFixed(1),y:+(L.y+p[1]*sy).toFixed(1)}));
  return{mode:pathDs.length>1?'exact multi-element':'raster',pathD:pathDs[0],pathDs,pts,objectCount:pathDs.length,heroCount:validIds.length,detailFrameCount,multiElement:pathDs.length>1,detailOverlayDataUrl,detailPixels,detailCount:detailFrameCount,smartMask:false,smartMaskDataUrl:null,tracedHoles,unbridgedHoles};
}
async function silhouetteFrameApply(L,tolerance){
  const r=await detectSilhouette(L,tolerance),fr={id:uid(),type:'frame',name:(L.name||'Artwork')+' Silhouette Frame',frameType:'polygon',publishMode:'silhouette',sourceLayerId:L.id,pathD:r.pathD||null,pathDs:r.pathDs||null,multiElement:!!r.multiElement,objectCount:r.objectCount||1,tracedHoles:r.tracedHoles||0,unbridgedHoles:r.unbridgedHoles||0,detailOverlayDataUrl:r.detailOverlayDataUrl||null,detailPixels:r.detailPixels||0,detailCount:r.detailCount||0,smartMask:!!r.smartMask,smartMaskDataUrl:r.smartMaskDataUrl||null,visible:true,locked:false,opacity:1,points:r.pts,content:null};
  L.visible=false;const i=doc.layers.findIndex(x=>x.id===L.id);doc.layers.splice(Math.max(0,i+1),0,fr);sel=fr.id;contentEdit=null;contentCache.clear();sync();toast('Silhouette traced ('+r.mode+') · '+(r.objectCount||1)+' photo object(s) + '+(r.detailCount||0)+' overlay detail(s)');
}
if($('#btnSilhouetteFrame'))$('#btnSilhouetteFrame').onclick=async()=>{
  let L=layer(sel);if(!L||!L.src){const a=doc.layers.filter(x=>x.src&&x.visible);if(a.length===1)L=a[0];else{toast('Select the silhouette image layer first');return}}
  const raw=await uiPrompt('Silhouette background tolerance','36','Transparent PNGs ignore this. For black/white backgrounds try 24–48.');if(raw==null)return;
  toast('Tracing the subject silhouette…');try{await silhouetteFrameApply(L,clamp(parseInt(raw,10)||36,2,160))}catch(e){toast(e.message||'Silhouette tracing failed')}
};
function silhouetteThumbnail(frames){
  const c=document.createElement('canvas');c.width=Math.max(2,Math.round(doc.canvas.w));c.height=Math.max(2,Math.round(doc.canvas.h));const x=c.getContext('2d'),w=c.width,h=c.height;
  // Show the actual frame shape in the library: clip the Canva-style starter
  // landscape to the generated silhouette instead of showing a plain rectangle.
  const mask=new Path2D();frames.forEach(f=>mask.addPath(_silhouettePath2D(f)));x.save();x.clip(mask);
  const sky=x.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#86D7F5');sky.addColorStop(.68,'#DDF3F7');sky.addColorStop(1,'#F4E7BE');x.fillStyle=sky;x.fillRect(0,0,w,h);
  x.fillStyle='rgba(255,255,255,.84)';[[.2,.23,.075],[.27,.2,.095],[.77,.27,.085]].forEach(([a,b,r])=>{x.beginPath();x.arc(w*a,h*b,w*r,0,Math.PI*2);x.arc(w*(a+r*.85),h*(b+.01),w*r*.72,0,Math.PI*2);x.fill()});
  x.fillStyle='#8DB65A';x.beginPath();x.moveTo(0,h*.7);x.quadraticCurveTo(w*.22,h*.5,w*.48,h*.72);x.quadraticCurveTo(w*.72,h*.53,w,h*.69);x.lineTo(w,h);x.lineTo(0,h);x.closePath();x.fill();
  x.fillStyle='#4F7F34';x.beginPath();x.moveTo(0,h*.82);x.quadraticCurveTo(w*.33,h*.6,w*.6,h*.79);x.quadraticCurveTo(w*.83,h*.66,w,h*.77);x.lineTo(w,h);x.lineTo(0,h);x.closePath();x.fill();x.restore();
  return c;
}
function silhouetteTransparentOverlay(){const c=document.createElement('canvas');c.width=Math.max(2,Math.round(doc.canvas.w));c.height=Math.max(2,Math.round(doc.canvas.h));const x=c.getContext('2d');x.fillStyle='rgba(255,255,255,0.004)';x.fillRect(0,0,1,1);return c}

/* checkerboard / flat background detection on an opaque image */
function _checkerBg(d, w, h) {
  const bins = new Map();
  const step = Math.max(1, Math.round(Math.max(w, h) / 400));
  let greys = 0, tot = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) continue;
      tot++;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > 10) continue;                 // not grey
      greys++;
      const k = Math.round(((r + g + b) / 3) / 4) * 4;
      bins.set(k, (bins.get(k) || 0) + 1);
    }
  }
  if (!tot || greys / tot < 0.15) return null;
  const sorted = [...bins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const keep = sorted.filter(e => e[1] > tot * 0.03).map(e => e[0]);
  return keep.length ? keep : null;
}

async function detectOpening(L) {
  const img = await loadImg(L.src);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const k = Math.min(1, 1000 / Math.max(w0, h0));
  const w = Math.max(4, Math.round(w0 * k)), h = Math.max(4, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;

  /* --- a) real alpha opening --- */
  let isBg = i => d[i * 4 + 3] < 128;
  let holeMask = _holeMask(isBg, w, h);
  let comp = _openingMask(isBg, w, h, holeMask);
  let mode = 'alpha', levels = null;
  if (comp.size < w * h * 0.008) {
    /* --- b) flattened checkerboard / flat grey background --- */
    levels = _checkerBg(d, w, h);
    if (!levels) return null;
    isBg = i => {
      const j = i * 4;
      if (d[j + 3] < 128) return true;
      const r = d[j], g = d[j + 1], b = d[j + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 16) return false;
      const v = (r + g + b) / 3;
      return levels.some(L2 => Math.abs(v - L2) <= 14);
    };
    holeMask = _holeMask(isBg, w, h);
    comp = _openingMask(isBg, w, h, holeMask);
    if (comp.size < w * h * 0.008) return null;
    mode = 'checker';
  }

  let innerEdgeLoop=null,rectOpening=null;
  if(mode==='alpha'){
    const transparent=new Uint8Array(w*h);for(let i=0;i<w*h;i++)transparent[i]=d[i*4+3]<128?1:0;
    const parts=_components(transparent,w,h),enclosed=parts.items.filter(q=>q.minX>0&&q.minY>0&&q.maxX<w-1&&q.maxY<h-1),main=enclosed[0];
    if(main){
      const boxArea=(main.maxX-main.minX+1)*(main.maxY-main.minY+1),rectangularity=boxArea?main.size/boxArea:0;
      if(rectangularity>=.82){rectOpening=[[main.minX,main.minY],[main.maxX,main.minY],[main.maxX,main.maxY],[main.minX,main.maxY]]}
      else{const band=main.minX+(main.maxX-main.minX)*.08,minArea=Math.max(30,w*h*.00025),low=main.minY+(main.maxY-main.minY)*.35,q=enclosed.slice(1).find(q=>q.size>=minArea&&(q.minX+q.maxX)/2<=band&&(q.minY+q.maxY)/2>=low);if(q){const cm=_morph(_componentMask(parts.labels,q.id),w,h,1,true);innerEdgeLoop=await _maskOutline(cm,w,h,20)}}
    }
  }
  const simp=rectOpening||await _maskOutline(comp.mask,w,h);
  if(!simp)return null;
  let openingPts=[...simp];
  if(!rectOpening&&innerEdgeLoop&&innerEdgeLoop.length>=3){const signed=lp=>{let a=0;for(let i=0,j=lp.length-1;i<lp.length;j=i++)a+=lp[j][0]*lp[i][1]-lp[i][0]*lp[j][1];return a};let z=innerEdgeLoop;if(Math.sign(signed(z))!==Math.sign(signed(openingPts)))z=[...z].reverse();let bi=0,ki=0,bd=Infinity;for(let i=0;i<openingPts.length;i++)for(let k=0;k<z.length;k++){const dx=openingPts[i][0]-z[k][0],dy=openingPts[i][1]-z[k][1],dd=dx*dx+dy*dy;if(dd<bd){bd=dd;bi=i;ki=k}}z=[...z.slice(ki),...z.slice(0,ki)];const anchor=openingPts[bi];openingPts.splice(bi+1,0,z[0],...z.slice(1),z[0],anchor)}

  /* transparent artwork: clear the detected background everywhere (hole + outside) */
  let src = L.src;
  if (mode === 'checker') {
    const full = document.createElement('canvas');
    full.width = w0; full.height = h0;
    const fc = full.getContext('2d', { willReadFrequently: true });
    fc.drawImage(img, 0, 0);
    const fi = fc.getImageData(0, 0, w0, h0), fd = fi.data;
    for (let i = 0; i < w0 * h0; i++) {
      const j = i * 4;
      const r = fd[j], g = fd[j + 1], b = fd[j + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 14) continue;
      const v = (r + g + b) / 3;
      let best = 999;
      levels.forEach(L2 => { best = Math.min(best, Math.abs(v - L2)) });
      if (best <= 12) fd[j + 3] = 0;
      else if (best <= 22) fd[j + 3] = Math.round(fd[j + 3] * ((best - 12) / 10));
    }
    fc.putImageData(fi, 0, 0);
    src = full.toDataURL('image/png');
  }

  /* --- every other interior opening (multi-window mockups) ---------------
     The primary opening above keeps its original rect / bridged-outline
     treatment, so a single-opening mockup produces byte-identical geometry
     to before this block existed. Any further qualifying region is traced
     here instead of being thrown away by _largest(). */
  const extraLoops = [];
  let skippedOpenings = 0;
  try {
    const found = _openingMasks(isBg, w, h, { pre: holeMask, primaryMask: false });
    skippedOpenings = found.skipped;
    for (let n = 1; n < found.items.length; n++) {
      const loop = await _openingLoop(found.items[n], w, h);
      if (loop) extraLoops.push(loop);
    }
  } catch (error) {
    /* Multi-opening detection is additive. If it ever fails we still ship
       the primary opening rather than losing the whole mockup. */
    extraLoops.length = 0;
    skippedOpenings = 0;
  }

  const sx = L.w / w, sy = L.h / h;
  const toDoc = loop => loop.map(p => ({ x: +(L.x + p[0] * sx).toFixed(1), y: +(L.y + p[1] * sy).toFixed(1) }));
  const primary = toDoc(openingPts);
  return {
    mode,
    src,
    pts: primary,
    openings: [primary, ...extraLoops.map(toDoc)],
    skipped: skippedOpenings,
    coverage: comp.size / (w * h)
  };
}

async function autoHoleApply(L) {
  const res = await detectOpening(L);
  if (!res) return false;

  if (res.src !== L.src) { L.src = res.src; imgCache.delete(res.src) }
  L.type = 'overlay';
  L.locked = true;
  if (!/overlay|mockup/i.test(L.name || '')) L.name = (L.name || 'Artwork') + ' Overlay';

  /* One frame per detected opening. A single-opening mockup takes exactly
     the same route as before; a 3-poster room mockup now gets 3 aligned
     frames instead of one frame over the biggest poster. */
  let regions = (res.openings && res.openings.length ? res.openings : [res.pts]).filter(p => p && p.length >= 3);
  if (!regions.length) return false;
  if (regions.length > 1) regions = _readingOrder(regions);

  doc.layers = doc.layers.filter(x => x.id !== L.id);
  const frames = regions.map((pts, index) => ({
    id: uid(), type: 'frame',
    name: regions.length > 1 ? 'Opening Frame ' + (index + 1) : 'Opening Frame',
    frameType: pts.length === 4 ? (isAxisRect(pts) ? 'rect' : 'perspective') : 'polygon',
    visible: true, locked: false, opacity: 1,
    points: pts, content: null
  }));
  frames.forEach(fr => doc.layers.push(fr));   // frames below
  doc.layers.push(L);                          // artwork on top
  sel = frames[0].id;
  contentCache.clear();
  sync();

  const skipNote = res.skipped > 0 ? ' \u00b7 ' + res.skipped + ' tiny region' + (res.skipped === 1 ? '' : 's') + ' skipped' : '';
  toast(regions.length > 1
    ? 'Openings traced (' + res.mode + ') \u00b7 ' + regions.length + ' openings \u00b7 ' + regions.length + ' frames created' + skipNote + ' \u00b7 drop an image in each'
    : 'Opening traced (' + res.mode + ') \u00b7 ' + regions[0].length + '-point frame created' + skipNote + ' \u00b7 drop an image in');
  return true;
}
