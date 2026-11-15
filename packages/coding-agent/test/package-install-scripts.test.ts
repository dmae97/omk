/**
 * Spec 053 R1-R3: package lifecycle scripts are off unless the user passes --allow-scripts
 * to an explicit `omk install` / `omk update`, and failures that look like a skipped install
 * script name that option.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import {
	ALLOW_SCRIPTS_FLAG,
	formatAllowScriptsHint,
	looksLikeSkippedInstallScript,
	withAllowScriptsHint,
} from "../src/core/package-install-args.ts";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { handlePackageCommand } from "../src/package-manager-cli.ts";

type RunCommand = (command: string, args: string[], options?: { cwd?: string }) => Promise<void>;

function spyRunCommand(manager: DefaultPackageManager, onCall?: (command: string, args: string[]) => void) {
	return vi
		.spyOn(manager as unknown as { runCommand: RunCommand }, "runCommand")
		.mockImplementation(async (command, args) => {
			onCall?.(command, args);
		});
}

describe("package install scripts (spec 053)", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `omk-install-scripts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("skips npm lifecycle scripts by default on omk install", async () => {
		const manager = new DefaultPackageManager({
			cwd: tempDir,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
		});
		const spy = spyRunCommand(manager);
		await manager.install("npm:some-pkg");
		expect(spy).toHaveBeenCalledWith(
			"npm",
			["install", "some-pkg", "--prefix", join(agentDir, "npm"), "--legacy-peer-deps", "--ignore-scripts"],
			undefined,
		);
	});

	it("runs npm lifecycle scripts only with allowScripts", async () => {
		const manager = new DefaultPackageManager({
			cwd: tempDir,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			allowScripts: true,
		});
		const spy = spyRunCommand(manager);
		await manager.install("npm:some-pkg");
		const [, args] = spy.mock.calls[0] as [string, string[]];
		expect(args).not.toContain("--ignore-scripts");
	});

	it("skips scripts when installing a git package's dependencies, unless allowed", async () => {
		const targetDir = join(agentDir, "git", "github.com", "user", "repo");
		const fakeClone = (command: string, args: string[]) => {
			if (command === "git" && args[0] === "clone") {
				mkdirSync(targetDir, { recursive: true });
				writeFileSync(join(targetDir, "package.json"), JSON.stringify({ name: "repo", version: "1.0.0" }));
			}
		};
		const denied = new DefaultPackageManager({ cwd: tempDir, agentDir, settingsManager: SettingsManager.inMemory() });
		const deniedSpy = spyRunCommand(denied, fakeClone);
		await denied.install("git:github.com/user/repo");
		expect(deniedSpy).toHaveBeenCalledWith("npm", ["install", "--omit=dev", "--ignore-scripts"], { cwd: targetDir });

		rmSync(targetDir, { recursive: true, force: true });
		const allowed = new DefaultPackageManager({
			cwd: tempDir,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			allowScripts: true,
		});
		const allowedSpy = spyRunCommand(allowed, fakeClone);
		await allowed.install("git:github.com/user/repo");
		expect(allowedSpy).toHaveBeenCalledWith("npm", ["install", "--omit=dev"], { cwd: targetDir });
	});

	it("never runs scripts for packages installed on their own at startup (missing project package)", async () => {
		const settingsManager = SettingsManager.inMemory();
		settingsManager.setProjectPackages(["npm:auto-pkg"]);
		const manager = new DefaultPackageManager({ cwd: tempDir, agentDir, settingsManager });
		const installArgs: string[][] = [];
		spyRunCommand(manager, (_command, args) => {
			if (args[0] === "install") installArgs.push(args);
		});
		await manager.resolve();
		expect(installArgs).toHaveLength(1);
		expect(installArgs[0]).toContain("--ignore-scripts");
	});

	it("recognises the failures a skipped install script leaves behind", () => {
		expect(looksLikeSkippedInstallScript("Error: Could not locate the bindings file. Tried: ...")).toBe(true);
		expect(looksLikeSkippedInstallScript("Error: No native build was found for platform=linux")).toBe(true);
		expect(looksLikeSkippedInstallScript("Cannot find module './build/Release/addon.node'")).toBe(true);
		expect(looksLikeSkippedInstallScript("TypeError: x is not a function")).toBe(false);
	});

	it("names --allow-scripts in the hint and only appends it to matching failures", () => {
		expect(formatAllowScriptsHint("npm:native-pkg")).toContain(`omk install ${ALLOW_SCRIPTS_FLAG} npm:native-pkg`);
		expect(formatAllowScriptsHint(undefined, "update")).toContain(`omk update ${ALLOW_SCRIPTS_FLAG}`);
		const hinted = withAllowScriptsHint('Failed to load extension "x": Could not locate the bindings file');
		expect(hinted).toContain(ALLOW_SCRIPTS_FLAG);
		expect(withAllowScriptsHint('Failed to load extension "x": SyntaxError')).not.toContain(ALLOW_SCRIPTS_FLAG);
	});

	it.each([
		"/tmp/old-install/node_modules/legacy-host/dist/core/extensions/builtin/diff.js",
		"../../npm/node_modules/shell-package/dist/index.ts",
		"./dist/index.js",
		"./lib/client.js",
		"./build/main.js",
	])("does not suggest running install scripts for a missing JS/TS module: %s", (path) => {
		const message = `Failed to load extension: Cannot find module '${path}'`;
		expect(looksLikeSkippedInstallScript(message)).toBe(false);
		expect(withAllowScriptsHint(message)).toBe(message);
	});
});

describe("omk install --allow-scripts (CLI)", () => {
	let tempDir: string;
	let originalCwd: string;
	let originalAgentDir: string | undefined;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		tempDir = join(tmpdir(), `omk-install-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(tempDir, "agent"), { recursive: true });
		mkdirSync(join(tempDir, "project"), { recursive: true });
		originalCwd = process.cwd();
		originalAgentDir = process.env[ENV_AGENT_DIR];
		originalExitCode = process.exitCode;
		process.env[ENV_AGENT_DIR] = join(tempDir, "agent");
		process.chdir(join(tempDir, "project"));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.chdir(originalCwd);
		process.exitCode = originalExitCode;
		if (originalAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = originalAgentDir;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("passes --allow-scripts through to the npm install", async () => {
		const calls: string[][] = [];
		vi.spyOn(
			DefaultPackageManager.prototype as unknown as { runCommand: RunCommand },
			"runCommand",
		).mockImplementation(async (_command, args) => {
			calls.push(args);
		});
		vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await handlePackageCommand(["install", "npm:native-pkg", ALLOW_SCRIPTS_FLAG])).toBe(true);
		expect(calls[0]).toContain("native-pkg");
		expect(calls[0]).not.toContain("--ignore-scripts");
	});

	it("names --allow-scripts when an install without it fails like a skipped install script", async () => {
		vi.spyOn(DefaultPackageManager.prototype, "installAndPersist").mockRejectedValue(
			new Error("Error: Could not locate the bindings file. Tried: build/Release/addon.node"),
		);
		vi.spyOn(console, "log").mockImplementation(() => {});
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		});
		expect(await handlePackageCommand(["install", "npm:native-pkg"])).toBe(true);
		expect(process.exitCode).toBe(1);
		expect(errors.join("\n")).toContain(`omk install ${ALLOW_SCRIPTS_FLAG} npm:native-pkg`);
	});

	it("does not suggest --allow-scripts for unrelated install failures (PR #124 review B1)", async () => {
		vi.spyOn(DefaultPackageManager.prototype, "installAndPersist").mockRejectedValue(new Error("npm ERR! 404"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		});
		expect(await handlePackageCommand(["install", "npm:missing-pkg"])).toBe(true);
		expect(process.exitCode).toBe(1);
		expect(errors.join("\n")).not.toContain(ALLOW_SCRIPTS_FLAG);
	});

	it("rejects --allow-scripts on commands that install nothing", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		});
		expect(await handlePackageCommand(["list", ALLOW_SCRIPTS_FLAG])).toBe(true);
		expect(errors.join("\n")).toContain(`Unknown option ${ALLOW_SCRIPTS_FLAG}`);
	});
});
