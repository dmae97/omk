import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPatch, parsePatch, reversePatch } from "diff";
import { getPackageDir } from "../config.ts";

const nativeRepairs = [
	{
		name: "pi-subagents",
		version: "0.78.0",
		resource: "native-subagents",
		label: "subagent",
		files: new Set([
			"src/runs/shared/child-session.js",
			"src/runs/foreground/execution.js",
			"src/runs/background/subagent-runner.js",
			"src/runs/background/runner-aliases.js",
		]),
	},
	{
		name: "@aeondave/pi-skill-optimizer",
		version: "3.1.2",
		resource: "native-skill-optimizer",
		label: "skill optimizer",
		files: new Set(["src/persistence.ts"]),
	},
];

/** Restore versioned native repairs after package replacement; never convert a legacy manifest. */
export function repairNativePackage(packageDir: string): void {
	if (!existsSync(join(packageDir, "package.json"))) return;
	const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
		name?: unknown;
		version?: unknown;
		omk?: unknown;
	};
	const repair = nativeRepairs.find((entry) => entry.name === manifest?.name);
	if (!repair || !manifest.omk || typeof manifest.omk !== "object" || Array.isArray(manifest.omk)) return;
	if (manifest.version !== repair.version) {
		throw new Error(
			`Unsupported native ${manifest.name} version '${manifest.version}'; review its repairs before updating.`,
		);
	}
	const root = realpathSync(packageDir);
	const patches = parsePatch(
		readFileSync(join(getPackageDir(), `resources/${repair.resource}/${repair.version}.patch`), "utf8"),
	);
	if (
		patches.length !== repair.files.size ||
		new Set(patches.map((patch) => patch.oldFileName)).size !== repair.files.size
	) {
		throw new Error(`Invalid native ${repair.label} repair file set.`);
	}
	const changes = patches.map((patch) => {
		if (!patch.oldFileName || !repair.files.has(patch.oldFileName) || patch.newFileName !== patch.oldFileName) {
			throw new Error(`Unsafe native ${repair.label} repair path.`);
		}
		const path = join(root, patch.oldFileName);
		if (realpathSync(path) !== path)
			throw new Error(`Unsafe native ${repair.label} repair path: ${patch.oldFileName}`);
		const original = readFileSync(path, "utf8");
		const repaired = applyPatch(original, patch, { fuzzFactor: 0 });
		if (repaired !== false) return { path, original, repaired };
		if (applyPatch(original, reversePatch(patch), { fuzzFactor: 0 }) !== false) {
			return { path, original, repaired: original };
		}
		throw new Error(`Native ${repair.label} repair does not match ${patch.oldFileName}; package left unchanged.`);
	});
	for (const { path, original, repaired } of changes) {
		if (repaired !== original) writeFileSync(path, repaired);
	}
}
