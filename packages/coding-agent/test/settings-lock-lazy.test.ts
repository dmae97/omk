import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("settings proper-lockfile lazy load", () => {
	afterEach(async () => {
		const { resetSettingsLockfileForTest } = await import("../src/core/settings-lock.ts");
		resetSettingsLockfileForTest();
		vi.resetModules();
	});

	it("does not load proper-lockfile on SettingsManager.inMemory/read", async () => {
		const { SettingsManager } = await import("../src/core/settings-manager.ts");
		const { isSettingsLockfileLoaded } = await import("../src/core/settings-lock.ts");
		expect(isSettingsLockfileLoaded()).toBe(false);

		const mgr = SettingsManager.inMemory({ theme: "dark" });
		expect(mgr.getTheme()).toBe("dark");
		expect(isSettingsLockfileLoaded()).toBe(false);
	});

	it("loads proper-lockfile on first acquireSettingsLockSyncWithRetry", async () => {
		const { acquireSettingsLockSyncWithRetry, isSettingsLockfileLoaded, resetSettingsLockfileForTest } = await import(
			"../src/core/settings-lock.ts"
		);
		resetSettingsLockfileForTest();
		expect(isSettingsLockfileLoaded()).toBe(false);

		const path = join(tmpdir(), `omk-settings-lockfile-${Date.now()}.json`);
		writeFileSync(path, "{}\n");
		const release = acquireSettingsLockSyncWithRetry(path);
		expect(isSettingsLockfileLoaded()).toBe(true);
		release();
	});

	it("settings-manager imports the lock helper instead of proper-lockfile", async () => {
		const { readFileSync } = await import("node:fs");
		const { fileURLToPath } = await import("node:url");
		const src = readFileSync(fileURLToPath(new URL("../src/core/settings-manager.ts", import.meta.url)), "utf8");
		expect(src).toContain('from "./settings-lock.ts"');
		expect(src).not.toMatch(/from ["']proper-lockfile["']/);
	});
});
