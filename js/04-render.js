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
        // Empty opening (editor only, never exported): Pixopik's own empty-
        // frame placeholder, so the canvas already looks the way the frame
        // will in Elements -> Frames.
        const path = L.publishMode === 'silhouette' ? _silhouettePath2D(L) : ffPolyPath(L.points);
        const b = bbox(L.points);
        c.save();
        c.clip(path);
        c.translate(b.x, b.y);
        if (typeof ffPxDrawPlaceholder === 'function') ffPxDrawPlaceholder(c, b.w, b.h);
        else { c.fillStyle = FF_UI.sky; c.fillRect(0, 0, b.w, b.h); }
        c.restore();
        if (L.publishMode !== 'silhouette') {
          c.save();
          c.setLineDash([6 / zoom, 4 / zoom]); c.lineWidth = 1.2 / zoom; c.strokeStyle = FF_UI.accentFaint;
          c.stroke(path);
          c.restore();
        }
      }
      if(L.detailOverlayDataUrl){const detail=getImg(L.detailOverlayDataUrl);if(detail)c.drawImage(detail,0,0,doc.canvas.w,doc.canvas.h)}
    } else if (L.type === 'image' || L.type === 'overlay' || L.type === 'shadow') {
      const img = getImg(L.type === 'shadow' ? (L.shadowSrc || L.src) : L.src);
      if (img) {
        c.save();
        c.translate(L.x + L.w / 2, L.y + L.h / 2);
        c.rotate(((L.rotation || 0) * Math.PI) / 180);
        if (L.flipX || L.flipY) c.scale(L.flipX ? -1 : 1, L.flipY ? -1 : 1);
        c.drawImage(img, -L.w / 2, -L.h / 2, L.w, L.h);
        c.restore();
      }
    } else if (L.type === 'shape') {
      c.save();
      c.translate(L.x + L.w / 2, L.y + L.h / 2);
      c.rotate(((L.rotation || 0) * Math.PI) / 180);
      if (L.flipX || L.flipY) c.scale(L.flipX ? -1 : 1, L.flipY ? -1 : 1);
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
      c.font = `${L.italic ? 'italic ' : ''}${L.weight || 600} ${L.size}px ${L.font || '-apple-system,Segoe UI,Roboto,sans-serif'}`;
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

/* Editor colours, the same tokens as index.html's design system. */
const FF_UI = {
  accent: '#5146d8',
  accentFaint: 'rgba(81,70,216,.55)',
  edit: '#c7772f',        // content mode: the photo inside is being moved
  sky: '#cfe3f3'
};

function ffPolyPath(points) {
  const p = new Path2D();
  points.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  p.closePath();
  return p;
}

/* Selection chrome. Corner handles are small round points: they mark where
   to grab without hiding the corner of the opening they control. The hit
   area in 05-layers.js (hitCorner) stays larger than the dot. */
function drawChrome(c) {
  const L = layer(sel);
  if (!L) return;
  const col = contentEdit === L.id ? FF_UI.edit : FF_UI.accent;
  c.save();
  c.lineWidth = 1.5 / zoom;
  c.strokeStyle = col;

  if (L.type === 'frame') {
    // Internal one-M bridges of a silhouette are fill-only; never stroke them.
    if (L.publishMode !== 'silhouette') c.stroke(ffPolyPath(L.points));
    if (!L.locked && L.publishMode !== 'silhouette') {
      const r = 4.5 / zoom;
      L.points.forEach((p) => {
        c.save();
        c.shadowColor = 'rgba(35,35,52,.28)'; c.shadowBlur = 4 / zoom; c.shadowOffsetY = 1 / zoom;
        c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fillStyle = '#fff'; c.fill();
        c.restore();
        c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.lineWidth = 1.8 / zoom; c.strokeStyle = col; c.stroke();
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
  c.font = `${L.italic ? 'italic ' : ''}${L.weight || 600} ${L.size}px ${L.font || '-apple-system,Segoe UI,Roboto,sans-serif'}`;
  const w = Math.max(...String(L.text).split('\n').map(s => c.measureText(s).width));
  c.restore();
  return w;
}
const layer = (id) => doc.layers.find(l => l.id === id) || null;
