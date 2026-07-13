import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../../..");
const runtimeCheck = resolve(projectRoot, ".omk/skills/omk-computeruse/scripts/check-runtime.mjs");

describe("omk-computeruse runtime inventory", () => {
	it("detects the project-local Stagehand extension", () => {
		// Given
		const result = spawnSync(process.execPath, [runtimeCheck, "--json"], {
			cwd: projectRoot,
			encoding: "utf8",
		});

		// When
		assert.equal(result.status, 0, result.stderr);
		const report = JSON.parse(result.stdout);

		// Then
		assert.equal(report.runtimes.stagehandCore.installedInProjectExtension, true);
	});
});
