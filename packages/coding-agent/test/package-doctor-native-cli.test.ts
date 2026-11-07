import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPackageDoctorCli } from "../src/commands/package-doctor-cli.ts";
import type { PackageDoctorResult } from "../src/core/package-doctor.ts";
import type { PackageInspection } from "../src/core/package-manager.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
let root: string;
let source: string;
let agentDir: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-doctor-target-cli-"));
	source = join(root, "source");
	agentDir = join(root, "agent");
	mkdirSync(source);
	mkdirSync(agentDir);
	writeFileSync(
		join(source, "package.json"),
		JSON.stringify({ name: "legacy-inspection", pi: { extensions: ["./entry.ts"] } }),
	);
	writeFileSync(
		join(source, "entry.ts"),
		`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(source, "executed"))}, "bad"); import "@earendil-works/pi-ai"; export default () => {};`,
	);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function inspection(): PackageInspection {
	return {
		packageRoot: source,
		resources: {
			extensions: [
				{
					path: join(source, "entry.ts"),
					enabled: true,
					metadata: { source, scope: "temporary", origin: "package" },
				},
			],
			skills: [],
			prompts: [],
			themes: [],
		},
	};
}

function actualCli(flags: string[], trusted = true) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			resolve(packageRoot, "../../node_modules/tsx/dist/loader.mjs"),
			join(packageRoot, "src/cli.ts"),
			"package",
			"doctor",
			...flags,
		],
		{
			cwd: source,
			env: {
				PATH: process.env.PATH,
				HOME: root,
				OMK_CODING_AGENT_DIR: agentDir,
				OMK_PACKAGE_DIR: packageRoot,
				OMK_OFFLINE: "1",
				...(trusted ? { OMK_TRUST_PROJECT: "1" } : {}),
				NO_COLOR: "1",
				TSX_TSCONFIG_PATH: resolve(packageRoot, "../../tsconfig.json"),
			},
			encoding: "utf8",
			timeout: 30_000,
		},
	);
}

describe("package doctor target selection", () => {
	it.each([
		["--package-manifest-dialect", "omk", "./fixture"],
		["./fixture", "--package-manifest-dialect=omk"],
	])("selects native independently of main argument parsing %j", async (...flags) => {
		const lines: string[] = [];
		const cleanup = vi.fn();
		const prepare = vi.fn(async () => ({ ...inspection(), cleanup }));
		const outcome = await runPackageDoctorCli(["package", "doctor", ...flags], {
			prepare,
			writeLine: (line) => lines.push(line),
		});
		expect(outcome).toEqual({ handled: true, exitCode: 1 });
		expect(prepare).toHaveBeenCalledWith("./fixture");
		expect(JSON.parse(lines.join("\n"))).toMatchObject({
			schemaVersion: 1,
			compatible: false,
			manifest: { selected: "pi" },
		});
		expect(cleanup).toHaveBeenCalledOnce();
		expect(existsSync(join(source, "executed"))).toBe(false);
	});

	it.each([
		["./fixture", "--package-manifest-dialect"],
		["--package-manifest-dialect="],
		["./fixture", "--package-manifest-dialect", "native"],
		["./fixture", "--package-manifest-dialect=omk", "--package-manifest-dialect=omk+pi"],
		["--package-manifest-dialect=bad", "--package-manifest-dialect=omk", "./fixture"],
		["--package-manifest-dialect=omk"],
		["./fixture", "./other"],
	])("rejects invalid selection before preparation %j", async (...flags) => {
		const lines: string[] = [];
		const prepare = vi.fn(async () => inspection());
		expect(
			await runPackageDoctorCli(["package", "doctor", ...flags], { prepare, writeLine: (line) => lines.push(line) }),
		).toEqual({ handled: true, exitCode: 2 });
		expect(prepare).not.toHaveBeenCalled();
		expect(JSON.parse(lines.join("\n"))).toMatchObject({ error: { code: "cli-usage" } });
	});

	it("preserves omission JSON and cleanup with explicit compatibility", async () => {
		const outputs: string[] = [];
		for (const flags of [[source], ["--package-manifest-dialect", "omk+pi", source]]) {
			const lines: string[] = [];
			const cleanup = vi.fn();
			expect(
				(
					await runPackageDoctorCli(["package", "doctor", ...flags], {
						prepare: async () => ({ ...inspection(), cleanup }),
						writeLine: (line) => lines.push(line),
					})
				).exitCode,
			).toBe(0);
			expect(cleanup).toHaveBeenCalledOnce();
			outputs.push(lines.join("\n"));
		}
		expect(outputs[1]).toBe(outputs[0]);
	});

	it("cleans prepared sources when scanning fails", async () => {
		const cleanup = vi.fn();
		const outcome = await runPackageDoctorCli(["package", "doctor", source, "--package-manifest-dialect=omk"], {
			prepare: async () => ({ ...inspection(), packageRoot: join(source, "missing"), cleanup }),
			writeLine: () => undefined,
		});
		expect(outcome.exitCode).toBe(1);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it.each([["--package-manifest-dialect", "omk"], ["--package-manifest-dialect=omk"]])(
		"runs the actual local static CLI for %j without executing or rewriting originals",
		(...flags) => {
			const original = ["package.json", "entry.ts"].map((file) => readFileSync(join(source, file)));
			const result = actualCli([source, ...flags]);
			expect(result.error).toBeUndefined();
			expect(result.status).toBe(1);
			const report = JSON.parse(result.stdout) as PackageDoctorResult;
			expect(report.manifest.diagnostics).toContainEqual({
				path: "pi",
				message: expect.stringContaining("Pi-only"),
			});
			expect(report.inspectedFiles).toEqual(["entry.ts"]);
			expect(report.checks.find(({ id }) => id === "runtime-imports")?.status).toBe("error");
			expect(["package.json", "entry.ts"].map((file) => readFileSync(join(source, file)))).toEqual(original);
			expect(existsSync(join(source, "executed"))).toBe(false);
		},
	);

	it("keeps actual omission and explicit compatibility JSON identical", () => {
		const omitted = actualCli([source]);
		const explicit = actualCli(["--package-manifest-dialect=omk+pi", source]);
		expect(omitted.error).toBeUndefined();
		expect(explicit.error).toBeUndefined();
		expect([omitted.status, explicit.status]).toEqual([0, 0]);
		expect(explicit.stdout).toBe(omitted.stdout);
		expect(existsSync(join(source, "executed"))).toBe(false);
	});
});
