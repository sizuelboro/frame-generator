const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const MAX_COORDINATE = 1e7;

function cors(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    ...extra,
  };
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: cors(JSON_HEADERS) }); }
function slug(value) { return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80); }
function authorized(request, env) { const token = request.headers.get("authorization") || ""; return Boolean(env.ADMIN_TOKEN) && token === `Bearer ${env.ADMIN_TOKEN}`; }
function validDimension(value) { return Number.isFinite(value) && value > 0 && value <= MAX_DIMENSION; }
function validatePath(path) {
  const value = String(path || "");
  const commands = value.match(/[A-DF-Za-df-z]/g) || []; // e/E may be part of numeric exponents.
  if (!/^\s*[Mm](?:\s|[-+0-9.])/.test(value)) throw new Error("Every path must start with M");
  if (commands.filter((command) => command.toLowerCase() === "m").length !== 1) throw new Error("Every path must contain exactly one M");
  if (commands.some((command) => !"mlhvcsaz".includes(command.toLowerCase()))) throw new Error("Unsupported Canva path command");
  if (!/[Zz]\s*$/.test(value)) throw new Error("Every path must be closed with Z");
  const numbers = value.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  if (!numbers.length || numbers.some((number) => !Number.isFinite(Number(number)) || Math.abs(Number(number)) > MAX_COORDINATE)) throw new Error("Invalid or out-of-range path coordinate");
}
function decodeDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ""));
  if (!match) throw new Error("imageData must be a PNG/JPEG data URL");
  const binary = atob(match[2]);
  if (binary.length > MAX_IMAGE_BYTES) throw new Error("Image is larger than 12 MB");
  const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if ((match[1] === "image/png" && !isPng) || (match[1] === "image/jpeg" && !isJpeg)) throw new Error("Image bytes do not match the declared PNG/JPEG type");
  return { bytes, mimeType: match[1], extension: match[1] === "image/jpeg" ? "jpg" : "png" };
}
async function readJson(env, key, fallback = []) { const object = await env.LIBRARY.get(key); if (!object) return fallback; try { const parsed = JSON.parse(await object.text()); return Array.isArray(parsed) ? parsed : fallback; } catch { return fallback; } }
async function writeJson(env, key, value) { await env.LIBRARY.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json; charset=utf-8" } }); }
const readManifest = (env) => readJson(env, "manifest.json", []);
const writeManifest = (env, frames) => writeJson(env, "manifest.json", frames);
const readFolders = (env) => readJson(env, "folders.json", []);
const writeFolders = (env, folders) => writeJson(env, "folders.json", folders);
function publicFrames(frames) { return frames.map((frame) => ({ ...frame, folderId: String(frame.folderId || "") })); }
async function validateFolder(env, value) { const id = slug(value); if (!id) return ""; const folders = await readFolders(env); if (!folders.some((folder) => folder.id === id)) throw new Error("Folder not found"); return id; }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    if (request.method === "GET" && url.pathname === "/api/frames") {
      const [frames, folders] = await Promise.all([readManifest(env), readFolders(env)]);
      return json({ frames: publicFrames(frames), folders, count: frames.length, version: "7.0", bulkCreateOnly: true, folderSystem: true });
    }

    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      const name = url.pathname.slice("/assets/".length);
      if (!/^[a-z0-9-]+\.(?:png|jpg)$/.test(name)) return json({ error: "Invalid asset name" }, 400);
      const object = await env.LIBRARY.get(`assets/${name}`); if (!object) return json({ error: "Asset not found" }, 404);
      return new Response(object.body, { headers: cors({ "content-type": object.httpMetadata?.contentType || (name.endsWith(".jpg") ? "image/jpeg" : "image/png"), "cache-control": "public, max-age=3600", "etag": object.httpEtag, "x-content-type-options": "nosniff" }) });
    }

    if (request.method === "POST" && url.pathname === "/api/folders") {
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const body = await request.json(), name = String(body.name || "").trim().slice(0, 80), id = slug(body.id || name);
        if (!id || !name) throw new Error("Folder name is required");
        const folders = await readFolders(env); if (folders.some((folder) => folder.id === id)) return json({ error: "Folder already exists", code: "FOLDER_EXISTS" }, 409);
        const folder = { id, name, createdAt: new Date().toISOString() }; folders.push(folder); folders.sort((a, b) => a.name.localeCompare(b.name)); await writeFolders(env, folders);
        return json({ ok: true, folder, folders }, 201);
      } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/folders/")) {
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const id = slug(url.pathname.slice("/api/folders/".length)), body = await request.json(), name = String(body.name || "").trim().slice(0, 80);
        if (!name) throw new Error("Folder name is required"); const folders = await readFolders(env), index = folders.findIndex((folder) => folder.id === id); if (index < 0) return json({ error: "Folder not found" }, 404);
        if (folders.some((folder, at) => at !== index && folder.name.toLowerCase() === name.toLowerCase())) return json({ error: "A folder with that name already exists", code: "FOLDER_EXISTS" }, 409);
        folders[index] = { ...folders[index], name, updatedAt: new Date().toISOString() }; folders.sort((a, b) => a.name.localeCompare(b.name)); await writeFolders(env, folders);
        return json({ ok: true, folder: folders.find((folder) => folder.id === id), folders });
      } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/folders/")) {
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      const id = slug(url.pathname.slice("/api/folders/".length)), folders = await readFolders(env); if (!folders.some((folder) => folder.id === id)) return json({ error: "Folder not found" }, 404);
      const frames = await readManifest(env), moved = frames.filter((frame) => frame.folderId === id).length; frames.forEach((frame) => { if (frame.folderId === id) frame.folderId = ""; });
      await Promise.all([writeFolders(env, folders.filter((folder) => folder.id !== id)), writeManifest(env, frames)]); return json({ ok: true, movedToUncategorized: moved });
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/frames/")) {
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const id = slug(url.pathname.slice("/api/frames/".length)), body = await request.json(), folderId = await validateFolder(env, body.folderId);
        const frames = await readManifest(env), index = frames.findIndex((frame) => frame.id === id); if (index < 0) return json({ error: "Frame not found" }, 404);
        frames[index] = { ...frames[index], folderId, updatedAt: new Date().toISOString() }; await writeManifest(env, frames); return json({ ok: true, frame: frames[index] });
      } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
    }

    if (request.method === "POST" && url.pathname === "/api/frames") {
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const body = await request.json(), id = slug(body.id || body.name), name = String(body.name || "").trim().slice(0, 120);
        const mode = body.mode === "smart-mask" ? "smart-mask" : (body.mode === "silhouette" ? "silhouette" : "overlay"), w = Number(body.w), h = Number(body.h), assetWidth = Number(body.assetWidth || w), assetHeight = Number(body.assetHeight || h), paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
        if (!id || !name) throw new Error("Frame name is required"); if (![w, h, assetWidth, assetHeight].every(validDimension)) throw new Error(`Dimensions must be finite and no larger than ${MAX_DIMENSION}px`);
        if (mode !== "smart-mask" && (!paths.length || paths.length > 29)) throw new Error("Provide 1–29 opening paths");
        const overlayPath = `M 0 0 H ${w} V ${h} H 0 Z`, pathBytes = new TextEncoder().encode([overlayPath, ...paths].join("")).length;
        if (mode !== "smart-mask" && pathBytes > 1980) throw new Error(`Native Canva path budget exceeded: ${pathBytes}/1980 safe bytes`);
        if (mode !== "smart-mask") paths.forEach(validatePath);
        const folderId = await validateFolder(env, body.folderId), frames = await readManifest(env), index = frames.findIndex((item) => item.id === id);
        if (body.createOnly === true && index >= 0) return json({ error: "Frame name already exists", code: "NAME_EXISTS", id }, 409);
        const image = decodeDataUrl(body.imageData), maskImage = mode === "smart-mask" ? decodeDataUrl(body.maskImageData) : null, overlayImage = mode === "silhouette" ? decodeDataUrl(body.overlayImageData) : image;
        const fileName = mode === "silhouette" ? `${id}-thumb.${image.extension}` : `${id}.${image.extension}`, overlayFileName = mode === "silhouette" ? `${id}-overlay.${overlayImage.extension}` : fileName, maskFileName = maskImage ? `${id}-mask.${maskImage.extension}` : null;
        await env.LIBRARY.put(`assets/${fileName}`, image.bytes, { httpMetadata: { contentType: image.mimeType } }); if (overlayFileName !== fileName) await env.LIBRARY.put(`assets/${overlayFileName}`, overlayImage.bytes, { httpMetadata: { contentType: overlayImage.mimeType } }); if (maskImage && maskFileName) await env.LIBRARY.put(`assets/${maskFileName}`, maskImage.bytes, { httpMetadata: { contentType: maskImage.mimeType } });
        const origin = url.origin, assetUrl = `${origin}/assets/${fileName}`, overlayAssetUrl = `${origin}/assets/${overlayFileName}`, maskAssetUrl = maskFileName ? `${origin}/assets/${maskFileName}` : null;
        const entry = { id, name, folderId, w, h, assetWidth, assetHeight, mode, smartMask: mode === "smart-mask", maskUrl: maskAssetUrl, overlayUrl: overlayAssetUrl, thumbUrl: assetUrl, mimeType: image.mimeType, aiDisclosure: "none", paths, updatedAt: new Date().toISOString() };
        if (index >= 0) frames[index] = entry; else frames.unshift(entry); await writeManifest(env, frames); return json({ ok: true, frame: entry, count: frames.length }, index >= 0 ? 200 : 201);
      } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/frames/")) {
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      const id = slug(url.pathname.slice("/api/frames/".length)), frames = await readManifest(env), target = frames.find((item) => item.id === id); if (!target) return json({ error: "Frame not found" }, 404);
      const urls = [target.overlayUrl, target.thumbUrl, target.maskUrl].filter(Boolean), assetNames = [...new Set(urls.map((value) => new URL(value).pathname.split("/").pop()).filter(Boolean))]; await Promise.all(assetNames.map((name) => env.LIBRARY.delete(`assets/${name}`))); await writeManifest(env, frames.filter((item) => item.id !== id)); return json({ ok: true });
    }

    return json({ service: "FrameForge Library", version: "7.0", endpoints: ["GET /api/frames", "POST /api/frames", "PATCH /api/frames/:id", "DELETE /api/frames/:id", "POST /api/folders", "PATCH /api/folders/:id", "DELETE /api/folders/:id"] });
  },
};
