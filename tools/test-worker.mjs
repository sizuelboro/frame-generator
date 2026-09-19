#!/usr/bin/env node
/* =========================================================================
   Worker regression tests
   =========================================================================
   Exercises the v7.4 changes against an in-memory R2 stub: shared path
   budget, per-object multi budget, multiElement persistence, CORS
   allowlisting and the rate limiter.

   Run: node tools/test-worker.mjs
   ========================================================================= */

import worker from '../frameforge-worker11/src/index.js';
import { PATH_BUDGET } from '../shared/frameforge-limits.js';

/* ---------- minimal R2 stub ---------- */
function makeR2() {
  const store = new Map();
  return {
    store,
    async get(key) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      return {
        body: value.bytes,
        httpMetadata: value.httpMetadata,
        httpEtag: '"stub"',
        async text() { return new TextDecoder().decode(value.bytes); },
      };
    },
    async put(key, body, opts) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      store.set(key, { bytes, httpMetadata: (opts && opts.httpMetadata) || {} });
    },
    async delete(key) { store.delete(key); },
  };
}

const TOKEN = 'test-token';
function makeEnv(extra = {}) {
  return { LIBRARY: makeR2(), ADMIN_TOKEN: TOKEN, ...extra };
}

/* A 1x1 PNG, valid signature so decodeDataUrl accepts it. */
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gEBAAD//wAAAAD//wAAAAD//w==';

