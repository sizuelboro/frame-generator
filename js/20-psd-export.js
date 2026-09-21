'use strict';
/* =========================================================================
   FrameForge Studio - 20-psd-export.js
   native Photoshop PSD export with the opening as a smart object
   -------------------------------------------------------------------------
   Part of one ordered classic-script bundle. These files share the global
   scope on purpose and MUST stay in the order listed in index.html.

   Everything between the psd-core markers below is pure: it never touches
   the DOM, the canvas or Studio state, so tools/test-psd-export.mjs can
   evaluate it in a bare Node VM and parse the bytes it produces back.
   The Studio wiring at the bottom is the only part that reads the document,
   and it is wrapped in try/catch so a PSD failure can never take the rest
   of the Studio down with it.
   ========================================================================= */

/* psd-core-start */

/* ---------------- byte writer ----------------
   A PSD is written back to front in places (a block declares its own length),
   so the writer keeps a growable buffer and can patch a length in place. */
function psdWriter() {
  var buf = new Uint8Array(65536);
  var len = 0;
  var scratch = new DataView(new ArrayBuffer(8));

  function need(n) {
    if (len + n <= buf.length) return;
    var size = buf.length;
    while (size < len + n) size *= 2;
    var next = new Uint8Array(size);
    next.set(buf.subarray(0, len));
    buf = next;
  }

  var api = {
    get length() { return len; },
    u8: function (v) { need(1); buf[len++] = v & 255; return api; },
    u16: function (v) { need(2); buf[len++] = (v >>> 8) & 255; buf[len++] = v & 255; return api; },
    i16: function (v) { return api.u16(v < 0 ? v + 65536 : v); },
    u32: function (v) {
      need(4);
      buf[len++] = (v >>> 24) & 255; buf[len++] = (v >>> 16) & 255;
      buf[len++] = (v >>> 8) & 255; buf[len++] = v & 255;
      return api;
    },
    u64: function (v) { api.u32(Math.floor(v / 4294967296)); return api.u32(v % 4294967296); },
    f64: function (v) {
      scratch.setFloat64(0, v, false);
      need(8);
      for (var i = 0; i < 8; i++) buf[len++] = scratch.getUint8(i);
      return api;
    },
    bytes: function (arr) {
      need(arr.length);
      buf.set(arr, len);
      len += arr.length;
      return api;
    },
    ascii: function (s) {
      need(s.length);
      for (var i = 0; i < s.length; i++) buf[len++] = s.charCodeAt(i) & 255;
      return api;
    },
    /* Four-character signature or key. */
    key: function (s) { return api.ascii((s + '    ').slice(0, 4)); },
    zeros: function (n) { need(n); for (var i = 0; i < n; i++) buf[len++] = 0; return api; },
    /* 1-byte length + bytes, padded so the whole field is a multiple of pad. */
    pascal: function (s, pad) {
      var text = String(s == null ? '' : s).slice(0, 255);
      api.u8(text.length).ascii(text);
      if (pad > 1) {
        var over = (1 + text.length) % pad;
        if (over) api.zeros(pad - over);
      }
      return api;
    },
    /* Photoshop Unicode string: UTF-16BE code-unit count including the
       terminating null, then the units. */
    unicode: function (s) {
      var text = String(s == null ? '' : s);
      api.u32(text.length + 1);
      for (var i = 0; i < text.length; i++) api.u16(text.charCodeAt(i));
      return api.u16(0);
    },
    /* Reserve a 32-bit length and return a token to fill it in later. */
    mark: function () { var at = len; api.u32(0); return { at: at, from: len }; },
    close: function (token, pad) {
      if (pad > 1) {
        var over = (len - token.from) % pad;
        if (over) api.zeros(pad - over);
      }
      var size = len - token.from;
      buf[token.at] = (size >>> 24) & 255; buf[token.at + 1] = (size >>> 16) & 255;
      buf[token.at + 2] = (size >>> 8) & 255; buf[token.at + 3] = size & 255;
      return size;
    },
    done: function () { return buf.slice(0, len); },
  };
  return api;
}

