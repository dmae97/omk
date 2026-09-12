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
		assert.match(job, /^    runs-on: ubuntu-22\.04$/m, "use the pinned namespace-capable runner image");
		const steps = job.split(/^      - name: /m).slice(1);
		const install = steps.findIndex(step => step.startsWith("Install system dependencies\n"));
		const probe = steps.findIndex(step => step.startsWith("Verify sandbox backend\n"));
		const fd = steps.findIndex(step => step.startsWith("Install pinned fd\n"));
		const tests = steps.findIndex(step => step.startsWith("Test\n"));
		assert.ok(install >= 0);
		assert.match(steps[install], /apt-get install[\s\S]*\bbubblewrap\b/);
		assert.ok(probe > install && probe < tests, "sandbox preflight must precede the full suite");
		assert.ok(fd > install && fd < tests, "install a compatible fd before the suite");
		assert.match(steps[fd], /fd-v10\.4\.2-x86_64-unknown-linux-musl/);
		assert.match(steps[fd], /e3257d48e29a6be965187dbd24ce9af564e0fe67b3e73c9bdcd180f4ec11bdde/);
		assert.ok(steps[fd].indexOf("sha256sum --check") < steps[fd].indexOf("tar -xzf"));
		assert.match(steps[fd], /--no-require-git/);
		assert.match(steps[probe], /\/usr\/bin\/bwrap/);
		assert.match(steps[probe], /--unshare-all/);
		assert.match(steps[probe], /--cap-drop ALL/);
		assert.match(steps[probe], /--clearenv/);
		assert.doesNotMatch(steps[probe], /sysctl\s+-w|apparmor.*=0|sandbox=off/);
	});
}
