#!/usr/bin/env node
/* =========================================================================
   Run the Studio browser suite in headless Chromium and fail on any FAIL.
   Run: node tools/test-studio.mjs
   ========================================================================= */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = 'file://' + join(root, 'tests', 'studio.test.html');

let dom;
try {
  dom = execFileSync(process.env.CHROME_BIN || 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu',
    '--virtual-time-budget=25000', '--dump-dom', page,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (error) {
  console.error('Could not run chromium:', error.message);
  process.exit(1);
}

const match = /<div id="ff-test-report">([\s\S]*?)<\/div>/.exec(dom);
if (!match) {
  console.error('No test report produced. The bundle probably failed to load.');
  process.exit(1);
}

const report = match[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

console.log(report);

const lines = report.split('\n');
const failed = lines.filter((l) => l.startsWith('FAIL'));
const passed = lines.filter((l) => l.startsWith('PASS'));
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);