/* ---------------- PackBits ----------------
   PSD stores layer and composite pixels one compressed scanline at a time.
   Without this a 12 MP document would write a ~300 MB file. */
function psdPackBits(src) {
  var out = [];
  var n = src.length;
  var i = 0;
  while (i < n) {
    var run = 1;
    while (i + run < n && src[i + run] === src[i] && run < 128) run++;
    if (run >= 2) {
      out.push(257 - run, src[i]);
      i += run;
      continue;
    }
    var start = i;
    var lit = 0;
    while (i < n && lit < 128) {
      // A run of three is cheaper encoded as a run, so break the literal here.
      if (i + 2 < n && src[i] === src[i + 1] && src[i] === src[i + 2]) break;
      i++; lit++;
    }
    out.push(lit - 1);
    for (var k = 0; k < lit; k++) out.push(src[start + k]);
  }
  return new Uint8Array(out);
}

/* One PackBits pass per scanline, plus the per-row byte counts PSD needs. */
function psdPackRows(plane, w, h) {
  var rows = [];
  var counts = [];
  var total = 0;
  for (var y = 0; y < h; y++) {
    var packed = psdPackBits(plane.subarray(y * w, y * w + w));
    rows.push(packed);
    counts.push(packed.length);
    total += packed.length;
  }
  return { rows: rows, counts: counts, total: total };
}

/* Interleaved RGBA from a canvas -> the planar channels PSD writes. */
function psdChannels(rgba, w, h) {
  var n = w * h;
  var r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n), a = new Uint8Array(n);
  for (var i = 0; i < n; i++) {
    r[i] = rgba[i * 4];
    g[i] = rgba[i * 4 + 1];
    b[i] = rgba[i * 4 + 2];
    a[i] = rgba[i * 4 + 3];
  }
  return { r: r, g: g, b: b, a: a };
}

/* ---------------- descriptors ----------------
   Smart objects are described with Adobe's descriptor structure, so the
   PSD writer needs a small serialiser for it. */
function psdDescriptorKey(w, id) {
  var text = String(id);
  if (text.length === 4) { w.u32(0); w.ascii(text); }
  else { w.u32(text.length); w.ascii(text); }
  return w;
}

function psdWriteValue(w, v) {
  switch (v.type) {
    case 'doub': w.key('doub').f64(v.value); break;
    case 'long': w.key('long').u32(v.value >>> 0); break;
    case 'bool': w.key('bool').u8(v.value ? 1 : 0); break;
    case 'TEXT': w.key('TEXT').unicode(v.value); break;
    case 'enum': w.key('enum'); psdDescriptorKey(w, v.enumType); psdDescriptorKey(w, v.value); break;
    case 'UntF': w.key('UntF').key(v.unit).f64(v.value); break;
    case 'Objc': w.key('Objc'); psdWriteDescriptor(w, v.value); break;
    case 'VlLs':
      w.key('VlLs').u32(v.items.length);
      for (var i = 0; i < v.items.length; i++) psdWriteValue(w, v.items[i]);
      break;
    default: throw new Error('unsupported descriptor value: ' + v.type);
  }
  return w;
}

function psdWriteDescriptor(w, desc) {
  w.unicode(desc.name || '');
  psdDescriptorKey(w, desc.classID || 'null');
  var items = desc.items || [];
  w.u32(items.length);
  for (var i = 0; i < items.length; i++) {
    psdDescriptorKey(w, items[i][0]);
    psdWriteValue(w, items[i][1]);
  }
  return w;
}

var psdDoub = function (value) { return { type: 'doub', value: Number(value) }; };
var psdLong = function (value) { return { type: 'long', value: Number(value) }; };

/* Corner order Photoshop expects: top-left, top-right, bottom-right,
   bottom-left, as x,y pairs. */
function psdCornerList(corners) {
  var items = [];
  for (var i = 0; i < 4; i++) {
    items.push(psdDoub(corners[i].x));
    items.push(psdDoub(corners[i].y));
  }
  return { type: 'VlLs', items: items };
}

