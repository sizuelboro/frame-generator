/* =========================================================================
   FrameForge Library Worker — v7.4
   =========================================================================
   Changes in v7.4
     - Path budget is imported from shared/frameforge-limits.js. The Worker
       and the Canva app can no longer disagree (was: Worker 1980 vs app 2048).
     - "Exact multi" silhouettes are measured per object, not combined, which
       matches how the Canva app actually inserts them.
     - multiElement is now persisted in the manifest. It was documented as
       fixed but was silently dropped from the stored entry.
     - CORS is restricted to ALLOWED_ORIGINS. Admin routes reject any origin
       outside the allowlist instead of serving Access-Control-Allow-Origin: *.
     - Rate limiting on every route via the Workers Rate Limiting API, with an
       in-isolate token bucket fallback and an early Content-Length rejection.
   ========================================================================= */

import {
  PATH_BUDGET,
  MAX_DIMENSION,
  MAX_IMAGE_BYTES,
  MAX_COORDINATE,
  MAX_PATHS_SINGLE,
  MAX_PATHS_MULTI,
  isExactMulti,
  measurePathBudget,
} from './shared/frameforge-limits.js';

const VERSION = '7.4';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/* Largest JSON body we will even read. A publish carries up to three base64
   images, and base64 inflates by ~4/3, so allow headroom over MAX_IMAGE_BYTES. */
const MAX_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * 3 * 1.4) + 65536;

/* -------------------------------------------------------------------------
   CORS

   The admin token is a bearer token, so CORS was never a CSRF boundary. It
   does however decide whether an arbitrary page a creator happens to visit
   can script the admin API using a token still live in that browser. So:
   read routes stay open, admin routes are allowlisted.
   ------------------------------------------------------------------------- */

function allowlist(env) {
  return String((env && env.ALLOWED_ORIGINS) || '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function originAllowed(origin, env) {
  const list = allowlist(env);
  if (!list.length) return true;           // unconfigured: stay backward compatible
  if (list.includes('*')) return true;
  if (!origin) return true;                // non-browser client (curl, Worker, server)
  return list.includes(origin.replace(/\/+$/, ''));
}

function cors(request, env, extra = {}) {
  const origin = request.headers.get('origin') || '';
  const list = allowlist(env);
  const headers = {
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
    ...extra,
  };
  if (!list.length || list.includes('*')) {
    headers['access-control-allow-origin'] = '*';
  } else if (origin && originAllowed(origin, env)) {
    headers['access-control-allow-origin'] = origin;
  }
  // No matching origin: the header is omitted and the browser blocks the read.
  return headers;
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors(request, env, JSON_HEADERS),
  });
}

/* -------------------------------------------------------------------------
   Rate limiting

   Primary: the Workers Rate Limiting API bindings declared in wrangler.jsonc.
   Fallback: a per-isolate token bucket. An isolate is not global state, so the
   fallback is a speed bump, not a guarantee. It exists so a deployment that
   forgot the bindings is not completely unprotected.
   ------------------------------------------------------------------------- */

const FALLBACK_BUCKETS = new Map();
const FALLBACK_MAX_KEYS = 5000;

function fallbackLimit(key, limit, periodSeconds) {
  const now = Date.now();
  const windowStart = now - periodSeconds * 1000;
  if (FALLBACK_BUCKETS.size > FALLBACK_MAX_KEYS) FALLBACK_BUCKETS.clear();
  const hits = (FALLBACK_BUCKETS.get(key) || []).filter((at) => at > windowStart);
  if (hits.length >= limit) {
    FALLBACK_BUCKETS.set(key, hits);
    return false;
  }
  hits.push(now);
  FALLBACK_BUCKETS.set(key, hits);
  return true;
}

function clientKey(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    'unknown'
  );
}

/**
 * @param scope 'admin' for writes, 'read' for reads.
 * @returns null when allowed, or a 429 Response.
 */
async function rateLimit(request, env, scope) {
  const key = `${scope}:${clientKey(request)}`;
  const binding = scope === 'admin' ? env.ADMIN_LIMIT : env.READ_LIMIT;
  // Must track the wrangler.jsonc quotas, or a deployment missing the
  // bindings would throttle a legitimate Bulk 100 run.
  const fallbackQuota = scope === 'admin' ? 150 : 300;

  let allowed;
  if (binding && typeof binding.limit === 'function') {
    try {
      const result = await binding.limit({ key });
      allowed = result && result.success !== false;
    } catch {
      allowed = fallbackLimit(key, fallbackQuota, 60);
    }
  } else {
    allowed = fallbackLimit(key, fallbackQuota, 60);
  }

  if (allowed) return null;
  return new Response(
    JSON.stringify({ error: 'Too many requests. Slow down and retry shortly.', code: 'RATE_LIMITED' }),
    { status: 429, headers: cors(request, env, { ...JSON_HEADERS, 'retry-after': '60' }) },
  );
}

