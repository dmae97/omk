#!/usr/bin/env node
// Spec 108-1: reproducible inventory of every pi dependency / import crossing the boundary.
// Usage: node scripts/pi-inventory.mjs [--check]   (--check fails if the committed list differs)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// PI_INVENTORY_ROOT / PI_INVENTORY_OUT exist only for scripts/test/pi-inventory.test.mjs fixtures.
const ROOT = process.env.PI_INVENTORY_ROOT ?? new URL("..", import.meta.url).pathname;
const OUT = process.env.PI_INVENTORY_OUT ?? join(ROOT, "specs/108-pi-decoupling/pi-inventory.generated.json");
const PI_PKG = /^@(mariozechner|earendil-works|oh-my-pi)\/|^pi-[a-z0-9-]+$/;
const DEP_KEYS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function git(...a) { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); }
const files = git("ls-files", "-z").split("\0").filter(Boolean);

// 1. manifests
const manifests = [];
for (const f of files.filter((f) => f.endsWith("package.json")).sort()) {
	let p; try { p = JSON.parse(readFileSync(join(ROOT, f), "utf8")); } catch { continue; }
	for (const k of DEP_KEYS) for (const [name, version] of Object.entries(p[k] ?? {}))
		if (PI_PKG.test(name)) manifests.push({ manifest: f, kind: k, name, version });
}

// 2. imports (static, type-only, re-export, dynamic import(), require()) in src/test/scripts
const CODE = /\.(m|c)?[jt]sx?$/;
const SCOPE = /(^|\/)(src|test|scripts)\//;
const SPEC = String.raw`['"\x60](@(?:mariozechner|earendil-works|oh-my-pi)\/[^'"\x60]+|pi-[a-z0-9-]+(?:\/[^'"\x60]*)?)['"\x60]`;
const PATTERNS = [
	["static", new RegExp(String.raw`^\s*import\s+(?!type\b)([^;\'"\x60]*?)\s+from\s+${SPEC}`, "gm")],
	["type-only", new RegExp(String.raw`^\s*import\s+type\s+([^;\'"\x60]*?)\s+from\s+${SPEC}`, "gm")],
	["side-effect", new RegExp(String.raw`^\s*import\s+${SPEC}`, "gm")],
	["re-export", new RegExp(String.raw`^\s*export\s+([^;\'"\x60]*?)\s+from\s+${SPEC}`, "gm")],
	["dynamic", new RegExp(String.raw`import\(\s*()${SPEC}\s*\)`, "g")],
	["require", new RegExp(String.raw`\b(?:require|requireClipboard|createRequire\([^)]*\))\(\s*()${SPEC}\s*\)`, "g")],
];
const imports = [];
for (const f of files.filter((f) => CODE.test(f) && SCOPE.test(f) && !f.includes("node_modules/")).sort()) {
	const text = readFileSync(join(ROOT, f), "utf8");
	for (const [kind, re] of PATTERNS) for (const m of text.matchAll(re)) {
		const line = text.slice(0, m.index).split("\n").length;
		const clause = m.length > 2 ? m[1] : "";
		const symbols = (clause.match(/\{([\s\S]*)\}/)?.[1] ?? clause).split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean);
		const mod = f.split("/").slice(0, 2).join("/");
		imports.push({ file: `${f}:${line}`, module: mod, kind, specifier: m[m.length - 1], symbols: symbols.length ? symbols : ["*"], scope: /(^|\/)test\//.test(f) ? "test" : /(^|\/)scripts\//.test(f) ? "scripts" : f.includes("/vendor/") ? "vendored" : "src" });
	}
	// catch-all: any remaining pi specifier mention (string-literal fixtures, comments) so nothing is missed
	const seen = new Set(imports.filter((i) => i.file.startsWith(f + ":")).map((i) => i.file));
	text.split("\n").forEach((l, i) => {
		const m = l.match(/['"\x60](@(?:mariozechner|earendil-works|oh-my-pi)\/[^'"\x60]+)['"\x60]/);
		if (m && !seen.has(`${f}:${i + 1}`)) imports.push({ file: `${f}:${i + 1}`, module: f.split("/").slice(0, 2).join("/"), kind: "mention", specifier: m[1], symbols: ["*"], scope: /(^|\/)test\//.test(f) ? "test" : f.includes("/vendor/") ? "vendored" : "src" });
	});
}
// 3. runtime alias surface (pi specifiers OMK resolves for third-party extensions)
const COMPAT = join(ROOT, "packages/coding-agent/src/core/pi-compat.ts");
const compat = existsSync(COMPAT) ? readFileSync(COMPAT, "utf8") : "";
const aliases = [...compat.matchAll(/\$\{namespace\}(\/pi-[^`]+)`,\s*"([^"]+)"/g)].flatMap(([, s, t]) =>
	["@earendil-works", "@mariozechner"].map((ns) => ({ specifier: ns + s, target: t })));
const aliasConsumers = files.filter((f) => /\/src\/.*\.ts$/.test(f) && f !== "packages/coding-agent/src/core/pi-compat.ts")
	.flatMap((f) => readFileSync(join(ROOT, f), "utf8").split("\n").map((l, i) => [f, i + 1, l]))
	.filter(([, , l]) => /from\s+["'][./]+pi-compat\.ts["']/.test(l)).map(([f, n]) => `${f}:${n}`);

const out = JSON.stringify({ schema: 1, manifests, imports, runtimeAliases: aliases.sort((a, b) => a.specifier.localeCompare(b.specifier)), aliasConsumers }, null, "\t") + "\n";
if (process.argv.includes("--check")) {
	const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
	if (cur !== out) { console.error("pi-inventory: committed list differs from source. Run `npm run inventory:pi`."); process.exit(1); }
	console.log(`pi-inventory: OK (${manifests.length} manifest deps, ${imports.length} imports, ${aliasConsumers.length} alias consumers)`);
} else { writeFileSync(OUT, out); console.log(`wrote ${OUT}`); }