function psdWarpDescriptor() {
  return {
    classID: 'warp',
    items: [
      ['warpStyle', { type: 'enum', enumType: 'warpStyle', value: 'warpNone' }],
      ['warpValue', psdDoub(0)],
      ['warpPerspective', psdDoub(0)],
      ['warpPerspectiveOther', psdDoub(0)],
      ['warpRotate', { type: 'enum', enumType: 'Ornt', value: 'Hrzn' }],
      ['uOrder', psdLong(4)],
      ['vOrder', psdLong(4)],
    ],
  };
}

/* Placed layer data, CS3 and later. Photoshop reads the corner pins from
   here, which is why a perspective opening survives the round trip. */
function psdSmartObjectSoLd(so) {
  var w = psdWriter();
  w.ascii('soLD').u32(4).u32(16);
  psdWriteDescriptor(w, {
    classID: 'null',
    items: [
      ['Idnt', { type: 'TEXT', value: so.uuid }],
      ['placed', { type: 'TEXT', value: so.uuid }],
      ['PgNm', psdLong(1)],
      ['totalPages', psdLong(1)],
      ['Crop', psdLong(1)],
      ['frameStep', { type: 'Objc', value: { classID: 'null', items: [['numerator', psdLong(0)], ['denominator', psdLong(600)]] } }],
      ['duration', { type: 'Objc', value: { classID: 'null', items: [['numerator', psdLong(0)], ['denominator', psdLong(600)]] } }],
      ['frameCount', psdLong(1)],
      ['Annt', psdLong(16)],
      ['Type', psdLong(2)],
      ['Trnf', psdCornerList(so.corners)],
      ['nonAffineTransform', psdCornerList(so.corners)],
      ['warp', { type: 'Objc', value: psdWarpDescriptor() }],
      ['Sz  ', { type: 'Objc', value: { classID: 'Pnt ', items: [['Wdth', psdDoub(so.w)], ['Hght', psdDoub(so.h)]] } }],
      ['Rslt', { type: 'UntF', unit: '#Rsl', value: 72 }],
    ],
  });
  return w.done();
}

/* The older placed-layer block. Written alongside SoLd because several
   readers (and older Photoshop versions) only understand this one. */
function psdSmartObjectPlLd(so) {
  var w = psdWriter();
  w.ascii('plcL').u32(3);
  w.pascal(so.uuid, 1);
  w.u32(1).u32(1).u32(16).u32(2);
  for (var i = 0; i < 4; i++) w.f64(so.corners[i].x).f64(so.corners[i].y);
  w.u32(0).u32(16);
  psdWriteDescriptor(w, psdWarpDescriptor());
  return w.done();
}

/* The embedded file itself. One lnk2 block holds every linked/embedded
   smart-object source in the document. */
function psdLinkedData(so) {
  var w = psdWriter();
  var item = psdWriter();
  item.ascii('liFD').u32(2);
  item.pascal(so.uuid, 1);
  item.unicode(so.fileName || 'FrameForge artwork.png');
  item.key('PNGf').key('8BIM');
  item.u64(so.fileBytes.length);
  item.u8(0);
  item.bytes(so.fileBytes);
  var body = item.done();
  w.u64(body.length).bytes(body);
  var over = body.length % 4;
  if (over) w.zeros(4 - over);
  return w.done();
}

/* ---------------- layers ---------------- */

/* The legacy Pascal layer name is a single-byte string. Photoshop reads the
   real name from the Unicode block below, so anything outside ASCII is
   folded here instead of being silently truncated to a control byte. */
function psdAsciiName(name) {
  var text = String(name == null ? '' : name);
  var out = '';
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    out += code >= 32 && code <= 126 ? text[i] : '-';
  }
  return out.replace(/-{2,}/g, '-').slice(0, 255);
}
/* Photoshop's own four-character blend keys. Multiply is "mul " with a
   trailing space; "mult" is not a blend mode any reader accepts. */
