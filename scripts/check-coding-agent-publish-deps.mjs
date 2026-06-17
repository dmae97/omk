#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const packagePath = join(repoRoot, "packages/coding-agent/package.json");
const shrinkwrapPath = join(repoRoot, "packages/coding-agent/npm-shrinkwrap.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const deps = pkg.dependencies ?? {};
const expectedAliases = {
	"@earendil-works/omk-agent-core": "npm:@earendil-works/pi-agent-core@0.79.6",
	"@earendil-works/omk-ai": "npm:@earendil-works/pi-ai@0.79.6",
	"@earendil-works/omk-tui": "npm:@earendil-works/pi-tui@0.79.6",
};
const errors = [];

for (const [name, expected] of Object.entries(expectedAliases)) {
	if (deps[name] !== expected) {
		errors.push(`${name} must resolve through published package alias ${expected}; got ${deps[name] ?? "<missing>"}`);
	}
}

for (const [name, spec] of Object.entries(deps)) {
	if (name.startsWith("@earendil-works/omk-") && !String(spec).startsWith("npm:@earendil-works/pi-")) {
		errors.push(`${name} uses unpublished OMK-scoped dependency spec ${spec}`);
	}
}

if (existsSync(shrinkwrapPath)) {
	errors.push("packages/coding-agent/npm-shrinkwrap.json must not be published until OMK-scoped internal packages exist on npm");
}

if (errors.length > 0) {
	console.error(errors.map((error) => `- ${error}`).join("\n"));
	process.exit(1);
}

console.log("coding-agent publish dependencies resolve through published npm aliases.");
