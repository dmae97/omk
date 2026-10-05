import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

const loads = vi.hoisted(() => ({ packageManager: 0 }));

vi.mock("../src/core/package-manager.ts", async (importOriginal) => {
	loads.packageManager++;
	return importOriginal();
});

describe("resource-loader lazy package-manager", () => {
	afterEach(() => {
		loads.packageManager = 0;
		vi.resetModules();
	});

	it("does not evaluate package-manager until loadResourcePackageManager runs", async () => {
		const { loadResourcePackageManager } = await import("../src/core/resource-loader-package-manager.ts");
		expect(loads.packageManager).toBe(0);

		const settingsManager = SettingsManager.inMemory({});
		const pm = await loadResourcePackageManager(undefined, {
			cwd: "/tmp",
			agentDir: "/tmp",
			settingsManager,
		});
		expect(loads.packageManager).toBe(1);
		const again = await loadResourcePackageManager(pm, {
			cwd: "/tmp",
			agentDir: "/tmp",
			settingsManager,
		});
		expect(again).toBe(pm);
		expect(loads.packageManager).toBe(1);
	});

	it("resource-loader keeps a type-only package-manager import", async () => {
		const { readFileSync } = await import("node:fs");
		const { fileURLToPath } = await import("node:url");
		const src = readFileSync(fileURLToPath(new URL("../src/core/resource-loader.ts", import.meta.url)), "utf8");
		expect(src).toMatch(/import type \{[^}]*DefaultPackageManager[^}]*\} from "\.\/package-manager\.ts"/);
		expect(src).not.toMatch(/import \{ DefaultPackageManager/);
		expect(src).toContain("resolveResourcePackagePaths");
	});
});
