#!/usr/bin/env node
/* =========================================================================
   Native PSD export

   The PSD writer in js/20-psd-export.js is pure, so the real implementation
   is lifted out of the bundle and evaluated in a bare VM context. Nothing is
   re-implemented here: every file this test builds is parsed back out of the
   bytes the Studio would actually download, so a change to the writer cannot
   pass on a stale copy of the logic.

   Run: node tools/test-psd-export.mjs
   ========================================================================= */

import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed++; console.log('PASS ' + label); return; }
  failures.push(label + (detail ? ' -> ' + detail : ''));
  console.log('FAIL ' + label + (detail ? ' -> ' + detail : ''));
}
function equal(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
const close = (a, b) => Math.abs(a - b) < 0.01;

/* ---------------- load the real writer ---------------- */

const source = read('js', '20-psd-export.js');
const START = '/* psd-core-start */';
const END = '/* psd-core-end */';
const start = source.indexOf(START);
const end = source.indexOf(END);
if (start < 0 || end <= start) {
  console.error(`Could not find the pure PSD core in js/20-psd-export.js between "${START}" and "${END}".`);
  console.error('If it was renamed or moved, update this test rather than deleting it.');
  process.exit(1);
}

let psd;
try {
  psd = runInNewContext(
    source.slice(start, end) +
    '\n({ psdWriter, psdPackBits, psdPackRows, psdChannels, psdBuild, psdUuid, psdQuadUsable, psdAsciiName })',
    { Uint8Array, DataView, ArrayBuffer, Math, isFinite, Error, String, Number, JSON },
    { timeout: 20000 },
  );
} catch (error) {
  console.error('Could not evaluate the PSD core:', error.message);
  process.exit(1);
}

/* ---------------- PackBits round trip ---------------- */

function unpackBits(src, expected) {
  const out = new Uint8Array(expected);
  let at = 0, i = 0;
  while (i < src.length && at < expected) {
    const n = src[i++] << 24 >> 24;          // signed
    if (n >= 0) {
      for (let k = 0; k <= n; k++) out[at++] = src[i++];
    } else if (n !== -128) {
      const v = src[i++];
      for (let k = 0; k < 1 - n; k++) out[at++] = v;
    }
  }
  return { bytes: out, read: i, wrote: at };
}

const patterns = {
  'random noise': Uint8Array.from({ length: 5000 }, () => Math.floor(Math.random() * 256)),
  'one long run': new Uint8Array(4000).fill(7),
  'alternating bytes': Uint8Array.from({ length: 3001 }, (_, i) => (i % 2 ? 255 : 0)),
  'runs of exactly three': Uint8Array.from({ length: 900 }, (_, i) => Math.floor(i / 3) & 255),
  'run longer than 128': new Uint8Array(400).fill(3),
  'single byte': new Uint8Array([42]),
  'two bytes': new Uint8Array([9, 9]),
  'empty': new Uint8Array(0),
};
for (const [name, input] of Object.entries(patterns)) {
  const packed = psd.psdPackBits(input);
  const round = unpackBits(packed, input.length);
  check(`PackBits round trips ${name}`, Buffer.from(round.bytes).equals(Buffer.from(input)), `${input.length} bytes in`);
  check(`PackBits consumes all of ${name}`, round.read === packed.length, `${round.read}/${packed.length}`);
}
check('PackBits shrinks a long run', psd.psdPackBits(new Uint8Array(4000).fill(7)).length < 100);
check('PackBits never exceeds the worst case',
  psd.psdPackBits(patterns['random noise']).length <= 5000 + Math.ceil(5000 / 128));

/* ---------------- channel de-interleaving ---------------- */
{
  const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const planes = psd.psdChannels(rgba, 2, 1);
  check('psdChannels splits RGBA into planes',
    planes.r[0] === 1 && planes.g[0] === 2 && planes.b[0] === 3 && planes.a[0] === 4 && planes.r[1] === 5);
}

/* ---------------- a full document ---------------- */

function solid(w, h, [r, g, b, a]) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a; }
  return out;
}

const CORNERS = [{ x: 120, y: 80 }, { x: 610.5, y: 96.25 }, { x: 600, y: 520 }, { x: 130, y: 500 }];
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gEBAAD//wAAAAD//wAAAAD//w==',
  'base64');