/** Reject an oversized upload before buffering it into memory. */
function bodyTooLarge(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

/* ------------------------------ helpers ------------------------------ */

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function authorized(request, env) {
  const token = request.headers.get('authorization') || '';
  return Boolean(env.ADMIN_TOKEN) && token === `Bearer ${env.ADMIN_TOKEN}`;
}

function validDimension(value) {
  return Number.isFinite(value) && value > 0 && value <= MAX_DIMENSION;
}

function validatePath(path) {
  const value = String(path || '');
  const commands = value.match(/[A-DF-Za-df-z]/g) || []; // e/E may be part of numeric exponents.
  if (!/^\s*[Mm](?:\s|[-+0-9.])/.test(value)) throw new Error('Every path must start with M');
  if (commands.filter((command) => command.toLowerCase() === 'm').length !== 1) throw new Error('Every path must contain exactly one M');
  if (commands.some((command) => !'mlhvcsaz'.includes(command.toLowerCase()))) throw new Error('Unsupported Canva path command');
  if (!/[Zz]\s*$/.test(value)) throw new Error('Every path must be closed with Z');
  const numbers = value.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  if (!numbers.length || numbers.some((number) => !Number.isFinite(Number(number)) || Math.abs(Number(number)) > MAX_COORDINATE)) throw new Error('Invalid or out-of-range path coordinate');
}

function decodeDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) throw new Error('imageData must be a PNG/JPEG data URL');
  const binary = atob(match[2]);
  if (binary.length > MAX_IMAGE_BYTES) throw new Error('Image is larger than 12 MB');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if ((match[1] === 'image/png' && !isPng) || (match[1] === 'image/jpeg' && !isJpeg)) throw new Error('Image bytes do not match the declared PNG/JPEG type');
  return { bytes, mimeType: match[1], extension: match[1] === 'image/jpeg' ? 'jpg' : 'png' };
}

