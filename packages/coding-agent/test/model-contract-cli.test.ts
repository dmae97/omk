import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const directories: string[] = [];
afterEach(() => {
	for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function invoke(args: string[]) {
	const directory = mkdtempSync(join(tmpdir(), "omk-contract-cli-"));
	directories.push(directory);
	writeFileSync(join(directory, "invalid.json"), "{fixture-private-invalid-json");
	return spawnSync(
		process.execPath,
		[
			join(root, "node_modules/tsx/dist/cli.mjs"),
			"--tsconfig",
			join(root, "tsconfig.json"),
			join(root, "packages/coding-agent/src/cli.ts"),
			"--offline",
			...args,
		],
		{
			cwd: directory,
			encoding: "utf8",
			timeout: 20000,
			env: {
				PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
				HOME: directory,
				OMK_CODING_AGENT_DIR: resolve(directory, "agent"),
				OMK_OFFLINE: "1",
				CI: "true",
				NO_COLOR: "1",
				OMK_TELEMETRY: "0",
			},
		},
	);
}

describe("offline CLI model contract rejection", () => {
	it.each(["missing.json", "invalid.json"])("rejects %s without starting a provider", (path) => {
		const result = invoke(["--model-contract", path, "--print", "fixture"]);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("--model-contract requires");
		expect(result.stderr).not.toContain("fixture-private-invalid-json");
		expect(result.stdout).not.toContain("provider_request");
	});
});