var PSD_BLEND_KEYS = { normal: 'norm', multiply: 'mul ', screen: 'scrn', darken: 'dark', lighten: 'lite' };

function psdLayerPixels(layer) {
  var w = Math.max(0, Math.round(layer.w));
  var h = Math.max(0, Math.round(layer.h));
  var empty = { r: new Uint8Array(0), g: new Uint8Array(0), b: new Uint8Array(0), a: new Uint8Array(0) };
  var planes = w && h ? psdChannels(layer.rgba, w, h) : empty;
  return [
    { id: -1, packed: psdPackRows(planes.a, w, h) },
    { id: 0, packed: psdPackRows(planes.r, w, h) },
    { id: 1, packed: psdPackRows(planes.g, w, h) },
    { id: 2, packed: psdPackRows(planes.b, w, h) },
  ];
}

function psdWriteLayerRecord(w, layer, channels) {
  var x = Math.round(layer.x), y = Math.round(layer.y);
  var width = Math.max(0, Math.round(layer.w)), height = Math.max(0, Math.round(layer.h));
  w.u32(y).u32(x).u32(y + height).u32(x + width);
  w.u16(channels.length);
  for (var i = 0; i < channels.length; i++) {
    var c = channels[i];
    w.i16(c.id);
    w.u32(2 + 2 * c.packed.counts.length + c.packed.total);
  }
  w.key('8BIM').key(PSD_BLEND_KEYS[layer.blend || 'normal'] || 'norm');
  w.u8(layer.opacity == null ? 255 : Math.max(0, Math.min(255, Math.round(layer.opacity))));
  w.u8(layer.clipping ? 1 : 0);
  w.u8(layer.hidden ? 2 : 0);
  w.u8(0);

  var extra = w.mark();
  w.u32(0);                       // no layer mask
  w.u32(0);                       // no blending ranges
  w.pascal(psdAsciiName(layer.name), 4);   // legacy single-byte name

  var blocks = [];
  var luni = psdWriter();
  luni.unicode(layer.name);
  blocks.push(['luni', luni.done(), 2]);

  if (layer.smartObject) {
    blocks.push(['SoLd', psdSmartObjectSoLd(layer.smartObject), 2]);
    blocks.push(['PlLd', psdSmartObjectPlLd(layer.smartObject), 2]);
  }

  for (var b = 0; b < blocks.length; b++) {
    w.key('8BIM').key(blocks[b][0]);
    var token = w.mark();
    w.bytes(blocks[b][1]);
    w.close(token, blocks[b][2]);
  }
  w.close(extra, 2);
}

function psdWriteChannelData(w, channels) {
  for (var i = 0; i < channels.length; i++) {
    var packed = channels[i].packed;
    w.u16(1);
    for (var c = 0; c < packed.counts.length; c++) w.u16(packed.counts[c]);
    for (var r = 0; r < packed.rows.length; r++) w.bytes(packed.rows[r]);
  }
}

/* ---------------- document ----------------
   spec = {
     width, height, transparent,
     layers: [{ name, x, y, w, h, rgba, blend, opacity, clipping, hidden,
                smartObject?: { uuid, name, corners, w, h, fileName, fileBytes } }],
     composite: RGBA bytes for the flattened document
   }
   Layers are bottom-first, exactly as PSD stores them. */
