import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error("invalid fixture JSON");
	}
}

// Preserve the runtime type of fields. Synthetic content is not a timing field.
export function normalizeJsonl(text, replacements) {
	const ids = new Map();
	const normalize = (value) => {
		if (typeof value === "string") {
			for (const [from, to] of replacements) value = value.split(from).join(to);
			return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => {
				const key = id.toLowerCase();
				if (!ids.has(key)) ids.set(key, `<id-${ids.size + 1}>`);
				return ids.get(key);
			}).replace(/^faux:\d+:[a-z0-9]+$/, "faux:<api>");
		}
		if (Array.isArray(value)) return value.map(normalize);
		if (!value || typeof value !== "object") return value;
		const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
		if (result.type === "prompt_settled") {
			if (typeof result.durationMs !== "number" || !Number.isFinite(result.durationMs) || result.durationMs < 0)
				throw new Error("prompt_settled durationMs must be a finite nonnegative number");
			result.durationMs = 0;
		}
		return result;
	};
	return text.split("\n").filter((line) => line.trim()).map((line) => JSON.stringify(normalize(parseJson(line)))).join("\n") + "\n";
}

export function inventory(directory) {
	const entries = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir).sort()) {
			const file = join(dir, name);
			const stat = lstatSync(file);
			if (stat.isSymbolicLink()) throw new Error("fixture symlink refused");
			if (stat.isDirectory()) walk(file);
			else entries.push({ path: relative(directory, file).replaceAll("\\", "/"), sha256: sha256(readFileSync(file)) });
		}
	};
	walk(directory);
	return entries.filter((entry) => entry.path !== "manifest.json").sort((a, b) => {
		if (a.path === b.path) return 0;
		return a.path < b.path ? -1 : 1;
	});
}

export function validateManifest(directory) {
	const manifest = parseJson(readFileSync(join(directory, "manifest.json"), "utf8"));
	if (manifest.schema !== "omk.contract.fixtures.v2" || !Array.isArray(manifest.files)) throw new Error("unsupported fixture manifest");
	const seen = new Set();
	for (const entry of manifest.files) {
		if (typeof entry.path !== "string" || isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes("..") || seen.has(entry.path))
			throw new Error("invalid or duplicate manifest path");
		seen.add(entry.path);
	}
	if (JSON.stringify(inventory(directory)) !== JSON.stringify(manifest.files)) throw new Error("fixture inventory or digest mismatch");
	return manifest;
}

export function privacyScan(directory) {
	for (const entry of inventory(directory)) {
		const text = readFileSync(join(directory, entry.path), "utf8");
		if (/\/home\/|\/mnt\/|\/Users\/|[A-Za-z]:\\(?:\\)?Users\\/.test(text)) throw new Error(`private path in ${entry.path}`);
		const walk = (value) => {
			if (Array.isArray(value)) return value.forEach(walk);
			if (!value || typeof value !== "object") return;
			for (const [key, item] of Object.entries(value)) {
				if (/^(?:apiKey|accessToken|refreshToken|password|authorization|privateKey)$/i.test(key) && item && !(key === "apiKey" && item === "faux-key"))
					throw new Error(`credential field in ${entry.path}`);
				walk(item);
			}
		};
		const records = entry.path.endsWith(".jsonl") ? text.trimEnd().split("\n").map(parseJson) : [parseJson(text)];
		records.forEach(walk);
	}
}
