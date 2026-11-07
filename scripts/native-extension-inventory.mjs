#!/usr/bin/env node
// Static repository-owned discovery only: never loads factories, settings, or an operator home.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = [".omk/extensions", "packages/coding-agent/examples/extensions"];

function owned(path) {
	const resolved = realpathSync(path);
	if (!roots.some((dir) => resolved === join(root, dir) || resolved.startsWith(`${join(root, dir)}${sep}`))) {
		throw new Error("Inventory refuses paths outside repository-owned extension roots");
	}
	return resolved;
}

function directoryEntries(directory, seen = new Set()) {
	const canonical = owned(directory);
	if (seen.has(canonical) || seen.size >= 64) return [];
	seen = new Set(seen).add(canonical);
	const manifest = join(directory, "package.json");
	if (existsSync(manifest)) {
		let pkg;
		try {
			pkg = JSON.parse(readFileSync(owned(manifest), "utf8"));
		} catch {
			return []; // Malformed/empty declarations are authoritative, not an index fallback.
		}
		if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return [];
		const key = Object.hasOwn(pkg, "omk") ? "omk" : Object.hasOwn(pkg, "pi") ? "pi" : undefined;
		if (key) {
			if (!pkg[key] || typeof pkg[key] !== "object" || !Array.isArray(pkg[key].extensions)) return [];
			return pkg[key].extensions.flatMap((declared) => {
				if (typeof declared !== "string") return [];
				const candidate = resolve(directory, declared);
				if (!roots.some((dir) => candidate === join(root, dir) || candidate.startsWith(`${join(root, dir)}${sep}`))) throw new Error("Inventory refuses declarations outside repository-owned extension roots");
				if (!existsSync(candidate)) return [];
				owned(candidate);
				const paths = statSync(candidate).isDirectory()
					? (realpathSync(candidate) === canonical ? null : directoryEntries(candidate, seen)) ?? ["index.ts", "index.js", "index.mjs", "index.cjs"]
						.filter((name) => existsSync(join(candidate, name))).slice(0, 1).map((name) => join(candidate, name))
					: [candidate];
				return paths.map((entry) => ({
					id: typeof entry === "string" ? relative(root, entry) : entry.id,
					discovery: `${relative(root, manifest)}#${key}.extensions`,
				}));
			});
		}
	}
	const index = ["index.ts", "index.js"].find((name) => existsSync(join(directory, name)));
	return index ? [{ id: relative(root, owned(join(directory, index))), discovery: "directory-index" }] : null;
}

function inventory() {
	const entries = [];
	const excluded = [];
	for (const [index, directory] of roots.entries()) {
		const scope = index === 0 ? "repository" : "example";
		for (const item of readdirSync(owned(join(root, directory)), { withFileTypes: true })) {
			const path = join(root, directory, item.name);
			if (item.isSymbolicLink()) throw new Error("Inventory refuses symlink discovery roots");
			if (item.isFile() && /\.(ts|js)$/.test(item.name) && !/\.(test|spec)\./.test(item.name)) {
				entries.push({ id: relative(root, owned(path)), scope, discovery: "direct-file" });
			} else if (item.isDirectory()) {
				entries.push(...(directoryEntries(path) ?? []).map((entry) => ({ ...entry, scope })));
			}
		}
		const selected = new Set(entries.map((entry) => entry.id));
		function walk(path) {
			for (const item of readdirSync(owned(path), { withFileTypes: true })) {
				const child = join(path, item.name);
				const id = relative(root, child);
				if (item.isSymbolicLink() || ["node_modules", ".git", "vendor"].includes(item.name)) {
					excluded.push({ id, reason: "dependency/vendor/symlink tree is not a direct entry" });
				} else if (item.isDirectory()) walk(child);
				else if (/\.[cm]?[jt]s(?:\.disabled)?$/.test(item.name) && !selected.has(id)) {
					excluded.push({ id, reason: /\.(test|spec)\.|^test\./.test(item.name) ? "test, not declared entry" : item.name.endsWith(".disabled") ? "disabled" : "helper or non-autoload suffix, not declared entry" });
				}
			}
		}
		walk(join(root, directory));
	}
	const factoriesPath = "packages/coding-agent/src/core/extensions/builtin/harness-factories.ts";
	const source = readFileSync(join(root, factoriesPath), "utf8");
	const builtins = [...source.matchAll(/path: "(<builtin:[^"]+>)", envVar: "([^"]+)"/g)].map((match) => ({
		id: match[1], envVar: match[2], discovery: factoriesPath,
	}));
	builtins.unshift({ id: "<builtin:command-safety>", envVar: "OMK_COMMAND_SAFETY", discovery: "packages/coding-agent/src/core/resource-loader.ts" }, { id: "<builtin:todo-checklist>", envVar: "OMK_TODO_CHECKLIST", discovery: "packages/coding-agent/src/core/resource-loader.ts" });
	builtins.push({ id: "<builtin:tencent-memory>", envVar: "OMK_TENCENT_MEMORY", discovery: "packages/coding-agent/src/core/resource-loader.ts" });
	return { entries: entries.sort((a, b) => a.id.localeCompare(b.id)), builtins, excluded: excluded.sort((a, b) => a.id.localeCompare(b.id)) };
}

