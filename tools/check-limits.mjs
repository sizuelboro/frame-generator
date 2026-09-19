#!/usr/bin/env node
/* =========================================================================
   Guard against limit drift across the three layers.
   =========================================================================
   The original bug this prevents: the Worker rejected published frames at
   1980 bytes while the Canva app accepted them at 2048, so a frame could
   validate locally and then fail in the cloud.

   Run: node tools/check-limits.mjs
   ========================================================================= */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const KEYS = [
  'PATH_BUDGET',
  'CANVA_HARD_PATH_LIMIT',
  'MAX_PATHS_SINGLE',
  'MAX_PATHS_MULTI',
  'MAX_DIMENSION',
  'MAX_COORDINATE',
];

/* Numbers are declared as `export const NAME = <expr>;` in every mirror, so a
   targeted regex plus eval of the literal expression is enough and avoids
   pulling a TS parser into the check. */
function readConsts(relPath) {
  const text = readFileSync(join(root, relPath), 'utf8');
  const found = {};
  for (const key of KEYS) {
    const match = new RegExp(`export const ${key}\\s*(?::\\s*number)?\\s*=\\s*([^;]+);`).exec(text);
    if (!match) continue;
    // eslint-disable-next-line no-eval
    found[key] = eval(match[1].trim());
  }
  return found;
}

const SOURCES = {
  'shared/frameforge-limits.js (source of truth)': 'shared/frameforge-limits.js',
  'frameforge-worker11/src/shared/frameforge-limits.js': 'frameforge-worker11/src/shared/frameforge-limits.js',
  'frameforge-canva-app11/src/limits.ts': 'frameforge-canva-app11/src/limits.ts',
};

const values = {};
for (const [label, path] of Object.entries(SOURCES)) values[label] = readConsts(path);

const truthLabel = 'shared/frameforge-limits.js (source of truth)';
const truth = values[truthLabel];
const problems = [];

for (const [label, consts] of Object.entries(values)) {
  if (label === truthLabel) continue;
  for (const key of KEYS) {
    if (!(key in consts)) {
      problems.push(`${label}: missing ${key}`);
      continue;
    }
    if (consts[key] !== truth[key]) {
      problems.push(`${label}: ${key} is ${consts[key]}, expected ${truth[key]}`);
    }
  }
}

/* The Studio is a classic-script bundle; it must not hardcode a budget.
   js/01-limits.js is generated from the source of truth, so it is exempt.
   A line may opt out with an `ff-limits-ok` comment when the number is
   genuinely unrelated, for example the ZIP DOS date epoch. */
const EXEMPT_FILES = new Set(['01-limits.js']);
const BUDGET_LITERALS = [/\b2048\b/, /\b1980\b/, /\b1900\b/];

for (const file of readdirSync(join(root, 'js')).sort()) {
  if (!file.endsWith('.js') || EXEMPT_FILES.has(file)) continue;
  const lines = readFileSync(join(root, 'js', file), 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.includes('ff-limits-ok')) return;
    for (const pattern of BUDGET_LITERALS) {
      if (pattern.test(line)) {
        problems.push(
          `js/${file}:${index + 1} hardcodes a path budget literal; ` +
          'use FF_PATH_BUDGET / FF_PATH_TARGET instead, or mark the line ff-limits-ok',
        );
        break;
      }
    }
  });
}

/* index.html must carry no inline logic at all any more. */
const studio = readFileSync(join(root, 'index.html'), 'utf8');
if (/<script(?![^>]*\bsrc=)/.test(studio)) {
  problems.push('index.html contains an inline <script>; Studio logic belongs in js/');
}

if (problems.length) {
  console.error('Limit drift detected:\n');
  for (const problem of problems) console.error('  - ' + problem);
  console.error('\nEdit shared/frameforge-limits.js, then mirror it. Do not edit one side alone.');
  process.exit(1);
}

console.log('Limits are consistent across all layers:');
for (const key of KEYS) console.log(`  ${key} = ${truth[key]}`);
process.exit(0);
