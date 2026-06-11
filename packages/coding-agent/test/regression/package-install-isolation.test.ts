import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager } from "../../src/core/package-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";

/**
 * Regression test for: one failing package install aborting the entire
 * startup/resource load (audit-confirmed.json finding #6).
 *
 * resolvePackageSources() must isolate per-package failures: a git source
 * that fails to install (deleted repo, typo'd URL, network down) or a pinned
 * npm package whose reinstall fails must not prevent the remaining packages
 * from resolving, and the failure must be reported as a warning that
 * includes the package source string.
 */
describe("package install failure isolation (regression)", () => {
	let tempDir: string;
	let agentDir: string;
	let settingsManager: SettingsManager;
	let packageManager: DefaultPackageManager;
	let previousOfflineEnv: string | undefined;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	const createPackageManager = (packages: string[]): DefaultPackageManager => {
		settingsManager = SettingsManager.inMemory({ packages });
		packageManager = new DefaultPackageManager({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		// Legacy global npm lookups shell out; keep the test hermetic.
		vi.spyOn(packageManager as never, "runCommandSync").mockImplementation(() => {
			throw new Error("legacy lookup unavailable");
		});
		return packageManager;
	};

	const writeNpmPackage = (name: string, version: string): string => {
		const packagePath = join(agentDir, "npm", "node_modules", name);
		mkdirSync(join(packagePath, "extensions"), { recursive: true });
		writeFileSync(join(packagePath, "package.json"), JSON.stringify({ name, version }));
		writeFileSync(join(packagePath, "extensions", "index.ts"), "export default function () {};");
		return packagePath;
	};

	const warningCalls = (): string[] => consoleErrorSpy.mock.calls.map((call) => call.map(String).join(" "));

	beforeEach(() => {
		previousOfflineEnv = process.env.PI_OFFLINE;
		delete process.env.PI_OFFLINE;
		tempDir = join(tmpdir(), `pm-isolation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		if (previousOfflineEnv === undefined) {
			delete process.env.PI_OFFLINE;
		} else {
			process.env.PI_OFFLINE = previousOfflineEnv;
		}
		vi.restoreAllMocks();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("a git source that fails to install does not prevent other packages from loading", async () => {
		const brokenSource = "git:github.com/broken/repo";
		const manager = createPackageManager([brokenSource, "npm:good-pkg"]);

		const goodPackagePath = join(agentDir, "npm", "node_modules", "good-pkg");
		const runCommandSpy = vi
			.spyOn(manager as never, "runCommand")
			.mockImplementation(async (...callArgs: unknown[]) => {
				const [command, args] = callArgs as [string, string[]];
				if (command === "git") {
					throw new Error("fatal: repository not found");
				}
				if (args[0] === "install" && args.includes("good-pkg")) {
					writeNpmPackage("good-pkg", "1.0.0");
					return;
				}
				throw new Error(`Unexpected runCommand: ${command} ${args.join(" ")}`);
			});

		// The broken git source comes first; resolve() must not reject and must
		// still install and load the npm package configured after it.
		const result = await manager.resolve();

		expect(
			result.extensions.some((r) => r.path === join(goodPackagePath, "extensions", "index.ts") && r.enabled),
		).toBe(true);
		// The git clone was attempted, then the loop continued to the npm install.
		expect(runCommandSpy.mock.calls.some(([command]) => command === "git")).toBe(true);
		expect(runCommandSpy.mock.calls.some(([, args]) => (args as string[]).includes("good-pkg"))).toBe(true);
		// The failure is reported as a warning that names the failing source.
		expect(warningCalls().some((line) => line.includes(brokenSource) && line.includes("repository not found"))).toBe(
			true,
		);
	});

	it("a pinned npm package whose reinstall fails falls back to the existing install", async () => {
		const pinnedSource = "npm:pinned-pkg@2.0.0";
		const manager = createPackageManager([pinnedSource]);

		// A working copy is already installed, but at a different version than pinned.
		const installedPath = writeNpmPackage("pinned-pkg", "1.0.0");
		vi.spyOn(manager as never, "runCommand").mockRejectedValue(new Error("registry unreachable"));

		const result = await manager.resolve();

		expect(result.extensions.some((r) => r.path === join(installedPath, "extensions", "index.ts") && r.enabled)).toBe(
			true,
		);
		expect(
			warningCalls().some((line) => line.includes(pinnedSource) && line.includes("using existing install")),
		).toBe(true);
	});

	it("resolve() does not reject even when every configured package fails", async () => {
		const brokenGit = "git:github.com/broken/repo";
		const brokenNpm = "npm:missing-pkg";
		const manager = createPackageManager([brokenGit, brokenNpm]);
		vi.spyOn(manager as never, "runCommand").mockRejectedValue(new Error("network down"));

		const result = await manager.resolve();

		expect(result.extensions.filter((r) => r.metadata.origin === "package")).toEqual([]);
		const warnings = warningCalls();
		expect(warnings.some((line) => line.includes(brokenGit))).toBe(true);
		expect(warnings.some((line) => line.includes(brokenNpm))).toBe(true);
	});
});