async function readJson(env, key, fallback = []) {
  const object = await env.LIBRARY.get(key);
  if (!object) return fallback;
  try {
    const parsed = JSON.parse(await object.text());
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(env, key, value) {
  await env.LIBRARY.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

const readManifest = (env) => readJson(env, 'manifest.json', []);
const writeManifest = (env, frames) => writeJson(env, 'manifest.json', frames);
const readFolders = (env) => readJson(env, 'folders.json', []);
const writeFolders = (env, folders) => writeJson(env, 'folders.json', folders);

function publicFrames(frames) {
  return frames.map((frame) => ({
    ...frame,
    folderId: String(frame.folderId || ''),
    // Older manifest rows predate persisted multiElement; derive it so the
    // Canva app still picks the correct insert path for them.
    multiElement: frame.multiElement === true || isExactMulti(frame),
  }));
}

async function validateFolder(env, value) {
  const id = slug(value);
  if (!id) return '';
  const folders = await readFolders(env);
  if (!folders.some((folder) => folder.id === id)) throw new Error('Folder not found');
  return id;
}

/* ------------------------------ routes ------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isAdminRoute =
      request.method !== 'GET' && request.method !== 'OPTIONS';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request, env) });
    }

    const limited = await rateLimit(request, env, isAdminRoute ? 'admin' : 'read');
    if (limited) return limited;

    // Admin routes additionally require an allowlisted browser origin.
    if (isAdminRoute && !originAllowed(request.headers.get('origin') || '', env)) {
      return json(request, env, { error: 'Origin not allowed', code: 'ORIGIN_BLOCKED' }, 403);
    }

    if (isAdminRoute && bodyTooLarge(request)) {
      return json(request, env, { error: 'Request body is too large', code: 'BODY_TOO_LARGE' }, 413);
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(request, env, {
        ok: true,
        version: VERSION,
        pathBudget: PATH_BUDGET,
        originLocked: allowlist(env).length > 0,
        rateLimited: Boolean(env.ADMIN_LIMIT || env.READ_LIMIT),
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/frames') {
      const [frames, folders] = await Promise.all([readManifest(env), readFolders(env)]);
      return json(request, env, {
        frames: publicFrames(frames),
        folders,
        count: frames.length,
        version: VERSION,
        bulkCreateOnly: true,
        folderSystem: true,
        pathBudget: PATH_BUDGET,
      });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const name = url.pathname.slice('/assets/'.length);
      if (!/^[a-z0-9-]+\.(?:png|jpg)$/.test(name)) return json(request, env, { error: 'Invalid asset name' }, 400);
      const object = await env.LIBRARY.get(`assets/${name}`);
      if (!object) return json(request, env, { error: 'Asset not found' }, 404);
      return new Response(object.body, {
        headers: cors(request, env, {
          'content-type': object.httpMetadata?.contentType || (name.endsWith('.jpg') ? 'image/jpeg' : 'image/png'),
          'cache-control': 'public, max-age=3600',
          etag: object.httpEtag,
          'x-content-type-options': 'nosniff',
        }),
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/folders') {
      if (!authorized(request, env)) return json(request, env, { error: 'Unauthorized' }, 401);
      try {
        const body = await request.json(), name = String(body.name || '').trim().slice(0, 80), id = slug(body.id || name);
        if (!id || !name) throw new Error('Folder name is required');
        const folders = await readFolders(env);
        if (folders.some((folder) => folder.id === id)) return json(request, env, { error: 'Folder already exists', code: 'FOLDER_EXISTS' }, 409);
        const folder = { id, name, createdAt: new Date().toISOString() };
        folders.push(folder);
        folders.sort((a, b) => a.name.localeCompare(b.name));
        await writeFolders(env, folders);
        return json(request, env, { ok: true, folder, folders }, 201);
      } catch (error) {
        return json(request, env, { error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }

    if (request.method === 'PATCH' && url.pathname.startsWith('/api/folders/')) {
      if (!authorized(request, env)) return json(request, env, { error: 'Unauthorized' }, 401);
      try {
        const id = slug(url.pathname.slice('/api/folders/'.length)), body = await request.json(), name = String(body.name || '').trim().slice(0, 80);
        if (!name) throw new Error('Folder name is required');
        const folders = await readFolders(env), index = folders.findIndex((folder) => folder.id === id);
        if (index < 0) return json(request, env, { error: 'Folder not found' }, 404);
        if (folders.some((folder, at) => at !== index && folder.name.toLowerCase() === name.toLowerCase())) return json(request, env, { error: 'A folder with that name already exists', code: 'FOLDER_EXISTS' }, 409);
        folders[index] = { ...folders[index], name, updatedAt: new Date().toISOString() };
        folders.sort((a, b) => a.name.localeCompare(b.name));
        await writeFolders(env, folders);
        return json(request, env, { ok: true, folder: folders.find((folder) => folder.id === id), folders });
      } catch (error) {
        return json(request, env, { error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/folders/')) {
      if (!authorized(request, env)) return json(request, env, { error: 'Unauthorized' }, 401);
      const id = slug(url.pathname.slice('/api/folders/'.length)), folders = await readFolders(env);
      if (!folders.some((folder) => folder.id === id)) return json(request, env, { error: 'Folder not found' }, 404);
      const frames = await readManifest(env), moved = frames.filter((frame) => frame.folderId === id).length;
      frames.forEach((frame) => { if (frame.folderId === id) frame.folderId = ''; });
      await Promise.all([writeFolders(env, folders.filter((folder) => folder.id !== id)), writeManifest(env, frames)]);
      return json(request, env, { ok: true, movedToUncategorized: moved });
    }

    if (request.method === 'PATCH' && url.pathname.startsWith('/api/frames/')) {
      if (!authorized(request, env)) return json(request, env, { error: 'Unauthorized' }, 401);
      try {
        const id = slug(url.pathname.slice('/api/frames/'.length)), body = await request.json(), folderId = await validateFolder(env, body.folderId);
        const frames = await readManifest(env), index = frames.findIndex((frame) => frame.id === id);
        if (index < 0) return json(request, env, { error: 'Frame not found' }, 404);
        frames[index] = { ...frames[index], folderId, updatedAt: new Date().toISOString() };
        await writeManifest(env, frames);
        return json(request, env, { ok: true, frame: frames[index] });
      } catch (error) {
        return json(request, env, { error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/frames') {
      if (!authorized(request, env)) return json(request, env, { error: 'Unauthorized' }, 401);
      try {
        const body = await request.json();
        const id = slug(body.id || body.name);
        const name = String(body.name || '').trim().slice(0, 120);
        const mode = body.mode === 'smart-mask' ? 'smart-mask' : (body.mode === 'silhouette' ? 'silhouette' : 'overlay');
        const w = Number(body.w), h = Number(body.h);
        const assetWidth = Number(body.assetWidth || w), assetHeight = Number(body.assetHeight || h);
        const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
        const multiElement = body.multiElement === true;
        // Holes that could not be bridged into the outer contour. Advisory
        // metadata so the app can warn instead of shipping a wrong frame.
        const unbridgedHoles = Number(body.unbridgedHoles || 0) || 0;

        if (!id || !name) throw new Error('Frame name is required');
        if (![w, h, assetWidth, assetHeight].every(validDimension)) throw new Error(`Dimensions must be finite and no larger than ${MAX_DIMENSION}px`);

        const frame = { mode, w, h, paths, multiElement };

        if (mode !== 'smart-mask') {
          const maxPaths = isExactMulti(frame) ? MAX_PATHS_MULTI : MAX_PATHS_SINGLE;
          if (!paths.length || paths.length > maxPaths) throw new Error(`Provide 1-${maxPaths} opening paths`);

          // One budget rule, shared with the Canva app and the Studio.
          const budget = measurePathBudget(frame);
          if (!budget.ok) throw new Error(`Native Canva path budget exceeded: ${budget.reason}`);

          paths.forEach(validatePath);
        }

        const folderId = await validateFolder(env, body.folderId);
        const frames = await readManifest(env);
        const index = frames.findIndex((item) => item.id === id);
        if (body.createOnly === true && index >= 0) return json(request, env, { error: 'Frame name already exists', code: 'NAME_EXISTS', id }, 409);

        const image = decodeDataUrl(body.imageData);
        const maskImage = mode === 'smart-mask' ? decodeDataUrl(body.maskImageData) : null;
        const overlayImage = mode === 'silhouette' ? decodeDataUrl(body.overlayImageData) : image;
        const fileName = mode === 'silhouette' ? `${id}-thumb.${image.extension}` : `${id}.${image.extension}`;
        const overlayFileName = mode === 'silhouette' ? `${id}-overlay.${overlayImage.extension}` : fileName;
        const maskFileName = maskImage ? `${id}-mask.${maskImage.extension}` : null;

        await env.LIBRARY.put(`assets/${fileName}`, image.bytes, { httpMetadata: { contentType: image.mimeType } });
        if (overlayFileName !== fileName) await env.LIBRARY.put(`assets/${overlayFileName}`, overlayImage.bytes, { httpMetadata: { contentType: overlayImage.mimeType } });
        if (maskImage && maskFileName) await env.LIBRARY.put(`assets/${maskFileName}`, maskImage.bytes, { httpMetadata: { contentType: maskImage.mimeType } });

        const origin = url.origin;
        const assetUrl = `${origin}/assets/${fileName}`;
        const overlayAssetUrl = `${origin}/assets/${overlayFileName}`;
        const maskAssetUrl = maskFileName ? `${origin}/assets/${maskFileName}` : null;

        const entry = {
          id, name, folderId, w, h, assetWidth, assetHeight, mode,
          smartMask: mode === 'smart-mask',
          // Persisted so the app does not have to guess from paths.length.
          multiElement: mode === 'silhouette' ? (multiElement || paths.length > 1) : false,
          unbridgedHoles,
          maskUrl: maskAssetUrl,
          overlayUrl: overlayAssetUrl,
          thumbUrl: assetUrl,
          mimeType: image.mimeType,
          aiDisclosure: 'none',
          paths,
          updatedAt: new Date().toISOString(),
        };

        if (index >= 0) frames[index] = entry; else frames.unshift(entry);
        await writeManifest(env, frames);
        return json(request, env, { ok: true, frame: entry, count: frames.length }, index >= 0 ? 200 : 201);
      } catch (error) {
        return json(request, env, { error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/frames/')) {
      if (!authorized(request, env)) return json(request, env, { error: 'Unauthorized' }, 401);
      const id = slug(url.pathname.slice('/api/frames/'.length)), frames = await readManifest(env), target = frames.find((item) => item.id === id);
      if (!target) return json(request, env, { error: 'Frame not found' }, 404);
      const urls = [target.overlayUrl, target.thumbUrl, target.maskUrl].filter(Boolean);
      const assetNames = [...new Set(urls.map((value) => new URL(value).pathname.split('/').pop()).filter(Boolean))];
      await Promise.all(assetNames.map((name) => env.LIBRARY.delete(`assets/${name}`)));
      await writeManifest(env, frames.filter((item) => item.id !== id));
      return json(request, env, { ok: true });
    }

    return json(request, env, {
      service: 'FrameForge Library',
      version: VERSION,
      pathBudget: PATH_BUDGET,
      endpoints: [
        'GET /api/health',
        'GET /api/frames',
        'POST /api/frames',
        'PATCH /api/frames/:id',
        'DELETE /api/frames/:id',
        'POST /api/folders',
        'PATCH /api/folders/:id',
        'DELETE /api/folders/:id',
      ],
    });
  },
};
