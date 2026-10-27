import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = readFileSync(join(root, ".github", "workflows", "build-binaries.yml"), "utf8");

it("the build job writes a release manifest and checksums", () => {
	assert.match(workflow, /\.omk-release-tooling\/scripts\/release-manifest\.mjs/);
	assert.match(workflow, /--write/);
	assert.match(workflow, /release-manifest\.json/);
});

it("the release job reconciles instead of skipping an existing release", () => {
	assert.match(workflow, /\.omk-release-tooling\/scripts\/reconcile-release\.mjs/);
	assert.match(workflow, /--apply/);
	assert.doesNotMatch(workflow, /skipping binary upload/);
});

it("the release job checks out workflow tooling before reconciliation", () => {
	const releaseJob = workflow.split("  release:")[1]?.split("  publish-npm:")[0] ?? "";
	assert.match(releaseJob, /actions\/checkout@/);
	assert.match(releaseJob, /path: \.omk-release-tooling/);
	assert.match(releaseJob, /ref: \$\{\{ github\.ref_name \}\}/);
});

it("the bundle artifact includes the manifest and checksum file", () => {
	assert.match(workflow, /path: packages\/coding-agent\/binaries\//);
	assert.match(workflow, /SHA256SUMS/);
});
