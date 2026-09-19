'use strict';
/* =========================================================================
   FrameForge Studio - 04-render.js
   frame content compositing and the canvas renderer
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.
   ========================================================================= */

/* =========================================================================
   RENDER
   ========================================================================= */
function render(target, opts) {
  const o = Object.assign({ scale: 1, chrome: true, only: null, bg: true, quality: 'preview' }, opts || {});
  const c = target || ctx;
  const W = doc.canvas.w * o.scale, H = doc.canvas.h * o.scale;
  if (!target) { cv.width = W; cv.height = H; applyZoom(); }

  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  if (o.bg && doc.canvas.bg !== 'transparent') { c.fillStyle = doc.canvas.bg; c.fillRect(0, 0, W, H); }
  c.save();
  c.scale(o.scale, o.scale);
  c.imageSmoothingQuality = 'high';

  const steps = o.quality === 'export' ? 28 : (drag ? 10 : 18);
  const res = o.quality === 'export' ? Math.min(3, o.scale * 1.4) : 1;

  for (const L of doc.layers) {
    if (!L.visible) continue;
    if (o.only && !o.only.includes(L.type)) continue;
    c.save();
    c.globalAlpha = L.opacity == null ? 1 : L.opacity;

    if (L.type === 'frame') {
      const cc = frameContentCanvas(L, res);
      if (cc) {
        if (isAxisRect(L.points) && (!L.content.rotation)) {
          const b = bbox(L.points);
          c.save(); c.beginPath();
          c.rect(b.x, b.y, b.w, b.h); c.clip();
          c.drawImage(cc, b.x, b.y, b.w, b.h);
          c.restore();
        } else if (L.points.length === 4) {
          warpQuad(c, cc, L.points, steps, 0.6 / o.scale);
        } else {
          const b = bbox(L.points);
          c.save();
          if(L.publishMode==='silhouette') c.clip(_silhouettePath2D(L));
          else { c.beginPath();c.moveTo(L.points[0].x,L.points[0].y);L.points.slice(1).forEach(p=>c.lineTo(p.x,p.y));c.closePath();c.clip(); }
          c.drawImage(cc, b.x, b.y, b.w, b.h);
          c.restore();
        }
      } else if (o.chrome) {
        // empty frame placeholder (editor only — never exported)
        c.save();
        const silhouettePath=L.publishMode==='silhouette'?_silhouettePath2D(L):null;
        if(!silhouettePath){c.beginPath();c.moveTo(L.points[0].x,L.points[0].y);L.points.slice(1).forEach(p=>c.lineTo(p.x,p.y));c.closePath()}
        c.fillStyle = 'rgba(39,131,222,.14)'; silhouettePath?c.fill(silhouettePath):c.fill();
        c.setLineDash([7, 5]); c.lineWidth = 1.6 / zoom; c.strokeStyle = '#2783DE'; if(!silhouettePath)c.stroke();
        const b = bbox(L.points);
        c.setLineDash([]);
        c.fillStyle = '#2783DE';
        c.font = `600 ${Math.max(11, Math.min(15, b.h / 12))}px -apple-system,Segoe UI,Roboto,sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('Drop image here', b.x + b.w / 2, b.y + b.h / 2);
        c.restore();
      }
      if(L.detailOverlayDataUrl){const detail=getImg(L.detailOverlayDataUrl);if(detail)c.drawImage(detail,0,0,doc.canvas.w,doc.canvas.h)}
    } else if (L.type === 'image' || L.type === 'overlay' || L.type === 'shadow') {
      const img = getImg(L.type === 'shadow' ? (L.shadowSrc || L.src) : L.src);
      if (img) {
        c.save();
        c.translate(L.x + L.w / 2, L.y + L.h / 2);
        c.rotate(((L.rotation || 0) * Math.PI) / 180);
        c.drawImage(img, -L.w / 2, -L.h / 2, L.w, L.h);
        c.restore();
      }
    } else if (L.type === 'shape') {
      c.save();
      c.translate(L.x + L.w / 2, L.y + L.h / 2);
      c.rotate(((L.rotation || 0) * Math.PI) / 180);
      c.fillStyle = L.fill;
      if (L.shape === 'ellipse') {
        c.beginPath(); c.ellipse(0, 0, L.w / 2, L.h / 2, 0, 0, Math.PI * 2); c.fill();
      } else {
        const r = Math.min(L.radius || 0, L.w / 2, L.h / 2);
        c.beginPath();
        if (c.roundRect) c.roundRect(-L.w / 2, -L.h / 2, L.w, L.h, r);
        else c.rect(-L.w / 2, -L.h / 2, L.w, L.h);
        c.fill();
      }
      c.restore();
    } else if (L.type === 'text') {
      c.save();
      c.translate(L.x, L.y);
      c.rotate(((L.rotation || 0) * Math.PI) / 180);
      c.fillStyle = L.color;
      c.font = `${L.weight || 600} ${L.size}px ${L.font || '-apple-system,Segoe UI,Roboto,sans-serif'}`;
      c.textAlign = L.align || 'left';
      c.textBaseline = 'top';
      String(L.text).split('\n').forEach((line, i) => c.fillText(line, 0, i * L.size * 1.25));
      c.restore();
    }
    c.restore();
  }

  if (o.chrome) drawChrome(c);
  c.restore();
}

function drawChrome(c) {
  const L = layer(sel);
  if (!L) return;
  const active = contentEdit === L.id;
  c.save();
  c.lineWidth = 1.6 / zoom;
  c.strokeStyle = active ? '#D5803B' : '#2783DE';

  if (L.type === 'frame') {
    if(L.publishMode==='silhouette'){/* Internal one-M bridges are fill-only; never stroke them. */}
    else {c.beginPath();c.moveTo(L.points[0].x,L.points[0].y);L.points.slice(1).forEach(p=>c.lineTo(p.x,p.y));c.closePath();c.stroke()}
    if (!L.locked && L.publishMode!=='silhouette') {
      const r = 6 / zoom;
      L.points.forEach((p) => {
        c.beginPath(); c.rect(p.x - r, p.y - r, r * 2, r * 2);
        c.fillStyle = '#fff'; c.fill();
        c.lineWidth = 2 / zoom; c.strokeStyle = active ? '#D5803B' : '#2783DE'; c.stroke();
      });
    }
  } else {
    const b = L.type === 'text'
      ? { x: L.x - 4, y: L.y - 4, w: textW(c, L) + 8, h: L.size * 1.25 * String(L.text).split('\n').length + 8 }
      : { x: L.x, y: L.y, w: L.w, h: L.h };
    c.strokeRect(b.x, b.y, b.w, b.h);
  }
  c.restore();
}
function textW(c, L) {
  c.save();
  c.font = `${L.weight || 600} ${L.size}px ${L.font || 'sans-serif'}`;
  const w = Math.max(...String(L.text).split('\n').map(s => c.measureText(s).width));
  c.restore();
  return w;
}
const layer = (id) => doc.layers.find(l => l.id === id) || null;
