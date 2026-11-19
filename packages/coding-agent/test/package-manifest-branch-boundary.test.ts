import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("native automatic manifest branch independence", () => {
	let tempDir: string;
	const wrapper = "agent/extensions/wrapper";

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "omk-manifest-branch-"));
		vi.stubEnv("HOME", tempDir);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	function write(relativePath: string, contents: string): string {
		const path = join(tempDir, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents);
		return path;
	}

	function manager(packageManifestDialect?: "omk" | "omk+pi") {
		const cwd = join(tempDir, "project");
		const agentDir = join(tempDir, "agent");
		mkdirSync(join(cwd, ".git"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		return new DefaultPackageManager({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			...(packageManifestDialect === undefined ? {} : { packageManifestDialect }),
		});
	}

	it.each([false, true])("retains an independently allowed shared branch (direct first: %s)", async (directFirst) => {
		const root = join(tempDir, wrapper);
		const entries = directFirst ? ["./left/shared", "./left"] : ["./left", "./left/shared"];
		write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: entries } }));
		write(`${wrapper}/left/package.json`, JSON.stringify({ omk: { extensions: ["./shared", "!shared/**"] } }));
		write(`${wrapper}/left/shared/package.json`, JSON.stringify({ omk: { extensions: ["./native.ts"] } }));
		const nativePath = write(`${wrapper}/left/shared/native.ts`, "export default function() {}");
		const managed = await manager("omk").resolveExtensionSources([root]);
		expect(managed.extensions.map((r) => r.path)).toEqual([nativePath]);
		const compatible = await manager("omk+pi").resolve();
		expect(compatible.extensions.map((r) => r.path)).toEqual(entries.map((entry) => join(root, entry)));
		expect(await manager().resolve()).toEqual(await manager("omk").resolve());
		expect((await manager("omk").resolve()).extensions.map((r) => r.path)).toEqual([nativePath]);
	});

	it.each([false, true])("retains a short route after depth truncation (direct first: %s)", async (directFirst) => {
		let deep = `${wrapper}/deep`;
		for (let level = 0; level < 61; level++) {
			write(`${deep}/package.json`, JSON.stringify({ omk: { extensions: ["./next"] } }));
			deep += "/next";
		}
		write(`${deep}/package.json`, JSON.stringify({ omk: { extensions: ["./shared"] } }));
		const shared = `${deep}/shared`;
		write(`${shared}/package.json`, JSON.stringify({ omk: { extensions: ["./child"] } }));
		write(`${shared}/child/package.json`, JSON.stringify({ omk: { extensions: ["./native.ts"] } }));
		const nativePath = write(`${shared}/child/native.ts`, "export default function() {}");
		write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: ["./deep"] } }));
		expect((await manager("omk").resolve()).extensions).toEqual([]);
		const direct = `./${shared.slice(wrapper.length + 1)}`;
		const entries = directFirst ? [direct, "./deep"] : ["./deep", direct];
		write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: entries } }));
		const root = join(tempDir, wrapper);
		const managed = await manager("omk").resolveExtensionSources([root]);
		expect(managed.extensions.map((r) => r.path)).toEqual([nativePath]);
		const compatible = await manager("omk+pi").resolve();
		expect(compatible.extensions.map((r) => r.path)).toEqual(entries.map((entry) => join(root, entry)));
		expect(await manager().resolve()).toEqual(await manager("omk").resolve());
		expect((await manager("omk").resolve()).extensions.map((r) => r.path)).toEqual([nativePath]);
	});
});
