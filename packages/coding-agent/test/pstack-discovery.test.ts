import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const vitestCli = fileURLToPath(new URL("../../../node_modules/vitest/dist/cli.js", import.meta.url));

describe("pstack vendor test discovery", () => {
	it("excludes upstream suites while keeping OMK integration suites", () => {
		const result = spawnSync(process.execPath, [vitestCli, "list", "--filesOnly"], {
			cwd: packageDir,
			encoding: "utf8",
			timeout: 20_000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		const files = result.stdout
			.trim()
			.split(/\r?\n/)
			.map((path) => path.replaceAll("\\", "/"));
		expect(files.some((path) => path.startsWith("resources/pstack/"))).toBe(false);
		for (const expected of [
			"test/init-cli.test.ts",
			"test/pstack-install.test.ts",
			"examples/extensions/subagent/subagent-extension-smoke.test.ts",
		])
			expect(files).toContain(expected);
	});
});
