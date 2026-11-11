import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildModel, resolveType } from "./rust-model.mjs";
import { context, fileName, isWire, normalType, wireIdent } from "./rust-types.mjs";
import { customType, validateAdapters } from "./serde-adapters.mjs";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const hash = (text) => createHash("sha256").update(text).digest("hex");
function format(name, text) {
	if (name.endsWith(".json")) return JSON.stringify(JSON.parse(text), null, "\t") + "\n";
	const result = spawnSync(
		process.execPath,
		[
			ROOT + "node_modules/@biomejs/biome/bin/biome",
			"check",
			"--write",
			"--stdin-file-path=" + ROOT + "packages/protocol/src/generated/rust-contracts/" + name,
		],
		{ input: text, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
	);
	if (result.error || result.signal || result.status !== 0)
		throw Error(
			`declaration formatter failed: ${name}: exit=${result.status} signal=${result.signal} ${result.error?.message ?? ""} ${result.stderr ?? ""}`,
		);
	return result.stdout;
}
function declarations(model, module) {
	const core = [];
	const facade = [];
	const add = (name, expression, generics = []) => {
		const declared = generics.length
			? "<" + generics.map((g) => g.name + (g.constraint ? " extends " + g.constraint : "")).join(", ") + ">"
			: "";
		const applied = generics.length ? "<" + generics.map((g) => g.name).join(", ") + ">" : "";
		core.push(`export type ${wireIdent(module.id, name)}${declared} = ${expression};`);
		facade.push(`export type ${name}${declared} = wire.${wireIdent(module.id, name)}${applied};`);
	};
	for (const item of module.types.values()) {
		if (!isWire(module, item)) continue;
		const ctx = context(
			model,
			module,
			item.generics.map((g) => g.name),
		);
		add(item.name, customType(model, module, item, ctx) ?? normalType(item, ctx), item.generics);
	}
	for (const use of module.uses.filter((u) => u.pub && u.path.at(-1) !== "*")) {
		const target = resolveType(model, module, use.path);
		if (!isWire(target.module, target.item)) throw Error("unsupported public Rust re-export");
		add(use.path.at(-1), wireIdent(target.module.id, target.item.name));
	}
	for (const [name, value] of module.constants) if (module.id !== "compat") add(name, String(value));
	const header = `// Generated from native/omk-contract/src/${module.file}. Do not edit.\n// Run: node scripts/generate-contracts.mjs --write\n`;
	const imports = facade.length ? 'import type * as wire from "./wire.generated.ts";\n' : "";
	return { core, facade: header + imports + facade.join("\n") + "\n" };
}
export function generateArtifacts(bundle) {
	const model = buildModel(bundle);
	validateAdapters(model);
	const artifacts = new Map();
	const core = [
		"// Generated from native/omk-contract/src. Do not edit; import the per-module files instead.",
		"// Run: node scripts/generate-contracts.mjs --write",
		"// JSON wire values, not arbitrary JavaScript values.",
		"export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue };",
	];
	artifacts.set(
		"json.ts",
		format(
			"json.ts",
			'// Generated JSON wire values. Do not edit.\nimport type * as wire from "./wire.generated.ts";\nexport type JsonValue = wire.JsonValue;\n',
		),
	);
	for (const module of model.modules.values()) {
		const result = declarations(model, module);
		core.push(...result.core);
		artifacts.set(fileName(module.id), format(fileName(module.id), result.facade));
	}
	artifacts.set("wire.generated.ts", format("wire.generated.ts", core.join("\n") + "\n"));
	const root = model.modules.get("lib");
	const exports = root.mods
		.filter((m) => m.pub)
		.map(
			(m) =>
				`export type * as ${m.name
					.split("_")
					.map((s) => s[0].toUpperCase() + s.slice(1))
					.join("")} from "./${fileName(m.name)}";`,
		);
	artifacts.set(
		"index.ts",
		format(
			"index.ts",
			'// Generated type-only entry point. No runtime replacement or package-root export.\nexport type * as Constants from "./lib.ts";\n' +
				exports.join("\n") +
				"\n",
		),
	);
	const recipes = [
		"rust-syntax.mjs",
		"rust-model.mjs",
		"rust-types.mjs",
		"serde-adapters.mjs",
		"serde-adapters.json",
		"typescript.mjs",
		"artifacts.mjs",
	];
	const manifest = {
		schema: "omk.contract.declarations.v1",
		scope: "wire declarations only; T004 compatibility table drift not checked",
		sourcesSha256: hash(JSON.stringify(Object.entries(bundle.files).sort())),
		generatorSha256: hash(
			bundle.generator + recipes.map((n) => n + ":" + hash(readFileSync(new URL(n, import.meta.url)))).join("\n"),
		),
		files: [...artifacts].sort().map(([path, text]) => ({ path, sha256: hash(text) })),
	};
	artifacts.set("manifest.json", format("manifest.json", JSON.stringify(manifest, null, 2) + "\n"));
	return new Map([...artifacts].sort());
}
