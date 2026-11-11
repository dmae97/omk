import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const AGENT = join(ROOT, "packages/coding-agent/src");
export const MATRIX = join(ROOT, "specs/120-rust-core/capability-matrix.json");
const DISPOSITIONS = ["ported", "hosted", "refused"];
const DELIVERS = ["K1", "K2", "K3", "K4", "K5"];
const LIFTS = ["K6", "K7", "K8", "later-spec"];

function union(path, name) {
	const text = readFileSync(join(AGENT, path), "utf8");
	const match = text.match(new RegExp(`export type ${name} = ([^;]+);`));
	if (!match) throw Error(`capability inventory: ${name} not found in ${path}`);
	return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

export function readInventory() {
	const slash = readFileSync(join(AGENT, "core/slash-commands.ts"), "utf8");
	const list = slash.slice(slash.indexOf("BUILTIN_SLASH_COMMANDS"));
	return {
		modes: union("cli/args.ts", "Mode"),
		tools: union("core/tools/index.ts", "ToolName"),
		slashCommands: [...list.matchAll(/\bname: "([^"]+)"/g)].map((m) => m[1]),
		builtinFiles: readdirSync(join(AGENT, "core/extensions/builtin"))
			.filter((n) => n.endsWith(".ts"))
			.sort(),
	};
}

function expectedFeatures(inventory) {
	return [
		...inventory.modes.flatMap((m) => (m === "text" ? ["mode.interactive", "mode.print"] : [`mode.${m}`])),
		...inventory.tools.map((t) => `tool.${t}`),
		...inventory.slashCommands.map((c) => `slash.${c}`),
	];
}

function unique(list, key, label) {
	const seen = new Set();
	for (const item of list) {
		if (seen.has(item[key])) throw Error(`capability matrix: duplicate ${label} ${item[key]}`);
		seen.add(item[key]);
	}
	return seen;
}

function checkFeature(f) {
	if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(f.id ?? "")) throw Error(`capability matrix: bad feature id ${f.id}`);
	if (!DISPOSITIONS.includes(f.disposition))
		throw Error(`capability matrix: ${f.id} needs one disposition of ${DISPOSITIONS.join(", ")}`);
	const stages = f.disposition === "refused" ? LIFTS : DELIVERS;
	if (!stages.includes(f.stage)) throw Error(`capability matrix: ${f.id} ${f.disposition} needs a stage in ${stages}`);
	if (typeof f.description !== "string" || !f.description.trim())
		throw Error(`capability matrix: ${f.id} needs a description`);
}

export function checkCapabilityMatrix(matrix, inventory) {
	if (matrix?.schema !== "omk.capability-matrix.v1") throw Error("capability matrix: unknown schema");
	const features = matrix.features ?? [];
	const ids = unique(features, "id", "feature");
	features.forEach(checkFeature);
	const expected = expectedFeatures(inventory);
	for (const id of expected) if (!ids.has(id)) throw Error(`capability matrix: missing feature ${id}`);
	for (const id of ids)
		if (/^(mode|tool|slash)\./.test(id) && !expected.includes(id))
			throw Error(`capability matrix: unknown feature ${id} is not in the source inventory`);
	const byId = new Map(features.map((f) => [f.id, f]));
	const entries = matrix.builtinExtensions ?? [];
	const files = unique(entries, "file", "built-in extension file");
	for (const file of inventory.builtinFiles)
		if (!files.has(file)) throw Error(`capability matrix: missing built-in extension file ${file}`);
	for (const entry of entries) {
		if (!inventory.builtinFiles.includes(entry.file))
			throw Error(`capability matrix: no such built-in extension file ${entry.file}`);
		const feature = byId.get(entry.feature);
		if (!feature?.id.startsWith("builtin.")) throw Error(`capability matrix: ${entry.file} names unknown feature`);
		if (entry.disposition !== feature.disposition)
			throw Error(`capability matrix: ${entry.file} disposition differs from its feature ${feature.id}`);
		if (entry.disposition === "hosted") throw Error(`capability matrix: ${entry.file} hosted; F4 allows none`);
		if (entry.safety === true && (entry.disposition !== "ported" || feature.stage !== "K3"))
			throw Error(`capability matrix: safety gate ${entry.file} must be ported by K3 (F4)`);
		if (entry.safety !== true && entry.disposition === "ported")
			throw Error(`capability matrix: ${entry.file} ported but not a safety gate; F4 refuses the others`);
	}
	for (const f of features)
		if (f.id.startsWith("builtin.") && !entries.some((e) => e.feature === f.id))
			throw Error(`capability matrix: ${f.id} has no file`);
	return { features: features.length, builtinFiles: entries.length };
}