const uuid = psd.psdUuid();
const spec = {
  width: 800,
  height: 600,
  transparent: false,
  layers: [
    { name: 'Background', x: 0, y: 0, w: 800, h: 600, rgba: solid(800, 600, [255, 255, 255, 255]) },
    {
      name: 'YOUR DESIGN — double-click to replace', x: 120, y: 80, w: 491, h: 441,
      rgba: solid(491, 441, [40, 90, 160, 255]),
      smartObject: {
        uuid, name: 'YOUR DESIGN', corners: CORNERS, w: 491, h: 441,
        fileName: 'FrameForge artwork.png', fileBytes: new Uint8Array(PNG_BYTES),
      },
    },
    { name: 'Shadow', x: 0, y: 0, w: 800, h: 600, blend: 'multiply', opacity: 230, rgba: solid(800, 600, [0, 0, 0, 90]) },
    { name: 'Mockup overlay', x: 0, y: 0, w: 800, h: 600, rgba: solid(800, 600, [200, 30, 30, 255]) },
  ],
  composite: solid(800, 600, [12, 34, 56, 255]),
};

const bytes = psd.psdBuild(spec);
check('psdBuild returns bytes', bytes instanceof Uint8Array && bytes.length > 1000, String(bytes && bytes.length));

/* ---------------- parse the file back ---------------- */

function reader(buf) {
  let at = 0;
  const api = {
    get at() { return at; },
    seek(to) { at = to; return api; },
    skip(n) { at += n; return api; },
    u8: () => buf[at++],
    u16: () => { const v = buf.readUInt16BE(at); at += 2; return v; },
    i16: () => { const v = buf.readInt16BE(at); at += 2; return v; },
    u32: () => { const v = buf.readUInt32BE(at); at += 4; return v; },
    i32: () => { const v = buf.readInt32BE(at); at += 4; return v; },
    u64: () => { const v = Number(buf.readBigUInt64BE(at)); at += 8; return v; },
    f64: () => { const v = buf.readDoubleBE(at); at += 8; return v; },
    ascii: (n) => { const v = buf.toString('latin1', at, at + n); at += n; return v; },
    pascal: (pad) => {
      const n = buf[at++];
      const v = buf.toString('latin1', at, at + n);
      at += n;
      if (pad > 1) { const over = (1 + n) % pad; if (over) at += pad - over; }
      return v;
    },
    unicode: () => {
      const n = api.u32();
      let v = '';
      for (let i = 0; i < n; i++) { const code = api.u16(); if (code) v += String.fromCharCode(code); }
      return v;
    },
  };
  return api;
}

const file = Buffer.from(bytes);
const r = reader(file);

equal('signature is 8BPS', r.ascii(4), '8BPS');
equal('version is 1', r.u16(), 1);
r.skip(6);
equal('channel count is 3 for an opaque document', r.u16(), 3);
equal('height matches the document', r.u32(), 600);
equal('width matches the document', r.u32(), 800);
equal('depth is 8 bits', r.u16(), 8);
equal('colour mode is RGB', r.u16(), 3);
equal('colour mode data is empty', r.u32(), 0);
equal('image resources are empty', r.u32(), 0);

const layerMaskLength = r.u32();
const layerMaskEnd = r.at + layerMaskLength;
const layerInfoLength = r.u32();
const layerInfoEnd = r.at + layerInfoLength;
equal('layer count', r.i16(), 4);

const records = [];
for (let i = 0; i < 4; i++) {
  const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
  const channelCount = r.u16();
  const channels = [];
  for (let c = 0; c < channelCount; c++) channels.push({ id: r.i16(), length: r.u32() });
  const blendSig = r.ascii(4);
  const blendKey = r.ascii(4);
  const opacity = r.u8();
  const clipping = r.u8();
  const flags = r.u8();
  r.skip(1);
  const extraLength = r.u32();
  const extraEnd = r.at + extraLength;
  r.skip(r.u32());                       // layer mask data
  r.skip(r.u32());                       // blending ranges
  const legacyName = r.pascal(4);
  const blocks = {};
  while (r.at + 12 <= extraEnd) {
    const sig = r.ascii(4);
    const key = r.ascii(4);
    const length = r.u32();
    const bodyAt = r.at;
    if (sig !== '8BIM') break;
    blocks[key] = { at: bodyAt, length };
    r.seek(bodyAt + length + (length % 2 ? 1 : 0));
  }
  r.seek(extraEnd);
  records.push({ top, left, bottom, right, channels, blendSig, blendKey, opacity, clipping, flags, legacyName, blocks });
}

