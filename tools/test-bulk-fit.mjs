#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'js/19-toolbar.js'), 'utf8');
const start = source.indexOf('  function shiftPath(');
const end = source.indexOf('  async function fitPrepared(', start);
if (start < 0 || end < 0) throw Error('Bulk fit helpers missing');
const api = runInNewContext(source.slice(start, end) + '\n({ shiftPath, bounds })', {}, { timeout: 5000 });
function equal(actual, expected, label) {
  if (actual !== expected) throw Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log('PASS ' + label);
}
equal(api.shiftPath('M 30 40 L 70 40 L 70 80 Z', 20, 20),
  'M 10 20 L 50 20 L 50 60 Z', 'overlay coordinates shift');
equal(api.shiftPath('M100 90l5-3c2 4 6 8 9 10zL 30 40Z', 20, 20),
  'M80 70l5-3c2 4 6 8 9 10zL 10 20Z', 'relative silhouette segments preserved and absolute bridge shifted');
equal(api.shiftPath('M0 0H120V60h-50z', 0, 0),
  'M0 0H120V60h-50z', 'zero offset leaves path byte-identical');
const png = new Uint8ClampedArray(100 * 80 * 4);
for (let y = 25; y <= 54; y++) for (let x = 30; x <= 69; x++) png[(y * 100 + x) * 4 + 3] = 255;
const fake = { width: 100, height: 80, getContext() { return {
  fill() {}, getImageData() { return { data: png }; }
}; } };
const b = api.bounds(fake, [], 20);
equal(JSON.stringify(b), JSON.stringify({ x0:10, y0:5, w:80, h:70 }), '20px padding on each available side');
if (!source.includes('bulkPrepareOne = async function') || !source.includes('return fitPrepared(await originalPrepare(...args))')) throw Error('Bulk fit not wired before publish');
console.log('Bulk fit regression checks passed');
