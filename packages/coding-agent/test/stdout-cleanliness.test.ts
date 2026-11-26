import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";

const cliPath = resolve(__dirname, "../src/cli.ts");

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-stdout-clean-"));
	tempDirs.push(dir);
	return dir;
}

async function runCli(
	args: string[],
	trustEnv: Record<string, string> = { OMK_TRUST_PROJECT: "1" },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	const tempRoot = createTempDir();
	const agentDir = join(tempRoot, "agent");
	const projectDir = join(tempRoot, "project");
	const projectConfigDir = join(projectDir, ".omk");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(projectConfigDir, { recursive: true });

	const fakeNpmPath = join(tempRoot, "fake-npm.mjs");
	writeFileSync(
		fakeNpmPath,
		[
			'console.log("changed 1 package in 471ms");',
			'console.log("found 0 vulnerabilities");',
			// Spec 053 (PR #124 M2): shows whether OMK_TRUST_PROJECT=1 leaked into this child process.
			'console.log("trust-env=" + (process.env.OMK_TRUST_PROJECT ?? "unset"));',
			"process.exit(0);",
		].join("\n"),
		"utf-8",
	);

	writeFileSync(
		join(projectConfigDir, "settings.json"),
		JSON.stringify(
			{
				packages: ["npm:fake-package"],
				npmCommand: [process.execPath, fakeNpmPath],
			},
			null,
			2,
		),
		"utf-8",
	);

	return await new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [cliPath, ...args], {
			cwd: projectDir,
			env: {
				...process.env,
				[ENV_AGENT_DIR]: agentDir,
				// The project's npmCommand/packages are gated (spec 053); this test opts in to see their output routed.
				OMK_TRUST_PROJECT: "",
				...trustEnv,
				TSX_TSCONFIG_PATH: resolve(__dirname, "../../../tsconfig.json"),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolvePromise({ stdout, stderr, code });
		});
	});
}

describe("stdout cleanliness in non-interactive modes", () => {
	it("keeps stdout empty for --mode json --help while routing startup chatter to stderr", async () => {
		const result = await runCli(["--mode", "json", "--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("changed 1 package in 471ms");
		expect(result.stderr).toContain("found 0 vulnerabilities");
		expect(result.stderr).toContain("Usage:");
	});

	it("keeps stdout empty for -p --help while routing startup chatter to stderr", async () => {
		const result = await runCli(["-p", "--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("changed 1 package in 471ms");
		expect(result.stderr).toContain("found 0 vulnerabilities");
		expect(result.stderr).toContain("Usage:");
	});

	it("does not run an untrusted project's npmCommand or install its packages (spec 053)", async () => {
		const result = await runCli(["-p", "--help"], {});

		expect(result.code).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toContain("changed 1 package in 471ms");
		expect(result.stderr).toContain("Usage:");
	});

	it("prints the OMK_TRUST_PROJECT=1 notice once on stderr, never on stdout (spec 053)", async () => {
		const result = await runCli(["-p", "--help"]);

		expect(result.stdout).toBe("");
		const notices = result.stderr
			.split("\n")
			.filter((line) => line.startsWith("omk: OMK_TRUST_PROJECT=1 trusts project code in "));
		expect(notices).toHaveLength(1);
	});

	it("does not pass OMK_TRUST_PROJECT=1 on to child processes such as the project's npm (PR #124 M2)", async () => {
		const result = await runCli(["-p", "--help"]);

		expect(result.stderr).toContain("changed 1 package in 471ms");
		expect(result.stderr).toContain("trust-env=unset");
		expect(result.stderr).not.toContain("trust-env=1");
	});

	it("prints --help in an untrusted project without launching the interactive trust TUI", async () => {
		const result = await runCli(["--help"], {});

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Usage:");
		expect(result.stdout).not.toContain("Trust this project");
		expect(result.stderr).not.toContain("changed 1 package in 471ms");
	});
});
