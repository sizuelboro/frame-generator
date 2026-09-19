#!/usr/bin/env node
/* =========================================================================
   Generate js/01-limits.js from shared/frameforge-limits.js
   =========================================================================
   The Studio is an ordered bundle of classic <script> files, so it cannot
   consume ES module syntax. Rather than keep a hand-maintained copy that can
   drift, this strips `export ` and emits a generated file.

   The shared module already assigns globalThis.FF_LIMITS, so the stripped
   output defines window.FF_LIMITS for every later script.

   Run: node tools/build-studio-limits.mjs
   ========================================================================= */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'shared', 'frameforge-limits.js');
const target = join(root, 'js', '01-limits.js');

const text = readFileSync(source, 'utf8');
const stripped = text.replace(/^export (const|function) /gm, '$1 ');

if (/\bexport\b/.test(stripped)) {
  console.error('Unhandled export syntax in shared/frameforge-limits.js');
  process.exit(1);
}

const banner = `'use strict';
/* =========================================================================
   GENERATED FILE - DO NOT EDIT
   Source: shared/frameforge-limits.js
   Rebuild: node tools/build-studio-limits.mjs
   ========================================================================= */

`;

writeFileSync(target, banner + stripped, 'utf8');
console.log('Wrote js/01-limits.js from shared/frameforge-limits.js');