equal('layer order is bottom first', records.map((l) => l.legacyName).join(' | '),
  'Background | YOUR DESIGN - double-click to replace | Shadow | Mockup overlay');
equal('a non-ASCII name is folded, never truncated to control bytes',
  psd.psdAsciiName('YOUR DESIGN — double-click to replace'), 'YOUR DESIGN - double-click to replace');
equal('the shadow layer is multiply', records[2].blendKey, 'mul ');
equal('every other layer is normal', records.filter((l) => l.blendKey === 'norm').length, 3);
equal('blend signature is 8BIM', records.every((l) => l.blendSig === '8BIM'), true);
equal('shadow opacity survives', records[2].opacity, 230);
equal('default opacity is opaque', records[0].opacity, 255);
equal('the smart-object layer bounds match the opening bbox',
  [records[1].left, records[1].top, records[1].right, records[1].bottom].join(','), '120,80,611,521');
equal('every layer writes alpha plus RGB', records.every((l) => l.channels.map((c) => c.id).join(',') === '-1,0,1,2'), true);

/* Unicode names carry the exact name, including characters ASCII cannot hold. */
spec.layers.forEach((layer, i) => {
  const u = reader(file).seek(records[i].blocks.luni.at).unicode();
  equal(`unicode name kept for "${layer.name}"`, u, layer.name);
});
const soLayer = records[1];
check('the em dash survives in the unicode name',
  reader(file).seek(soLayer.blocks.luni.at).unicode() === 'YOUR DESIGN — double-click to replace');

/* ---------------- smart object ---------------- */

check('smart object writes SoLd', !!soLayer.blocks.SoLd);
check('smart object writes PlLd', !!soLayer.blocks.PlLd);
check('no plain layer carries smart-object keys',
  [0, 2, 3].every((i) => !records[i].blocks.SoLd && !records[i].blocks.PlLd));

{
  const p = reader(file).seek(soLayer.blocks.PlLd.at);
  equal('PlLd identifier', p.ascii(4), 'plcL');
  equal('PlLd version', p.u32(), 3);
  equal('PlLd carries the smart-object id', p.pascal(1), uuid);
  equal('PlLd page number', p.u32(), 1);
  equal('PlLd total pages', p.u32(), 1);
  p.u32();                                // anti-alias policy
  equal('PlLd placed layer type is raster', p.u32(), 2);
  const corners = [];
  for (let i = 0; i < 4; i++) corners.push({ x: p.f64(), y: p.f64() });
  check('PlLd holds the four opening corners',
    corners.every((c, i) => close(c.x, CORNERS[i].x) && close(c.y, CORNERS[i].y)),
    JSON.stringify(corners));
}