function req(method, path, { body, token, origin } = {}) {
  const headers = { 'cf-connecting-ip': '203.0.113.' + Math.floor(Math.random() * 250) };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  return new Request('https://worker.test' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

function pathOfBytes(target) {
  // Build a single-M closed path of roughly `target` bytes.
  let d = 'M 0 0';
  while (new TextEncoder().encode(d + ' Z').length < target) d += ' L 9 9';
  return d + ' Z';
}

const basePublish = (over = {}) => ({
  name: 'Test Frame',
  w: 1200, h: 800,
  paths: ['M 10 10 L 100 10 L 100 100 L 10 100 Z'],
  imageData: PNG_1x1,
  ...over,
});

/* =========================== tests =========================== */

console.log('\n1. Shared path budget');
{
  const env = makeEnv();
  // Just over the budget must be rejected, with the budget named in the error.
  const big = pathOfBytes(PATH_BUDGET + 50);
  let r = await worker.fetch(req('POST', '/api/frames', { body: basePublish({ paths: [big] }), token: TOKEN }), env);
  let j = await r.json();
  check('over-budget single frame rejected', r.status === 400, String(r.status));
  check('error names the shared budget', String(j.error).includes(String(PATH_BUDGET)), j.error);

  // Comfortably under must be accepted.
  r = await worker.fetch(req('POST', '/api/frames', { body: basePublish(), token: TOKEN }), env);
  check('in-budget frame accepted', r.status === 201, String(r.status));
}

console.log('\n2. Exact-multi is measured per object, not combined');
{
  const env = makeEnv();
  // Two paths that each fit but together exceed the combined budget.
  const each = pathOfBytes(Math.floor(PATH_BUDGET * 0.7));
  const body = basePublish({
    name: 'Multi Frame',
    mode: 'silhouette',
    multiElement: true,
    paths: [each, each],
    overlayImageData: PNG_1x1,
  });
  const r = await worker.fetch(req('POST', '/api/frames', { body, token: TOKEN }), env);
  const j = await r.json();
  check('multi frame accepted on per-object budget', r.status === 201, `${r.status} ${j.error || ''}`);
  check('multiElement persisted in manifest', j.frame && j.frame.multiElement === true, JSON.stringify(j.frame && j.frame.multiElement));

  // Same two paths declared as a single-element frame must be rejected.
  const env2 = makeEnv();
  const r2 = await worker.fetch(req('POST', '/api/frames', {
    body: basePublish({ paths: [each, each] }), token: TOKEN,
  }), env2);
  check('same paths rejected as one combined element', r2.status === 400, String(r2.status));
}

console.log('\n3. multiElement survives a read');
{
  const env = makeEnv();
  const each = 'M 0 0 L 50 0 L 50 50 Z';
  await worker.fetch(req('POST', '/api/frames', {
    body: basePublish({ name: 'Multi Read', mode: 'silhouette', multiElement: true, paths: [each, each], overlayImageData: PNG_1x1 }),
    token: TOKEN,
  }), env);
  const r = await worker.fetch(req('GET', '/api/frames'), env);
  const j = await r.json();
  check('GET /api/frames returns multiElement', j.frames[0].multiElement === true, JSON.stringify(j.frames[0].multiElement));
  check('GET reports the path budget', j.pathBudget === PATH_BUDGET, String(j.pathBudget));
}

console.log('\n4. CORS allowlist');
{
  const open = makeEnv();
  let r = await worker.fetch(req('GET', '/api/frames', { origin: 'https://evil.example' }), open);
  check('unconfigured worker stays wide open (back-compat)', r.headers.get('access-control-allow-origin') === '*');

  const locked = makeEnv({ ALLOWED_ORIGINS: 'https://canvaforge.pages.dev' });
  r = await worker.fetch(req('GET', '/api/frames', { origin: 'https://canvaforge.pages.dev' }), locked);
  check('allowed origin is echoed', r.headers.get('access-control-allow-origin') === 'https://canvaforge.pages.dev', String(r.headers.get('access-control-allow-origin')));

  r = await worker.fetch(req('GET', '/api/frames', { origin: 'https://evil.example' }), locked);
  check('disallowed origin gets no CORS header', r.headers.get('access-control-allow-origin') === null, String(r.headers.get('access-control-allow-origin')));
  check('Vary: Origin is set', r.headers.get('vary') === 'Origin');

  // The important one: an admin write from a non-allowlisted page is refused
  // even when the attacker holds a valid token.
  r = await worker.fetch(req('POST', '/api/frames', { body: basePublish(), token: TOKEN, origin: 'https://evil.example' }), locked);
  check('admin write from disallowed origin blocked with a valid token', r.status === 403, String(r.status));

  r = await worker.fetch(req('POST', '/api/frames', { body: basePublish(), token: TOKEN, origin: 'https://canvaforge.pages.dev' }), locked);
  check('admin write from allowed origin succeeds', r.status === 201, String(r.status));

  // Server-to-server clients send no Origin and must keep working.
  r = await worker.fetch(req('GET', '/api/health'), locked);
  check('originless client still allowed', r.status === 200, String(r.status));
}

console.log('\n5. Rate limiting');
{
  // Binding path.
  let calls = 0;
  const env = makeEnv({ ADMIN_LIMIT: { async limit() { calls++; return { success: calls <= 2 }; } } });
  const fixedIp = () => {
    const r = req('POST', '/api/frames', { body: basePublish(), token: TOKEN });
    r.headers.set('cf-connecting-ip', '198.51.100.7');
    return r;
  };
  const a = await worker.fetch(fixedIp(), env);
  const b = await worker.fetch(fixedIp(), env);
  const c = await worker.fetch(fixedIp(), env);
  check('binding allows within quota', a.status === 201 && b.status === 200, `${a.status},${b.status}`);
  check('binding rejects over quota with 429', c.status === 429, String(c.status));
  const j = await c.json();
  check('429 carries RATE_LIMITED code', j.code === 'RATE_LIMITED', JSON.stringify(j));
  check('429 sets Retry-After', c.headers.get('retry-after') === '60');

  // Fallback path: no binding configured at all.
  const bare = makeEnv();
  let last = 200, seen429 = false;
  // The fallback quota tracks wrangler.jsonc (150/min for admin), so the
  // flood has to exceed that before 429 is expected.
  for (let i = 0; i < 200; i++) {
    const r0 = req('POST', '/api/frames', { body: basePublish({ name: 'Flood ' + i }), token: TOKEN });
    r0.headers.set('cf-connecting-ip', '198.51.100.99');
    last = (await worker.fetch(r0, bare)).status;
    if (last === 429) { seen429 = true; break; }
  }
  check('in-isolate fallback eventually throttles', seen429, 'last status ' + last);
}

console.log('\n6. Oversized body rejected before buffering');
{
  const env = makeEnv();
  const r0 = req('POST', '/api/frames', { body: basePublish(), token: TOKEN });
  r0.headers.set('content-length', String(1024 * 1024 * 1024));
  const r = await worker.fetch(r0, env);
  const j = await r.json();
  check('huge Content-Length gets 413', r.status === 413, String(r.status));
  check('413 carries BODY_TOO_LARGE code', j.code === 'BODY_TOO_LARGE', JSON.stringify(j));
}

console.log('\n7. Existing protections still hold');
{
  const env = makeEnv();
  let r = await worker.fetch(req('POST', '/api/frames', { body: basePublish() }), env);
  check('publish without a token is 401', r.status === 401, String(r.status));

  r = await worker.fetch(req('POST', '/api/frames', { body: basePublish({ paths: ['M 0 0 L 5 5 M 9 9 L 1 1 Z'] }), token: TOKEN }), env);
  check('two-M path rejected', r.status === 400, String(r.status));

  r = await worker.fetch(req('POST', '/api/frames', { body: basePublish({ paths: ['M 0 0 Q 5 5 9 9 Z'] }), token: TOKEN }), env);
  check('unsupported Q command rejected', r.status === 400, String(r.status));

  r = await worker.fetch(req('POST', '/api/frames', { body: basePublish({ w: 99999 }), token: TOKEN }), env);
  check('oversized dimension rejected', r.status === 400, String(r.status));

  r = await worker.fetch(req('POST', '/api/frames', { body: basePublish({ imageData: 'data:image/png;base64,AAAA' }), token: TOKEN }), env);
  check('bad PNG bytes rejected', r.status === 400, String(r.status));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
