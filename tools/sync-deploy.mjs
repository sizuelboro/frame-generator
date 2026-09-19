#!/usr/bin/env node
/**
 * The `repo/` folder is the Cloudflare Pages deploy mirror. It is NOT a second
 * source of truth: it is generated from the root by this script.
 *
 *   node tools/sync-deploy.mjs          copy root -> repo/ (keeps repo/.git)
 *   node tools/sync-deploy.mjs --check  fail if repo/ has drifted
 *
 * Line endings are normalised to LF on both sides before comparing, so a
 * checkout that rewrote CRLF is not reported as a difference.
 */
import {
	readdirSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	existsSync,
	statSync,
} from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const deploy = join(root, "repo")
const check = process.argv.includes("--check")

// Everything Cloudflare Pages serves. Nothing else belongs in repo/.
const FILES = ["index.html", "_headers"]
const DIRS = ["js", "mockups"]
const TEXT = /\.(html|js|css|json|txt|md|map)$/i

const list = (dir, base = dir) => {
	if (!existsSync(dir)) return []
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name)
		return statSync(full).isDirectory() ? list(full, base) : [full]
	})
}

const norm = (buf, rel) =>
	TEXT.test(rel) ? Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : buf

const targets = [...FILES, ...DIRS.flatMap((d) => list(join(root, d)).map((f) => f.slice(root.length + 1)))]

const drifted = []
let copied = 0

for (const rel of targets) {
	const src = join(root, rel)
	const dst = join(deploy, rel)
	if (!existsSync(src)) continue

	const want = norm(readFileSync(src), rel)
	const have = existsSync(dst) ? norm(readFileSync(dst), rel) : null

	if (have !== null && want.equals(have)) continue

	if (check) {
		drifted.push(have === null ? `${rel} (missing in repo/)` : `${rel} (content differs)`)
		continue
	}

	mkdirSync(dirname(dst), { recursive: true })
	writeFileSync(dst, want)
	copied++
}

// Files served from repo/ that the root no longer has.
for (const full of [...list(join(deploy, "js")), ...list(join(deploy, "mockups"))]) {
	const rel = full.slice(deploy.length + 1)
	if (!existsSync(join(root, rel))) drifted.push(`${rel} (stale, no longer in root)`)
}

if (check) {
	if (drifted.length) {
		console.error("FAIL deploy mirror is out of date\n")
		for (const d of drifted) console.error(`  - ${d}`)
		console.error("\nRun `npm run sync:deploy` to regenerate repo/ from the root.")
		process.exit(1)
	}
	console.log(`PASS deploy mirror guard :: ${targets.length} files match root`)
} else {
	console.log(`Synced deploy mirror :: ${copied} file(s) updated, ${targets.length} tracked`)
	if (drifted.length) {
		console.log("Stale files still present in repo/ (delete by hand if intended):")
		for (const d of drifted) console.log(`  - ${d}`)
	}
}