{
  const s = reader(file).seek(soLayer.blocks.SoLd.at);
  equal('SoLd identifier', s.ascii(4), 'soLD');
  equal('SoLd version', s.u32(), 4);
  equal('SoLd descriptor version', s.u32(), 16);
  s.unicode();                            // descriptor name
  const classLength = s.u32();
  s.ascii(classLength || 4);
  const itemCount = s.u32();
  check('SoLd descriptor has the placed-layer keys', itemCount >= 12, String(itemCount));
  const keys = [];
  let trnf = null;
  for (let i = 0; i < itemCount; i++) {
    const keyLength = s.u32();
    const key = s.ascii(keyLength || 4);
    keys.push(key);
    const type = s.ascii(4);
    if (type === 'doub') s.f64();
    else if (type === 'long') s.u32();
    else if (type === 'bool') s.u8();
    else if (type === 'TEXT') s.unicode();
    else if (type === 'UntF') { s.ascii(4); s.f64(); }
    else if (type === 'enum') { const a = s.u32(); s.ascii(a || 4); const b = s.u32(); s.ascii(b || 4); }
    else if (type === 'VlLs') {
      const n = s.u32();
      const values = [];
      for (let v = 0; v < n; v++) { s.ascii(4); values.push(s.f64()); }
      if (key === 'Trnf') trnf = values;
    } else if (type === 'Objc') {
      // Nested descriptors are skipped by walking them with the same reader.
      const skip = (rd) => {
        rd.unicode();
        const cl = rd.u32();
        rd.ascii(cl || 4);
        const n = rd.u32();
        for (let i2 = 0; i2 < n; i2++) {
          const kl = rd.u32();
          rd.ascii(kl || 4);
          const t = rd.ascii(4);
          if (t === 'doub') rd.f64();
          else if (t === 'long') rd.u32();
          else if (t === 'bool') rd.u8();
          else if (t === 'TEXT') rd.unicode();
          else if (t === 'UntF') { rd.ascii(4); rd.f64(); }
          else if (t === 'enum') { const a = rd.u32(); rd.ascii(a || 4); const b = rd.u32(); rd.ascii(b || 4); }
          else if (t === 'Objc') skip(rd);
          else if (t === 'VlLs') { const m = rd.u32(); for (let v = 0; v < m; v++) { rd.ascii(4); rd.f64(); } }
          else throw new Error('unknown nested type ' + t);
        }
      };
      skip(s);
    } else throw new Error('unknown descriptor type ' + type);
  }
  check('SoLd identifies the embedded file', keys.includes('Idnt') && keys.includes('placed'), keys.join(','));
  check('SoLd carries a transform', Array.isArray(trnf) && trnf.length === 8, JSON.stringify(trnf));
  check('SoLd transform is the opening quad',
    trnf && CORNERS.every((c, i) => close(trnf[i * 2], c.x) && close(trnf[i * 2 + 1], c.y)),
    JSON.stringify(trnf));
  check('SoLd declares the placed size', keys.includes('Sz  ') && keys.includes('Rslt'), keys.join(','));
}

/* ---------------- channel data and the linked file ---------------- */

let channelAt = r.at;
for (const layer of records) {
  const rows = layer.bottom - layer.top;
  for (const channel of layer.channels) {
    const cr = reader(file).seek(channelAt);
    equal(`channel ${channel.id} of "${layer.legacyName}" is RLE`, cr.u16(), 1);
    let counted = 2;
    let total = 0;
    for (let y = 0; y < rows; y++) { total += cr.u16(); counted += 2; }
    check(`channel ${channel.id} of "${layer.legacyName}" declares its real length`,
      channel.length === counted + total, `record says ${channel.length}, data is ${counted + total}`);
    channelAt += channel.length;
  }
}
equal('layer channel data ends where the layer info block ends', channelAt, layerInfoEnd);

r.seek(layerInfoEnd);
equal('global layer mask info is empty', r.u32(), 0);
equal('the linked-file block follows', r.ascii(4) + r.ascii(4), '8BIMlnk2');
{
  const blockLength = r.u32();
  const itemLength = r.u64();
  equal('linked item type is embedded data', r.ascii(4), 'liFD');
  equal('linked item version', r.u32(), 2);
  equal('linked item id matches the layer', r.pascal(1), uuid);
  equal('linked item keeps the file name', r.unicode(), 'FrameForge artwork.png');
  equal('linked item file type', r.ascii(4), 'PNGf');
  r.ascii(4);
  const dataLength = r.u64();
  equal('linked item data length is the PNG length', dataLength, PNG_BYTES.length);
  equal('linked item has no open descriptor', r.u8(), 0);
  const embedded = file.subarray(r.at, r.at + dataLength);
  check('the embedded bytes are a PNG',
    embedded[0] === 0x89 && embedded.toString('latin1', 1, 4) === 'PNG', embedded.toString('hex', 0, 8));
  check('the embedded bytes are the placeholder art', embedded.equals(PNG_BYTES));
  check('the linked block is long enough for its item', blockLength >= itemLength + 8, `${blockLength} vs ${itemLength}`);
}

check('the layer and mask section ends where it declared', layerMaskEnd <= file.length, `${layerMaskEnd}/${file.length}`);

/* ---------------- the flattened composite ---------------- */
{
  const c = reader(file).seek(layerMaskEnd);
  equal('composite is RLE compressed', c.u16(), 1);
  const counts = [];
  for (let i = 0; i < 3 * 600; i++) counts.push(c.u16());
  let at = c.at;
  const plane = [];
  for (let i = 0; i < counts.length; i++) {
    const row = unpackBits(file.subarray(at, at + counts[i]), 800);
    plane.push(row.bytes);
    at += counts[i];
  }
  check('composite decodes to the document size', plane.length === 1800 && plane[0].length === 800);
  check('composite red channel is the flattened pixel', plane[0].every((v) => v === 12));
  check('composite green channel is the flattened pixel', plane[600].every((v) => v === 34));
  check('composite blue channel is the flattened pixel', plane[1200].every((v) => v === 56));
  equal('the file ends with the composite', at, file.length);
}

