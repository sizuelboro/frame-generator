#!/usr/bin/env node
/**
 * Guard: the Studio bundle is a set of ordered classic scripts sharing one
 * global scope. The order in index.html is load-bearing (see docs/architecture.md).
 *
 * This fails the build if index.html and js/ ever disagree:
 *   - a file in js/ that index.html never loads
 *   - a script tag pointing at a file that does not exist
 *   - scripts loaded out of numeric order
 *   - a duplicate script tag
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const html = readFileSync(join(root, "index.html"), "utf8")

const loaded = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'](js\/[^"']+)["']/gi)].map(
	(m) => m[1].replace(/^js\//, ""),
)

const onDisk = readdirSync(join(root, "js"))
	.filter((f) => f.endsWith(".js"))
	.sort()

const errors = []

const seen = new Set()
for (const f of loaded) {
	if (seen.has(f)) errors.push(`duplicate script tag: js/${f}`)
	seen.add(f)
}

for (const f of loaded) {
	if (!onDisk.includes(f)) errors.push(`index.html loads js/${f}, which does not exist`)
}

for (const f of onDisk) {
	if (!loaded.includes(f)) errors.push(`js/${f} exists but index.html never loads it`)
}

// Numeric prefixes must ascend in load order.
const prefix = (f) => {
	const m = /^(\d+)-/.exec(f)
	return m ? Number(m[1]) : null
}
let last = -Infinity
let lastName = null
for (const f of loaded) {
	const n = prefix(f)
	if (n === null) {
		errors.push(`js/${f} has no NN- numeric prefix, so its load order cannot be verified`)
		continue
	}
	if (n < last) {
		errors.push(`load order regression: js/${f} is loaded after js/${lastName}`)
	}
	last = n
	lastName = f
}

if (errors.length) {
	console.error("FAIL script order guard\n")
	for (const e of errors) console.error(`  - ${e}`)
	console.error("\nThe Studio scripts share one global scope; order in index.html is load-bearing.")
	process.exit(1)
}

console.log(`PASS script order guard :: ${loaded.length} scripts, ${loaded[0]} -> ${loaded.at(-1)}`)
