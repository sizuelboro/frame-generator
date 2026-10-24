#!/usr/bin/env node
/* =========================================================================
   One-time migration: strip the inline <script> blocks out of index.html and
   replace them with the ordered js/ bundle that tests/studio.test.html
   already loads.

   Run from the project root:  node tools/inline-to-bundle.mjs
   A backup is written to index.html.bak before anything is changed.
   ========================================================================= */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'index.html');

const COMMENTS = {
  '00-demo-overlay.js': 'bundled demo artwork',
  '01-limits.js': 'GENERATED from shared/frameforge-limits.js',
  '02-state.js': 'document state + image cache',
  '03-geometry.js': 'homography and quad warping',
  '04-render.js': 'canvas renderer',
  '05-layers.js': 'layers, tools, hit-testing',
  '06-properties.js': 'property panel',
  '07-shadow.js': 'shadow, export, cloud publish',
  '08-files.js': 'export, project files, saved mockups, zoom',
  '09-trace.js': 'tracer, simplifier, background removal',
  '10-dialogs.js': 'in-app dialogs',
  '11-detect.js': 'screen + opening detection',
  '12-silhouette.js': 'silhouette and hole handling',
  '13-scene.js': 'scene plate and colour key',
  '14-wand.js': 'magic wand opening',
  '15-download.js': 'download fallback',
  '16-build-info.js': 'build marker, loaded last',
};

function die(message) {
  console.error('ABORTED: ' + message);
  console.error('index.html was not modified.');
  process.exit(1);
}

if (!existsSync(htmlPath)) die('index.html not found at ' + htmlPath);

const files = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).sort();
if (files.length === 0) die('js/ has no .js files to bundle');

const html = readFileSync(htmlPath, 'utf8');

/* Locate the span to remove: from the first inline <script> (one without a
   src attribute) through the very last </script> in the document. */
const inlineOpen = /<script(?![^>]*\bsrc=)[^>]*>/i.exec(html);
if (!inlineOpen) {
  console.log('No inline <script> found. index.html is already migrated.');
  process.exit(0);
}

const start = inlineOpen.index;
const lastClose = html.toLowerCase().lastIndexOf('</script>');
if (lastClose < start) die('could not find a closing </script> after the first inline script');
const end = lastClose + '</script>'.length;

/* Safety: nothing but whitespace, comments and </body></html> may follow. */
const tail = html.slice(end).replace(/<!--[\s\S]*?-->/g, '').trim();
if (!/^(<\/body>)?\s*(<\/html>)?$/i.test(tail)) {
  die('unexpected markup after the last </script>:\n  ' + tail.slice(0, 200));
}

/* Safety: the demo overlay and build marker must already live in js/. */
const removed = html.slice(start, end);
if (/DEMO_OVERLAY/.test(removed)) {
  const overlay = readFileSync(join(root, 'js', '00-demo-overlay.js'), 'utf8');
  if (!/DEMO_OVERLAY/.test(overlay)) die('js/00-demo-overlay.js does not define DEMO_OVERLAY');
}

const tags = ['<!-- Ordered classic-script bundle. Shared global scope on purpose: keep this order. -->'];
for (const f of files) tags.push(`<script src="js/${f}"></script><!-- ${COMMENTS[f] || f} -->`);

writeFileSync(join(root, 'index.html.bak'), html, 'utf8');
writeFileSync(htmlPath, html.slice(0, start) + tags.join('\n') + html.slice(end), 'utf8');

const before = Math.round(html.length / 1024);
const after = Math.round(readFileSync(htmlPath, 'utf8').length / 1024);
console.log(`Removed ${removed.split('\n').length} lines of inline script.`);
console.log(`Linked ${files.length} bundle files from js/.`);
console.log(`index.html: ${before} KB -> ${after} KB   (backup: index.html.bak)`);
