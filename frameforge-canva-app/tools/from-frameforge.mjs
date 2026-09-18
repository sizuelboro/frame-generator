#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [file, name = "My Mockup", id = "mockup-01"] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node tools/from-frameforge.mjs <design.json> ["Name"] [id]');
  process.exit(1);
}

const doc = JSON.parse(readFileSync(file, "utf8"));
const layers = Array.isArray(doc.layers) ? doc.layers : [];
const frame = layers.find((layer) => layer?.type === "frame");
const overlay = layers.find((layer) => layer?.type === "overlay" || layer?.type === "image");
if (!frame) fail("No frame layer found.");

const width = positiveNumber(doc.width ?? doc.w, 1200);
const height = positiveNumber(doc.height ?? doc.h, 800);
const points = extractPoints(frame);
if (points.length < 3) fail("Frame needs at least three valid points.");

const simplified = simplifyToLimit(points, 1900);
const path = toPath(simplified);
const bytes = Buffer.byteLength(path, "utf8");
if (bytes > 2048) fail(`Generated path is ${bytes} bytes; Canva allows 2048.`);

const safeId = String(id).trim().replace(/[^a-zA-Z0-9_-]+/g, "-") || "mockup-01";
const entry = {
  id: safeId,
  name: String(name).trim() || "My Mockup",
  w: Math.round(width),
  h: Math.round(height),
  overlayUrl: "https:" + "//YOUR-SITE.netlify.app/mockups/" + safeId + ".png",
  thumbUrl: "https:" + "//YOUR-SITE.netlify.app/mockups/" + safeId + "-thumb.png",
  mimeType: "image/png",
  aiDisclosure: "none",
  paths: [path],
};

const out = resolve(`src/generated-${safeId}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(entry, null, 2)}\n`);
console.log(JSON.stringify(entry, null, 2));
console.error(`\nSaved: ${out}`);
console.error(`Points: ${points.length} → ${simplified.length}; path bytes: ${bytes}/2048`);
console.error(`Overlay layer: ${overlay ? overlay.name || overlay.type : "not found — export overlay PNG separately"}`);

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function point(value) {
  if (Array.isArray(value) && value.length >= 2) return { x: Number(value[0]), y: Number(value[1]) };
  if (value && typeof value === "object") return { x: Number(value.x ?? value.left), y: Number(value.y ?? value.top) };
  return null;
}

function extractPoints(layer) {
  const candidates = [layer.points, layer.corners, layer.polygon, layer.vertices, layer.quad];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const parsed = candidate.map(point).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (parsed.length >= 3) return removeDuplicateClosingPoint(parsed);
  }

  const rect = layer.rect && typeof layer.rect === "object" ? layer.rect : layer;
  const x = Number(rect.x ?? rect.left);
  const y = Number(rect.y ?? rect.top);
  const w = Number(rect.width ?? rect.w);
  const h = Number(rect.height ?? rect.h);
  if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }
  return [];
}

function removeDuplicateClosingPoint(values) {
  const result = values.filter((p, index, array) => index === 0 || p.x !== array[index - 1].x || p.y !== array[index - 1].y);
  if (result.length > 1 && result[0].x === result.at(-1).x && result[0].y === result.at(-1).y) result.pop();
  return result;
}

function segmentDistanceSquared(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

function rdp(values, epsilon) {
  if (values.length <= 2) return values;
  let maxDistance = 0;
  let index = -1;
  for (let i = 1; i < values.length - 1; i += 1) {
    const distance = segmentDistanceSquared(values[i], values[0], values.at(-1));
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (index !== -1 && maxDistance > epsilon ** 2) {
    const left = rdp(values.slice(0, index + 1), epsilon);
    const right = rdp(values.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [values[0], values.at(-1)];
}

function simplifyClosed(values, epsilon) {
  if (values.length <= 4) return values;
  const anchor = values[0];
  let opposite = 1;
  let farthest = -1;
  for (let i = 1; i < values.length; i += 1) {
    const distance = (values[i].x - anchor.x) ** 2 + (values[i].y - anchor.y) ** 2;
    if (distance > farthest) {
      farthest = distance;
      opposite = i;
    }
  }
  const first = rdp(values.slice(0, opposite + 1), epsilon);
  const second = rdp([...values.slice(opposite), anchor], epsilon);
  return removeDuplicateClosingPoint([...first.slice(0, -1), ...second.slice(0, -1)]);
}

function toPath(values) {
  const coordinates = values.map(({ x, y }) => `${round(x)} ${round(y)}`);
  return `M ${coordinates[0]} ${coordinates.slice(1).map((xy) => `L ${xy}`).join(" ")} Z`;
}

function round(value) {
  return Number(value.toFixed(1)).toString();
}

function simplifyToLimit(values, byteTarget) {
  let low = 0;
  let high = Math.max(width, height);
  let best = values;
  for (let i = 0; i < 24; i += 1) {
    const epsilon = (low + high) / 2;
    const candidate = simplifyClosed(values, epsilon);
    const size = Buffer.byteLength(toPath(candidate), "utf8");
    if (candidate.length >= 3 && size <= byteTarget) {
      best = candidate;
      high = epsilon;
    } else {
      low = epsilon;
    }
  }
  if (Buffer.byteLength(toPath(best), "utf8") > byteTarget) fail("Could not simplify frame under Canva's path limit.");
  return best;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
