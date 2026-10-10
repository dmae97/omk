#!/usr/bin/env node
/**
 * `AbortSignal.any()` ratchet.
 *
 * On Node 22 (the oldest runtime OMK supports) a composite signal from `AbortSignal.any()` that has
 * an abort listener and never aborts stays reachable for the life of the process, even after its
 * sources and the composite are dropped: about 0.3 KB per call, and 1.1 KB per model request on
 * the budget-stream path before it moved to `linkAbortSignals()`. nodejs/node #62363 and #64476
 * are fixed in 24.16/24.20 and 26.1/26.7 but not backported to 22.x.
 *
 * New code uses `linkAbortSignals()` from `packages/coding-agent/src/core/abort-link.ts` (or wires
 * listeners explicitly, as `tool-timeout.ts` does). Existing call sites are frozen per file in
 * `scripts/abort-signal-any-baseline.json`: the gate fails when a file gains a call, and reports
 * files that dropped below their record so the baseline can be tightened.
 *
 * Usage:
 *   node scripts/check-abort-signal-any.mjs            # verify
 *   node scripts/check-abort-signal-any.mjs --update   # rewrite the baseline (shrink only)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, "scripts", "abort-signal-any-baseline.json");
const CALL = /\bAbortSignal\.any\s*\(/g;

/**
 * Count calls outside comments. One left-to-right pass tracks string literals, so "https://" or
 * "/*" inside a string cannot hide a later call; calls written inside strings still count, which
 * errs toward failing. Regex literals are not tracked: a ratchet needs no parser.
 */
export function countAbortSignalAny(source) {
	let code = "";
	let quote = "";
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (quote) {
			code += char;
			if (char === "\\") code += source[++i] ?? "";
			else if (char === quote) quote = "";
		} else if (char === "/" && source[i + 1] === "/") {
			const end = source.indexOf("\n", i);
			i = end === -1 ? source.length : end - 1;
		} else if (char === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			i = end === -1 ? source.length : end + 1;
			code += " ";
		} else {
			if (char === '"' || char === "'" || char === "`") quote = char;
			code += char;
		}
	}
	return code.match(CALL)?.length ?? 0;
}

function* sourceFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(path);
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts")) yield path;
	}
}

export function scan(root = repoRoot) {
	const counts = {};
	const packages = join(root, "packages");
	for (const pkg of readdirSync(packages, { withFileTypes: true })) {
		const src = join(packages, pkg.name, "src");
		if (!pkg.isDirectory() || !existsSync(src)) continue;
		for (const file of sourceFiles(src)) {
			const count = countAbortSignalAny(readFileSync(file, "utf8"));
			if (count > 0) counts[relative(root, file).split("\\").join("/")] = count;
		}
	}
	return counts;
}

function main() {
	const current = scan();
	const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
	const grown = [];
	const shrank = [];
	for (const [file, count] of Object.entries(current)) {
		const allowed = baseline[file] ?? 0;
		if (count > allowed) grown.push(`${file}: ${count} call(s), baseline ${allowed}`);
		else if (count < allowed) shrank.push(file);
	}
	for (const file of Object.keys(baseline)) if (!(file in current)) shrank.push(file);
	if (process.argv.includes("--update")) {
		// The first --update records the starting point; later ones may only shrink it.
		if (grown.length > 0 && existsSync(baselinePath)) {
			console.error("Refusing to grow the AbortSignal.any() baseline:\n  " + grown.join("\n  "));
			process.exit(1);
		}
		const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
		writeFileSync(baselinePath, `${JSON.stringify(sorted, null, "\t")}\n`);
		console.log(`AbortSignal.any() baseline written: ${Object.keys(sorted).length} file(s).`);
		return;
	}
	if (grown.length > 0) {
		console.error(
			"New AbortSignal.any() call(s). On Node 22 an observed composite that never aborts is retained for the\n" +
				"life of the process. Use linkAbortSignals() from packages/coding-agent/src/core/abort-link.ts.\n  " +
				grown.join("\n  "),
		);
		process.exit(1);
	}
	const total = Object.values(current).reduce((sum, count) => sum + count, 0);
	const note = shrank.length > 0 ? ` ${shrank.length} file(s) shrank — run with --update to tighten the baseline.` : "";
	console.log(`AbortSignal.any() OK: ${total} call(s) held at baseline.${note}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
