#!/usr/bin/env node
/* =========================================================================
   Backward-compatibility checks
   =========================================================================
   Everything a working install already depends on: saved browser state,
   frames already published to R2, an older Canva app talking to a newer
   Worker, and a full Bulk 100 run against the live rate limit.

   Run: node tools/test-compat.mjs
   ========================================================================= */

import worker from '../frameforge-worker11/src/index.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TOKEN = 'compat-token';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gEBAAD//wAAAAD//wAAAAD//w==';
function r2() {
  const store = new Map();
  return {
    async get(key) {
      if (!store.has(key)) return null;
      const v = store.get(key);
      return { body: v, httpMetadata: {}, httpEtag: '"s"', async text() { return new TextDecoder().decode(v); } };
    },
    async put(key, body) { store.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body); },
    async delete(key) { store.delete(key); },
  };
}
function makeEnv(extra = {}) { return { LIBRARY: r2(), ADMIN_TOKEN: TOKEN, ...extra }; }
let ipCounter = 0;
function req(method, path, { body, token, origin } = {}) {
  const headers = { 'cf-connecting-ip': '203.0.113.' + (1 + (ipCounter++ % 200)) };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  if (origin) headers.origin = origin;
  return new Request('https://w.test' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
};

/* ---------------- 1. saved browser state keys are unchanged ---------------- */
console.log('\n1. Saved browser state survives the upgrade');
{
  const studio = readdirJs();
  // These are the Studio's real key names. They must not change, or every
  // creator silently loses their saved mockups and Worker settings.
  const KEYS = [
    ['frameforge.mockups.v1', 'saved mockups'],
    ['frameforge.cloudflareWorkerUrl', 'Studio Worker URL'],
    ['frameforge.cloudflareAdminToken', 'admin token'],
    ['frameforge.openingBleed', 'auto bleed setting'],
    ['frameforge.lastPublishName', 'last publish name'],
    ['frameforge.lastFolderId', 'last folder'],
    ['frameforge.scene.handoff.v1', 'AI scene hand-off'],
  ];
  for (const [key, label] of KEYS) {
    chk(`${label} key still "${key}"`, studio.includes(key));
  }
  const app = readFileSync(join(root, 'frameforge-canva-app11/src/app.tsx'), 'utf8');
  chk('Canva app URL key unchanged', app.includes('"frameforge.workerUrl"'));
  chk('Canva app token key unchanged', app.includes('"frameforge.adminToken"'));
}

/* Concatenate the whole Studio bundle so a key can live in any module. */
function readdirJs() {
  const dir = join(root, 'js');
  return readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
    .map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
}

/* ---------------- 2. frames already in R2 keep working ---------------- */
console.log('\n2. Frames already published to R2 keep working');
{
  // A manifest written by v7.0-7.3: no multiElement, no unbridgedHoles.
  const legacySingle = {
    id: 'legacy-overlay', name: 'Legacy Overlay', folderId: '', w: 1200, h: 800,
    assetWidth: 2400, assetHeight: 1600, mode: 'overlay', smartMask: false,
    maskUrl: null, overlayUrl: 'https://w.test/assets/legacy-overlay.png',
    thumbUrl: 'https://w.test/assets/legacy-overlay.png', mimeType: 'image/png',
    aiDisclosure: 'none', paths: ['M 10 10 L 100 10 L 100 100 Z'],
  };
  const legacyMulti = {
    ...legacySingle, id: 'legacy-multi', name: 'Legacy Multi', mode: 'silhouette',
    paths: ['M 0 0 L 50 0 L 50 50 Z', 'M 60 60 L 90 60 L 90 90 Z'],
  };

  const env = makeEnv();
  await env.LIBRARY.put('manifest.json', JSON.stringify([legacySingle, legacyMulti]));

  const r = await worker.fetch(req('GET', '/api/frames'), env);
  const j = await r.json();
  chk('legacy manifest still reads', r.status === 200 && j.frames.length === 2, String(r.status));

  const single = j.frames.find((f) => f.id === 'legacy-overlay');
  const multi = j.frames.find((f) => f.id === 'legacy-multi');
  chk('legacy single frame keeps every original field',
    single.overlayUrl === legacySingle.overlayUrl && single.thumbUrl === legacySingle.thumbUrl
    && single.w === 1200 && single.paths.length === 1);
  chk('legacy overlay frame is NOT marked multi', single.multiElement === false, String(single.multiElement));
  chk('legacy multi frame is derived as multi', multi.multiElement === true, String(multi.multiElement));
  chk('no legacy field was dropped',
    Object.keys(legacySingle).every((k) => k in single),
    Object.keys(legacySingle).filter((k) => !(k in single)).join(','));

  // Re-publishing over a legacy entry must still replace, not duplicate.
  const r2 = await worker.fetch(req('POST', '/api/frames', {
    token: TOKEN,
    body: { name: 'Legacy Overlay', w: 1200, h: 800, paths: ['M 5 5 L 60 5 L 60 60 Z'], imageData: PNG },
  }), env);
  const j2 = await r2.json();
  chk('republishing a legacy name replaces it (200, not 201)', r2.status === 200, String(r2.status));
  chk('frame count unchanged after replace', j2.count === 2, String(j2.count));
}

/* -------- 3. an older Canva app build against the newer Worker -------- */
console.log('\n3. An already-installed Canva app still works against the new Worker');
{
  const env = makeEnv();
  const r = await worker.fetch(req('GET', '/api/frames'), env);
  const j = await r.json();
  chk('folderSystem flag still true (old app gates on this)', j.folderSystem === true);
  chk('bulkCreateOnly flag still present', j.bulkCreateOnly === true);
  chk('frames and folders arrays still present', Array.isArray(j.frames) && Array.isArray(j.folders));
  chk('count still present', typeof j.count === 'number');
  // The old app reads response.frames[].paths/overlayUrl/thumbUrl only, and
  // ignores new fields, so extra keys are safe.
  chk('new fields are additive only',
    ['frames', 'folders', 'count', 'version', 'bulkCreateOnly', 'folderSystem']
      .every((k) => k in j));

  // Old app publishes without multiElement. Must still be accepted.
  const rp = await worker.fetch(req('POST', '/api/frames', {
    token: TOKEN,
    body: { name: 'Old Client', mode: 'silhouette', w: 800, h: 600,
            paths: ['M 0 0 L 40 0 L 40 40 Z'], imageData: PNG, overlayImageData: PNG },
  }), env);
  chk('publish without multiElement still accepted', rp.status === 201, String(rp.status));

  // Unconfigured ALLOWED_ORIGINS must not break an existing install.
  const ro = await worker.fetch(req('POST', '/api/frames', {
    token: TOKEN, origin: 'https://app-12345678.canva-apps.com',
    body: { name: 'Any Origin', w: 800, h: 600, paths: ['M 0 0 L 40 0 L 40 40 Z'], imageData: PNG },
  }), env);
  chk('admin write from any origin works when ALLOWED_ORIGINS is unset', ro.status === 201, String(ro.status));
}

/* -------------- 4. Bulk 100 fits inside the rate limit -------------- */
console.log('\n4. A full Bulk 100 run fits inside the admin rate limit');
{
  const wrangler = readFileSync(join(root, 'frameforge-worker11/wrangler.jsonc'), 'utf8');
  const adminLimit = Number(/"name": "ADMIN_LIMIT"[\s\S]*?"limit": (\d+)/.exec(wrangler)[1]);
  chk('admin limit covers 100 creates plus retries', adminLimit >= 120, 'limit=' + adminLimit);

  // Simulate the real serial bulk loop against a quota-enforcing binding.
  let used = 0;
  const env = makeEnv({
    ADMIN_LIMIT: { async limit() { used++; return { success: used <= adminLimit }; } },
  });
  let created = 0, blocked = 0;
  for (let i = 0; i < 100; i++) {
    const r = await worker.fetch(req('POST', '/api/frames', {
      token: TOKEN,
      body: { name: 'Bulk ' + i, createOnly: true, w: 400, h: 400,
              paths: ['M 0 0 L 40 0 L 40 40 Z'], imageData: PNG },
    }), env);
    if (r.status === 201) created++;
    else if (r.status === 429) blocked++;
  }
  chk('all 100 bulk frames published', created === 100, `created=${created} blocked=${blocked}`);

  const bulk = readFileSync(join(root, 'js/08-bulk.js'), 'utf8');
  chk('bulk loop treats 429 as retryable, not fatal', bulk.includes('response.status===429'));
  chk('bulk loop honours Retry-After', bulk.includes("retry-after"));
}

/* -------------- 5. unchanged public surface -------------- */
console.log('\n5. Existing API surface unchanged');
{
  const env = makeEnv();
  const routes = [
    ['GET', '/api/frames', 200],
    ['GET', '/assets/nope.png', 404],
    ['GET', '/assets/bad name.png', 400],
    ['OPTIONS', '/api/frames', 204],
    ['GET', '/', 200],
  ];
  for (const [method, path, expect] of routes) {
    const r = await worker.fetch(req(method, path), env);
    chk(`${method} ${path} -> ${expect}`, r.status === expect, String(r.status));
  }
  const r = await worker.fetch(req('DELETE', '/api/frames/nope', { token: TOKEN }), env);
  chk('DELETE unknown frame still 404', r.status === 404, String(r.status));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

/* ------------------------------ harness ------------------------------ */
function unusedMakeR2() {
  const store = new Map();
  return {
    async get(key) {
      if (!store.has(key)) return null;
      const v = store.get(key);
      return { body: v, httpMetadata: {}, httpEtag: '"s"', async text() { return new TextDecoder().decode(v); } };
    },
    async put(key, body) {
      store.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body);
    },
    async delete(key) { store.delete(key); },
  };
}
