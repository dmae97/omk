import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function runCli(args: readonly string[]) {
	const home = mkdtempSync(join(tmpdir(), "omk-adaptorch-links-"));
	try {
		return spawnSync(
			process.execPath,
			["--import", "tsx", "packages/coding-agent/src/cli.ts", "doctor", "adaptorch", ...args],
			{
				cwd: root,
				encoding: "utf8",
				timeout: 20000,
				env: { PATH: process.env.PATH, HOME: home, OMK_OFFLINE: "1", OMK_SKIP_VERSION_CHECK: "1" },
			},
		);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("AdaptOrch links through the source CLI entrypoint", () => {
	it("prints signup and contact links without a configured account", () => {
		const result = runCli(["--links"]);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("https://adaptorch.com/app/signup?");
		expect(result.stdout).toContain("#bookDemo");
		expect(result.stdout).toContain("no account created");
	});

	it("emits only machine-readable offline JSON through main dispatch", () => {
		const result = runCli(["--links", "--json"]);
		expect(result.status, result.stderr).toBe(0);
		const report: unknown = JSON.parse(result.stdout);
		expect(report).toMatchObject({
			mode: "links",
			networkAccess: false,
			accountRequired: false,
			links: { plans: expect.stringContaining("#pricing") },
		});
	});

	it("exits with usage error instead of starting an agent for an unknown option", () => {
		const result = runCli(["--links", "--send"]);
		expect(result.status, result.stderr).toBe(2);
		expect(result.stdout).toContain("Unknown option: --send");
		expect(result.stdout).toContain("Usage:");
	});
});
