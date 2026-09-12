import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const [file, jobName] of [["ci.yml", "build-check-test"], ["build-binaries.yml", "publish-npm"]]) {
	it(`${file} provides and probes the real sandbox before running tests`, () => {
		const source = readFileSync(join(root, ".github/workflows", file), "utf8");
		const job = source.split(/\n(?=  [a-z][a-z0-9-]*:\n)/).find(block => block.startsWith(`  ${jobName}:\n`));
		assert.ok(job, `${jobName} job must exist`);
		const steps = job.split(/^      - name: /m).slice(1);
		const install = steps.findIndex(step => step.startsWith("Install system dependencies\n"));
		const probe = steps.findIndex(step => step.startsWith("Verify sandbox backend\n"));
		const tests = steps.findIndex(step => step.startsWith("Test\n"));
		assert.ok(install >= 0);
		assert.match(steps[install], /apt-get install[\s\S]*\bbubblewrap\b/);
		assert.ok(probe > install && probe < tests, "sandbox preflight must precede the full suite");
		assert.match(steps[probe], /\/usr\/bin\/bwrap/);
		assert.match(steps[probe], /--unshare-all/);
		assert.match(steps[probe], /--cap-drop ALL/);
		assert.match(steps[probe], /--clearenv/);
		assert.doesNotMatch(steps[probe], /sysctl\s+-w|apparmor.*=0|sandbox=off/);
	});
}