/* ---------------- transparent background ---------------- */
{
  const clear = psd.psdBuild({
    width: 4, height: 3, transparent: true,
    layers: [{ name: 'Only', x: 0, y: 0, w: 4, h: 3, rgba: solid(4, 3, [1, 2, 3, 4]) }],
    composite: solid(4, 3, [9, 8, 7, 0]),
  });
  const t = reader(Buffer.from(clear));
  t.ascii(4); t.u16(); t.skip(6);
  equal('a transparent document declares four channels', t.u16(), 4);
  t.u32(); t.u32(); t.u16(); t.u16(); t.u32(); t.u32();
  t.u32(); t.u32();
  equal('a transparent document uses a negative layer count', t.i16(), -1);
}

/* ---------------- degenerate input must not throw ---------------- */

const degenerate = [
  ['1x1 document', { width: 1, height: 1, layers: [{ name: 'Dot', x: 0, y: 0, w: 1, h: 1, rgba: solid(1, 1, [1, 2, 3, 255]) }], composite: solid(1, 1, [1, 2, 3, 255]) }],
  ['one pixel wide layer', { width: 8, height: 8, layers: [{ name: 'Hair', x: 3, y: 0, w: 1, h: 8, rgba: solid(1, 8, [0, 0, 0, 255]) }], composite: solid(8, 8, [255, 255, 255, 255]) }],
  ['fully transparent layer', { width: 8, height: 8, layers: [{ name: 'Clear', x: 0, y: 0, w: 8, h: 8, rgba: solid(8, 8, [0, 0, 0, 0]) }], composite: solid(8, 8, [255, 255, 255, 255]) }],
  ['zero area layer', { width: 8, height: 8, layers: [{ name: 'Nothing', x: 2, y: 2, w: 0, h: 0, rgba: new Uint8Array(0) }], composite: solid(8, 8, [255, 255, 255, 255]) }],
  ['no layers at all', { width: 8, height: 8, layers: [], composite: solid(8, 8, [255, 255, 255, 255]) }],
];
for (const [label, input] of degenerate) {
  let out = null, error = null;
  try { out = psd.psdBuild(input); } catch (e) { error = e; }
  check(`psdBuild survives a ${label}`, !!out && !error, error ? error.message : 'no bytes');
  if (out) check(`the ${label} still starts with 8BPS`, Buffer.from(out).toString('latin1', 0, 4) === '8BPS');
}

/* ---------------- quad guard ---------------- */

check('a healthy quad is usable', psd.psdQuadUsable(CORNERS));
check('a collapsed quad is refused', !psd.psdQuadUsable([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]));
check('a zero-height quad is refused', !psd.psdQuadUsable([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }]));
check('a quad with a NaN corner is refused',
  !psd.psdQuadUsable([{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]));
check('a three point opening is refused', !psd.psdQuadUsable([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]));
check('a missing opening is refused', !psd.psdQuadUsable(null));
check('psdUuid is unique enough', new Set(Array.from({ length: 200 }, () => psd.psdUuid())).size === 200);

/* ---------------- source guards ---------------- */

const studio = read('index.html');
check('index.html loads the PSD module', /<script[^>]+js\/20-psd-export\.js/.test(studio), 'index.html');
check('the Export menu offers a PSD item', /id="btnExportPsd"/.test(studio), 'index.html');
check('the PSD module guards its handler', /try\s*{/.test(source) && /catch/.test(source), 'js/20-psd-export.js');
check('the PSD module keeps its pure core marked', source.includes(START) && source.includes(END), 'js/20-psd-export.js');

/* A file that can be written but not opened is worth nothing, so keep one
   real sample on disk for a manual Photoshop check. */
const sample = join(tmpdir(), 'frameforge-psd-export-sample.psd');
writeFileSync(sample, file);
console.log(`\nSample written for a manual Photoshop open: ${sample}`);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nThe PSD export is not safe to ship:');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