function psdBuild(spec) {
  var width = Math.max(1, Math.round(spec.width));
  var height = Math.max(1, Math.round(spec.height));
  var layers = spec.layers || [];
  var transparent = !!spec.transparent;
  var channelCount = transparent ? 4 : 3;
  var w = psdWriter();

  /* 1. header */
  w.ascii('8BPS').u16(1).zeros(6).u16(channelCount).u32(height).u32(width).u16(8).u16(3);

  /* 2. colour mode data: empty for RGB */
  w.u32(0);

  /* 3. image resources: empty is valid, Photoshop applies its defaults */
  w.u32(0);

  /* 4. layer and mask information */
  var layerMask = w.mark();
  var layerInfo = w.mark();
  w.i16(transparent ? -layers.length : layers.length);
  var prepared = layers.map(function (layer) { return { layer: layer, channels: psdLayerPixels(layer) }; });
  for (var i = 0; i < prepared.length; i++) psdWriteLayerRecord(w, prepared[i].layer, prepared[i].channels);
  for (var j = 0; j < prepared.length; j++) psdWriteChannelData(w, prepared[j].channels);
  w.close(layerInfo, 2);
  w.u32(0);                          // global layer mask info

  var linked = layers.filter(function (l) { return l.smartObject && l.smartObject.fileBytes; });
  if (linked.length) {
    w.key('8BIM').key('lnk2');
    var token = w.mark();
    for (var k = 0; k < linked.length; k++) w.bytes(psdLinkedData(linked[k].smartObject));
    w.close(token, 4);
  }
  w.close(layerMask, 2);

  /* 5. flattened composite, RLE compressed */
  var planes = psdChannels(spec.composite, width, height);
  var order = [planes.r, planes.g, planes.b];
  if (transparent) order.push(planes.a);
  var packedPlanes = order.map(function (plane) { return psdPackRows(plane, width, height); });
  w.u16(1);
  for (var p = 0; p < packedPlanes.length; p++) {
    for (var c = 0; c < packedPlanes[p].counts.length; c++) w.u16(packedPlanes[p].counts[c]);
  }
  for (var q = 0; q < packedPlanes.length; q++) {
    for (var r = 0; r < packedPlanes[q].rows.length; r++) w.bytes(packedPlanes[q].rows[r]);
  }

  return w.done();
}

/* A stable smart-object identifier. Photoshop matches the layer to its
   embedded file by this string, so it must be identical in both places. */
