#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const packagePath = join(repoRoot, "packages/coding-agent/package.json");
const internalPackageDirs = new Map([
	["@earendil-works/omk-agent-core", "packages/agent"],
	["@earendil-works/omk-ai", "packages/ai"],
	["@earendil-works/omk-tui", "packages/tui"],
]);
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const deps = pkg.dependencies ?? {};
const errors = [];

for (const [name, dir] of internalPackageDirs) {
	const internalPkg = JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
	const expected = `^${internalPkg.version}`;
	if (deps[name] !== expected) {
		errors.push(`${name} must use OMK-scoped lockstep dependency ${expected}; got ${deps[name] ?? "<missing>"}`);
	}
}

for (const [name, spec] of Object.entries(deps)) {
	if (name.startsWith("@earendil-works/omk-") && String(spec).startsWith("npm:@earendil-works/pi-")) {
		errors.push(`${name} still resolves through legacy package alias ${spec}`);
	}
}

if (errors.length > 0) {
	console.error(errors.map((error) => `- ${error}`).join("\n"));
	process.exit(1);
}

console.log("coding-agent publish dependencies use OMK-scoped internal packages.");
