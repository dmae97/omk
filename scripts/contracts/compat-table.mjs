import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./artifacts.mjs";
import { formatTypeScript } from "./typescript.mjs";

const RELATIVE = "packages/coding-agent/src/core/pi-compat.ts";
export const COMPAT_TABLE = join(ROOT, RELATIVE);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUFFIX = /^pi-[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

function fail(reason) {
	throw Error(`unsupported compatibility table: ${reason}`);
}

function names(list, label) {
	if (!Array.isArray(list) || !list.length || !list.every((n) => typeof n === "string" && NAME.test(n)))
		fail(`${label} must be a non-empty list of lowercase names`);
	if (new Set(list).size !== list.length) fail(`${label} has duplicates`);
	return list;
}

function namespaceForm(aliases, targets) {
	if (!Array.isArray(aliases) || !aliases.length) fail("empty alias table");
	const groups = new Map();
	for (const entry of aliases) {
		const [specifier, target] = Array.isArray(entry) && entry.length === 2 ? entry : fail("alias is not a pair");
		const match = typeof specifier === "string" ? specifier.match(/^@([^/]+)\/(.+)$/) : null;
		if (!match || !NAME.test(match[1]) || !SUFFIX.test(match[2])) fail(`unsafe alias specifier ${specifier}`);
		if (!targets.includes(target)) fail(`unknown alias target ${target}`);
		const rows = groups.get(match[1]) ?? groups.set(match[1], []).get(match[1]);
		rows.push([match[2], target]);
	}
	const [first, ...rest] = [...groups.values()];
	if (rest.some((rows) => JSON.stringify(rows) !== JSON.stringify(first)))
		fail("every namespace must alias the same suffixes to the same targets");
	if (new Set(first.map(([suffix]) => suffix)).size !== first.length) fail("duplicate alias suffix");
	return { namespaces: [...groups.keys()], rows: first };
}

export function renderCompatTable(compat) {
	if (!compat || typeof compat !== "object") fail("missing compat catalog");
	const targets = names(compat.targets, "targets");
	const dialects = compat.dialects;
	if (
		!Array.isArray(dialects) ||
		dialects.length < 2 ||
		new Set(dialects).size !== dialects.length ||
		!dialects.every((d) => typeof d === "string" && /^[a-z0-9]+(?:\+[a-z0-9]+)*$/.test(d)) ||
		!dialects.includes(compat.defaultDialect)
	)
		fail("dialects must list the default and at least one opt-in dialect");
	const classifier = names(compat.classifierNamespaces, "classifier namespaces").join("|");
	const packages = names(compat.legacyPackages, "legacy packages").join("|");
	if (typeof compat.hint !== "string" || !compat.hint.length) fail("hint must be a non-empty string");
	const { namespaces, rows } = namespaceForm(compat.aliases, targets);
	const q = (value) => JSON.stringify(value);
	const text = `// Generated from native/omk-contract/src/compat.rs. Do not edit.
// Run: node scripts/generate-contracts.mjs --write
export type PiCompatibilityTarget = ${targets.map(q).join(" | ")};

const PI_NAMESPACES = [${namespaces.map((n) => q("@" + n)).join(", ")}] as const;

export const LEGACY_PI_RUNTIME_ALIASES: Readonly<Record<string, PiCompatibilityTarget>> = Object.freeze(
	Object.fromEntries(
		PI_NAMESPACES.flatMap((namespace) => [
${rows.map(([suffix, target]) => `\t\t\t[\`\${namespace}/${suffix}\`, ${q(target)}],`).join("\n")}
		]),
	) as Record<string, PiCompatibilityTarget>,
);

const LEGACY_PI_IMPORT =
	/^@(${classifier})\\/pi-(?:${packages})(?:\\/|$)/u;

export function isLegacyPiRuntimeImport(specifier: string): boolean {
	return LEGACY_PI_IMPORT.test(specifier);
}

export function isSupportedLegacyPiRuntimeImport(specifier: string): boolean {
	return Object.getOwnPropertyDescriptor(LEGACY_PI_RUNTIME_ALIASES, specifier) !== undefined;
}

const LEGACY_PI_IMPORT_MENTION =
	/@(?:${classifier})\\/pi-(?:${packages})\\b/u;

/**
 * Migration hint appended to a native-mode extension load failure that names a legacy Pi package.
 * Since OMK 2.0 an omitted dialect is "omk", so Pi compatibility needs the explicit opt-in.
 */
export function legacyPiImportHint(message: string, dialect: ${dialects.map(q).join(" | ")}): string {
	if (dialect !== ${q(compat.defaultDialect)} || !LEGACY_PI_IMPORT_MENTION.test(message)) return "";
	return ${q(compat.hint)};
}
`;
	return formatTypeScript(RELATIVE, text);
}

export function checkCompatTable(path, expected) {
	if (!existsSync(path)) throw Error(`missing compatibility table: ${path}`);
	if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw Error("unsafe compatibility table link");
	if (readFileSync(path, "utf8") !== expected)
		throw Error(`compatibility table drift: ${path}. Run: node scripts/generate-contracts.mjs --write`);
}

export function writeCompatTable(path, text) {
	if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()))
		throw Error("unsafe compatibility table link");
	const temporary = path + ".tmp";
	if (existsSync(temporary)) throw Error("unsafe existing temporary compatibility table");
	writeFileSync(temporary, text, { flag: "wx" });
	renameSync(temporary, path);
}