function psdUuid() {
  var hex = '0123456789abcdef';
  var out = '';
  for (var i = 0; i < 32; i++) {
    out += hex[Math.floor(Math.random() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) out += '-';
  }
  return out;
}

/* Corner sanity. A degenerate quad cannot be corner-pinned, so the caller
   falls back to a pre-warped pixel layer instead of writing a smart object
   Photoshop would place wrongly. */
function psdQuadUsable(corners) {
  if (!corners || corners.length !== 4) return false;
  for (var i = 0; i < 4; i++) {
    if (!corners[i] || !isFinite(corners[i].x) || !isFinite(corners[i].y)) return false;
  }
  var area = 0;
  for (var j = 0; j < 4; j++) {
    var a = corners[j], b = corners[(j + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area / 2);
  var side = Infinity;
  for (var k = 0; k < 4; k++) {
    var p = corners[k], q = corners[(k + 1) % 4];
    side = Math.min(side, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return area >= 16 && side >= 2;
}

/* psd-core-end */

/* =========================================================================
   STUDIO WIRING
   The only part of this file that reads the document. Every path runs inside
   try/catch: a PSD failure reports itself and leaves the Studio untouched.
   ========================================================================= */
;(function () {
  var button = document.getElementById('btnExportPsd');
  if (!button) return;

  /* A PSD is assembled in memory, so a very large document is worth warning
     about before the browser has to hold every layer at once. */
  var PSD_PIXEL_WARNING = 12000000;
  var PSD_MAX_SIDE = 30000;
  var PSD_SMART_NAME = 'YOUR DESIGN — double-click to replace';

  function psdPixels(canvas, x, y, w, h) {
    var c = canvas.getContext('2d', { willReadFrequently: true });
    return new Uint8Array(c.getImageData(x || 0, y || 0, w || canvas.width, h || canvas.height).data);
  }

  function psdHasPixels(rgba) {
    for (var i = 3; i < rgba.length; i += 4) if (rgba[i] > 2) return true;
    return false;
  }

  function psdFullLayer(name, only, blend) {
    var off = exportCanvas({ scale: 1, only: only, bg: false });
    var rgba = psdPixels(off);
    if (!psdHasPixels(rgba)) return null;
    return { name: name, x: 0, y: 0, w: off.width, h: off.height, rgba: rgba, blend: blend || 'normal' };
  }

  function psdSolidLayer(name, colour) {
    var off = document.createElement('canvas');
    off.width = doc.canvas.w;
    off.height = doc.canvas.h;
    var c = off.getContext('2d');
    c.fillStyle = colour;
    c.fillRect(0, 0, off.width, off.height);
    return { name: name, x: 0, y: 0, w: off.width, h: off.height, rgba: psdPixels(off) };
  }

  /* The artwork that ships inside the smart object. Either whatever is in the
     frame right now, or a built-in placeholder that tells the buyer what to do. */
  function psdArtCanvas(frame, source) {
    if (source === 'frame' && typeof frameContentCanvas === 'function') {
      var content = frameContentCanvas(frame, 1);
      if (content) return content;
    }
    var box = bbox(frame.points);
    var w = Math.max(2, Math.round(box.w));
    var h = Math.max(2, Math.round(box.h));
    var off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    var c = off.getContext('2d');
    var gradient = c.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#2C5F9E');
    gradient.addColorStop(1, '#1B3A63');
    c.fillStyle = gradient;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,.88)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '700 ' + Math.max(12, Math.round(h * 0.13)) + 'px -apple-system,Segoe UI,Roboto,sans-serif';
    c.fillText('YOUR DESIGN', w / 2, h * 0.46);
    c.fillStyle = 'rgba(255,255,255,.62)';
    c.font = '500 ' + Math.max(10, Math.round(h * 0.065)) + 'px -apple-system,Segoe UI,Roboto,sans-serif';
    c.fillText('double-click this layer in Photoshop', w / 2, h * 0.6);
    return off;
  }

  /* Paint the art through the opening exactly as the Studio renders it, then
     crop to the opening's bounding box: those are the smart-object pixels. */
  function psdOpeningLayer(frame, art, smart) {
    var off = document.createElement('canvas');
    off.width = doc.canvas.w;
    off.height = doc.canvas.h;
    var c = off.getContext('2d');
    var points = frame.points;
    var box = bbox(points);
    if (typeof isAxisRect === 'function' && isAxisRect(points)) {
      c.drawImage(art, box.x, box.y, box.w, box.h);
    } else {
      warpQuad(c, art, points, 28, 0.6);
    }
    var x = Math.max(0, Math.floor(box.x));
    var y = Math.max(0, Math.floor(box.y));
    var w = Math.max(1, Math.min(off.width - x, Math.ceil(box.x + box.w) - x));
    var h = Math.max(1, Math.min(off.height - y, Math.ceil(box.y + box.h) - y));
    var out = {
      name: smart ? PSD_SMART_NAME : 'YOUR DESIGN — flattened, this opening cannot be corner-pinned',
      x: x, y: y, w: w, h: h, rgba: psdPixels(off, x, y, w, h),
    };
    if (smart) {
      out.smartObject = {
        uuid: psdUuid(),
        name: PSD_SMART_NAME,
        corners: points.slice(0, 4).map(function (p) { return { x: p.x, y: p.y }; }),
        w: art.width,
        h: art.height,
        fileName: 'FrameForge artwork.png',
        fileBytes: psdDataUrlBytes(art.toDataURL('image/png')),
      };
    }
    return out;
  }

  function psdDataUrlBytes(dataUrl) {
    var base64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
    var binary = atob(base64);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  /* Frames that can hold artwork, selected one first. */
  function psdFrames() {
    var frames = doc.layers.filter(function (l) {
      return l.visible && l.type === 'frame' && l.points && l.points.length === 4;
    });
    var chosen = sel ? layer(sel) : null;
    if (chosen && frames.indexOf(chosen) >= 0) {
      return [chosen].concat(frames.filter(function (f) { return f !== chosen; }));
    }
    return frames;
  }

  /* Studio document -> psdBuild spec. */
  function psdFromDoc(options) {
    var transparent = options.background === 'transparent';
    var layers = [];
    var flattened = 0;

    if (!transparent) {
      var background = doc.canvas.bg && doc.canvas.bg !== 'transparent' ? doc.canvas.bg : '#FFFFFF';
      layers.push(psdSolidLayer('Background', background));
    }

    var scene = psdFullLayer('Scene', ['image', 'shape', 'text'], 'normal');
    if (scene) layers.push(scene);

    options.frames.forEach(function (frame) {
      var art = psdArtCanvas(frame, options.art);
      var smart = psdQuadUsable(frame.points);
      if (!smart) flattened++;
      layers.push(psdOpeningLayer(frame, art, smart));
    });

    var shadow = psdFullLayer('Shadow', ['shadow'], 'multiply');
    if (shadow) layers.push(shadow);

    var overlay = psdFullLayer('Mockup overlay', ['overlay'], 'normal');
    if (overlay) layers.push(overlay);

    var composite = exportCanvas({ scale: 1, bg: !transparent });
    return {
      spec: {
        width: doc.canvas.w,
        height: doc.canvas.h,
        transparent: transparent,
        layers: layers,
        composite: psdPixels(composite),
      },
      flattened: flattened,
    };
  }

  button.addEventListener('click', async function () {
    try {
      var frames = psdFrames();
      if (!frames.length) { toast('Create or select a frame first'); return; }
      if (doc.canvas.w > PSD_MAX_SIDE || doc.canvas.h > PSD_MAX_SIDE) {
        toast('Photoshop cannot open a PSD wider or taller than ' + PSD_MAX_SIDE + 'px · fit the canvas first');
        return;
      }

      var hasContent = !!(frames[0].content && frames[0].content.src);
      var form = await uiForm({
        title: 'Export Photoshop PSD',
        message: 'The opening is written as a smart object, so a buyer double-clicks one layer and drops their artwork in.',
        confirmLabel: 'Export PSD',
        fields: [
          {
            name: 'name', label: 'File name', value: 'FrameForge Mockup',
            hint: 'Saved as a .psd next to your other downloads.',
          },
          {
            name: 'background', label: 'Background', value: 'white',
            hint: 'Type white or transparent.',
          },
          {
            name: 'art', label: 'Placeholder art', value: hasContent ? 'frame' : 'built-in',
            hint: hasContent ? 'Type frame to embed the current artwork, or built-in.' : 'Type built-in. The frames are empty, so there is nothing to embed.',
          },
        ],
        validate: function (values) {
          if (!values.name.trim()) return 'Enter a file name.';
          if (['white', 'transparent'].indexOf(values.background.toLowerCase()) < 0) return 'Background must be white or transparent.';
          if (['frame', 'built-in'].indexOf(values.art.toLowerCase()) < 0) return 'Placeholder art must be frame or built-in.';
          return null;
        },
      });
      if (!form) return;

      if (doc.canvas.w * doc.canvas.h > PSD_PIXEL_WARNING) {
        toast('Large canvas · building the PSD in memory may take a moment');
      }

      var label = button.textContent;
      button.disabled = true;
      button.textContent = 'Building PSD…';
      try {
        var built = psdFromDoc({
          frames: frames,
          background: form.background.toLowerCase(),
          art: form.art.toLowerCase(),
        });
        var bytes = psdBuild(built.spec);
        var file = form.name.trim().replace(/\.psd$/i, '') + '.psd';
        download(new Blob([bytes], { type: 'image/vnd.adobe.photoshop' }), file);
        var smartCount = built.spec.layers.filter(function (l) { return !!l.smartObject; }).length;
        toast(file + ' exported · ' + built.spec.layers.length + ' layer(s), ' + smartCount + ' smart object(s)' +
          (built.flattened ? ' · ' + built.flattened + ' opening(s) were flattened because they cannot be corner-pinned' : ''));
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    } catch (error) {
      console.error('PSD export failed', error);
      toast('PSD export failed: ' + String((error && error.message) || error));
    }
  });
})();
