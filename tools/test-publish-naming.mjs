#!/usr/bin/env node
/* =========================================================================
   Publishing must never replace an existing cloud entry.

   Two layers are checked:
     1. Unit tests of the real cloudPublishSlug / cloudUniquePublishName
        implementation, lifted straight out of js/07-shadow.js and evaluated
        in a clean VM context. No copy of the logic lives in this file, so a
        change to the Studio cannot silently pass a stale duplicate.
     2. Source guards on the publish call, the dialog and the docs, for the
        parts that cannot be unit tested without a browser.

   Run: node tools/test-publish-naming.mjs
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

/* ---------------- load the real helpers ---------------- */

const shadow = read('js', '07-shadow.js');
const START = 'const FF_PUBLISH_NAME_MAX';
const END = 'const FF_PUBLISH_RETRIES';
const start = shadow.indexOf(START);
const end = shadow.indexOf(END);
if (start < 0 || end <= start) {
  console.error(`Could not find the publish-name helpers in js/07-shadow.js between "${START}" and "${END}".`);
  console.error('If they were renamed or moved, update this test rather than deleting it.');
  process.exit(1);
}

let slug, unique, nameMax;
try {
  const api = runInNewContext(
    shadow.slice(start, end) +
    '\n({ cloudPublishSlug, cloudUniquePublishName, FF_PUBLISH_NAME_MAX })',
    {},
    { timeout: 5000 },
  );
  slug = api.cloudPublishSlug;
  unique = api.cloudUniquePublishName;
  nameMax = api.FF_PUBLISH_NAME_MAX;
} catch (error) {
  console.error('Could not evaluate the publish-name helpers:', error.message);
  process.exit(1);
}

const used = (...names) => new Set(names.map(slug));

/* ---------------- slug rules must match the Worker ---------------- */

equal('slug lowercases and dashes', slug('Floral Arch 01'), 'floral-arch-01');
equal('slug trims leading and trailing dashes', slug('  --Floral Arch--  '), 'floral-arch');
equal('slug collapses punctuation runs', slug('Floral___Arch!!!02'), 'floral-arch-02');
equal('slug of emoji only is empty', slug('🙂🙂'), '');
equal('slug of punctuation only is empty', slug('---'), '');
equal('slug of empty input is empty', slug(''), '');
equal('slug tolerates null', slug(null), '');
equal('slug caps at 80 characters', slug('A'.repeat(200)).length, 80);

/* ---------------- a free name is never touched ---------------- */

equal('free name is published as typed', unique('Floral Arch', used()), 'Floral Arch');
equal('free name is unchanged when others exist', unique('Oak Frame', used('Floral Arch', 'Walnut Frame')), 'Oak Frame');
equal('surrounding whitespace is trimmed', unique('  Floral Arch  ', used()), 'Floral Arch');
equal('empty name falls back to a default', unique('', used()), 'New Mockup Frame');
equal('whitespace-only name falls back to a default', unique('   ', used()), 'New Mockup Frame');

/* ---------------- a taken name is numbered, never replaced ---------------- */

equal('taken name gets 2', unique('Floral Arch', used('Floral Arch')), 'Floral Arch 2');
equal('numbered name increments instead of stacking', unique('Arch 2', used('Arch', 'Arch 2')), 'Arch 3');
equal('a long run keeps counting', unique('Arch', used('Arch', 'Arch 2', 'Arch 3', 'Arch 4')), 'Arch 5');
equal('gaps in the sequence are filled', unique('Arch', used('Arch', 'Arch 3')), 'Arch 2');
equal('matching is slug based, not case sensitive', unique('floral arch', used('Floral Arch')), 'floral arch 2');
equal('punctuation differences still collide', unique('Floral-Arch', used('Floral Arch')), 'Floral-Arch 2');
equal('a bare number name is treated as a root', unique('2024', used('2024')), '2024 2');

/* ---------------- the result is always publishable ---------------- */

equal('the name limit is the Worker limit', nameMax, 120);

const long = 'A'.repeat(200);
const longFree = unique(long, used());
check('an over-long free name is clipped to the limit', longFree.length <= nameMax, `length ${longFree.length}`);

const longTaken = unique(long, used(long));
check('an over-long taken name stays inside the limit', longTaken.length <= nameMax, `length ${longTaken.length}`);
check('an over-long taken name is changed', longTaken !== longFree, 'the taken name was returned unchanged');

const manyTaken = new Set();
let last = '';
for (let i = 0; i < 40; i++) {
  last = unique('Arch', manyTaken);
  check(`sequential publish ${i + 1} is unique`, !manyTaken.has(slug(last)), last);
  check(`sequential publish ${i + 1} is non-empty`, !!slug(last), last);
  manyTaken.add(slug(last));
}
equal('forty sequential publishes end at Arch 40', last, 'Arch 40');

/* The caller owns the set; a live hint calls this on every keystroke and must
   not poison the set it is previewing against. */
const preview = used('Arch');
const first = unique('Arch', preview);
const second = unique('Arch', preview);
equal('the hint preview is stable', second, first);
equal('the hint preview does not mutate the caller set', preview.size, 1);

/* ---------------- source guards ---------------- */

check('single publish sends createOnly', /createOnly\s*:\s*true/.test(shadow), 'js/07-shadow.js');
check('single publish posts the unique name', /name\s*:\s*cloudUniquePublishName\(/.test(shadow), 'js/07-shadow.js');
check('only a 201 is accepted as success', /status\s*!==\s*201/.test(shadow), 'js/07-shadow.js');
check('a 409 NAME_EXISTS is retried', shadow.includes("NAME_EXISTS") && /FF_PUBLISH_RETRIES/.test(shadow), 'js/07-shadow.js');
check('a 429 honours retry-after', shadow.includes("retry-after"), 'js/07-shadow.js');
check('the publish dialog validates the slug', /validate\s*:\s*v\s*=>/.test(shadow) && shadow.includes('at least one letter or number'), 'js/07-shadow.js');
check('the publish dialog has a live name check', /liveHint\s*:/.test(shadow), 'js/07-shadow.js');
check('the folder picker reuses the prefetched manifest', /cloudChooseFolder\(config\s*,\s*library\)/.test(shadow), 'js/07-shadow.js');
check('the old replace wording is gone from the dialog', !/replaces that cloud entry/i.test(shadow), 'js/07-shadow.js');

const dialogs = read('js', '10-dialogs.js');
check('uiForm supports liveHint', /liveHint/.test(dialogs), 'js/10-dialogs.js');
check('liveHint timers are cleared on close', /clearTimeout/.test(dialogs), 'js/10-dialogs.js');

const worker = read('frameforge-worker11', 'src', 'index.js');
check('the Worker still honours createOnly', /createOnly\s*===\s*true/.test(worker), 'frameforge-worker11/src/index.js');
check('the Worker answers NAME_EXISTS', worker.includes('NAME_EXISTS'), 'frameforge-worker11/src/index.js');

const readme = read('README.md');
check('README no longer promises a replace', !/Reusing a name replaces/i.test(readme), 'README.md');
check('README documents the numbering', /never replaced|is numbered/i.test(readme), 'README.md');

const changelog = read('CHANGELOG.md');
check('CHANGELOG records the fix', changelog.includes('7.5.1'), 'CHANGELOG.md');

/* ---------------- report ---------------- */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nPublishing could overwrite a cloud entry:');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