function validate(ledger, discovered) {
	const errors = [];
	const identities = (rows) => (Array.isArray(rows) ? rows : []).map((row) => row.id).sort();
	for (const section of ["entries", "builtins"]) {
		if (JSON.stringify(identities(ledger[section])) !== JSON.stringify(identities(discovered[section]))) errors.push(`${section}: exact identity set differs`);
	}
	for (const row of [...(ledger.entries ?? []), ...(ledger.builtins ?? [])]) {
		if (!row.registry || typeof row.registry !== "object" || Object.entries(row.registry).some(([key, value]) => ["commands", "tools", "shortcuts", "renderers", "providers"].includes(key) ? !Array.isArray(value) : ["events", "flags"].includes(key) ? !value || typeof value !== "object" || Array.isArray(value) : true)) errors.push(`${row.id}: registry contract missing or invalid`);
		if (!row.baseline || !row.sourceReview || !Array.isArray(row.features) || row.features.length === 0) errors.push(`${row.id}: feature evidence missing`);
		for (const feature of row.features ?? []) {
			if (!feature.family || (!feature.cases?.length && !feature.unverified?.trim())) errors.push(`${row.id}: feature evidence or UNVERIFIED reason missing`);
		}
		if (!row.unverified?.length || row.unverified.some((item) => item.status !== "UNVERIFIED" || !item.reason?.trim())) errors.push(`${row.id}: explicit UNVERIFIED states missing`);
	}
	for (const entry of discovered.entries) {
		const row = ledger.entries?.find((row) => row.id === entry.id);
		if (row && (row.scope !== entry.scope || row.discovery !== entry.discovery)) errors.push(`${entry.id}: discovery contract differs`);
	}
	for (const entry of discovered.builtins) if (ledger.builtins?.find((row) => row.id === entry.id)?.envVar !== entry.envVar) errors.push(`${entry.id}: builtin activation control differs`);
	return errors;
}

try {
	if (process.argv.slice(2).some((arg) => !["--check", "--stdin"].includes(arg))) throw new Error("Only --check and --stdin are supported; roots cannot be overridden");
	const discovered = inventory();
	if (process.argv.includes("--check")) {
		const ledger = JSON.parse(readFileSync(process.argv.includes("--stdin") ? 0 : join(root, "packages/coding-agent/test/fixtures/native-extension-inventory.json"), "utf8"));
		const errors = validate(ledger, discovered);
		if (errors.length) throw new Error(errors.join("\n"));
		console.log(`Exact identity/schema check: ${discovered.entries.length} public entries, ${discovered.builtins.length} builtins. NOT feature acceptance.`);
	} else console.log(JSON.stringify(discovered, null, 2));
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
