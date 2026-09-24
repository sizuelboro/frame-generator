/**
 * Toolbar menus, stage empty state and the late-bound bulk-fit adapter.
 *
 * Loaded after the Studio scripts so the original handlers remain intact.
 */
;(function () {
	"use strict"
	var MENUS = [
		{ btn: "btnToolsMenu", menu: "menuTools" },
		{ btn: "btnExportMenu", menu: "menuExport" },
	]
	function closeAll(keepOpen) {
		for (var i = 0; i < MENUS.length; i++) {
			var menu = document.getElementById(MENUS[i].menu)
			var btn = document.getElementById(MENUS[i].btn)
			if (!menu || !btn || menu === keepOpen) continue
			menu.classList.remove("open")
			btn.setAttribute("aria-expanded", "false")
		}
	}
	MENUS.forEach(function (pair) {
		var btn = document.getElementById(pair.btn)
		var menu = document.getElementById(pair.menu)
		if (!btn || !menu) return
		btn.addEventListener("click", function (e) {
			e.stopPropagation()
			var open = !menu.classList.contains("open")
			closeAll(open ? menu : null)
			menu.classList.toggle("open", open)
			btn.setAttribute("aria-expanded", open ? "true" : "false")
		})
		menu.addEventListener("click", function (e) {
			if (e.target && e.target.closest && e.target.closest("button")) closeAll()
		})
	})
	document.addEventListener("click", function () { closeAll() })
	document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll() })
	function forward(fromId, toSelector) {
		var from = document.getElementById(fromId)
		var to = document.querySelector(toSelector)
		if (!from || !to) return
		from.addEventListener("click", function () { to.click() })
	}
	forward("esAddOpening", "#btnAddRatioFrame")
	forward("esAddOverlay", '[data-act="addOverlay"]')
	var stateEl = document.getElementById("emptyState")
	var layerList = document.getElementById("layerList")
	if (stateEl && layerList) {
		var sync = function () { stateEl.classList.toggle("gone", layerList.children.length > 0) }
		sync()
		if (typeof MutationObserver === "function") new MutationObserver(sync).observe(layerList, { childList: true })
	}
})()

/* Bulk 100 previously published the full working canvas. Apply the same
 * clipping rule as Fit canvas to EACH prepared payload, without mutating doc
 * (three files may be preparing concurrently). The path and PNG must move
 * together; cropping only the PNG would break Canva's drop target. */
;(function () {
  'use strict';
  const PAD = 20;
  const originalPrepare = bulkPrepareOne;

  // Translate absolute coordinates without reserializing relative path data.
  // This preserves the native path byte budget and handles SVG bridges (L).
  function shiftPath(path, dx, dy) {
    const tokens = [...path.matchAll(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)];
    const arity = { M:2, L:2, T:2, H:1, V:1, C:6, S:4, Q:4, A:7, Z:0 };
    let cmd = '', index = 0;
    const changes = [];
    for (const token of tokens) {
      const value = token[0];
      if (/^[A-Za-z]$/.test(value)) {
        cmd = value;
        if (!(value.toUpperCase() in arity)) throw new Error('Unsupported native path command: ' + value);
        index = 0;
        continue;
      }
      if (!cmd || arity[cmd.toUpperCase()] === 0) throw new Error('Invalid native path');
      const upper = cmd.toUpperCase();
      const pos = index % arity[upper];
      let delta = 0;
      if (cmd === upper) {
        if (upper === 'H' || (['M','L','T','C','S','Q'].includes(upper) && pos % 2 === 0) || (upper === 'A' && pos === 5)) delta = dx;
        if (upper === 'V' || (['M','L','T','C','S','Q'].includes(upper) && pos % 2 === 1) || (upper === 'A' && pos === 6)) delta = dy;
      }
      if (delta) changes.push({ start: token.index, end: token.index + value.length,
        text: String(Math.round((Number(value) - delta) * 1000) / 1000) });
      index++;
    }
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i]; path = path.slice(0, c.start) + c.text + path.slice(c.end);
    }
    return path;
  }

  function bounds(canvas, paths, pad) {
    const w = canvas.width, h = canvas.height;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#fff';
    for (const d of paths) c.fill(new Path2D(d));
    const data = c.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 3) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) throw new Error('No visible mockup or frame pixels');
    const x0 = Math.max(0, Math.floor(minX - pad));
    const y0 = Math.max(0, Math.floor(minY - pad));
    const x1 = Math.min(w, Math.ceil(maxX + 1 + pad));
    const y1 = Math.min(h, Math.ceil(maxY + 1 + pad));
    return { x0, y0, w: Math.max(8, x1 - x0), h: Math.max(8, y1 - y0) };
  }

  async function fitPrepared(prepared) {
    const p = prepared.payload;
    const w = p.w, h = p.h;
    const source = await loadImg(p.imageData);
    // Work at canvas resolution, as the manual Fit canvas action does.
    const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
    if (p.mode === 'overlay') mask.getContext('2d').drawImage(source, 0, 0, w, h);
    const box = bounds(mask, p.paths, PAD);
    const paths = p.paths.map(d => shiftPath(d, box.x0, box.y0));
    const outer = `M 0 0 H ${box.w} V ${box.h} H 0 Z`;
    const sizes = paths.map(d => new TextEncoder().encode(d).length);
    const bytes = new TextEncoder().encode([outer, ...paths].join('')).length;
    if ((p.multiElement ? sizes.some(n => n > FF_PATH_BUDGET) : bytes > FF_PATH_BUDGET))
      throw new Error('Native Canva path budget exceeded after fitting canvas');
    const scaleX = p.assetWidth / w, scaleY = p.assetHeight / h;
    const cropped = document.createElement('canvas');
    cropped.width = Math.round(box.w * scaleX); cropped.height = Math.round(box.h * scaleY);
    cropped.getContext('2d').drawImage(source,
      box.x0 * scaleX, box.y0 * scaleY, box.w * scaleX, box.h * scaleY,
      0, 0, cropped.width, cropped.height);
    p.w = box.w; p.h = box.h;
    p.assetWidth = cropped.width; p.assetHeight = cropped.height;
    p.imageData = cropped.toDataURL('image/png');
    p.paths = paths;
    if (p.overlayImageData) {
      const blank = document.createElement('canvas'); blank.width = box.w; blank.height = box.h;
      p.overlayImageData = blank.toDataURL('image/png');
    }
    prepared.detection += ' · fit 20px';
    return prepared;
  }
  bulkPrepareOne = async function (...args) { return fitPrepared(await originalPrepare(...args)); };
})()
