import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getAgentDbPath } from "$c/config";
import { SettingsManager } from "$c/config/settings-manager";
import { AgentStorage } from "$c/session/agent-storage";

describe("SettingsManager", () => {
	let testDir: string;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		// Use random UUID to isolate parallel test runs (SQLite files can't be shared)
		testDir = join(process.cwd(), "test-settings-tmp", crypto.randomUUID());
		agentDir = join(testDir, "agent");
		projectDir = join(testDir, "project");

		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	// Tests that SettingsManager merges with DB state on save rather than blindly overwriting.
	// This ensures external edits (via AgentStorage directly) aren't lost when the app saves.
	describe("preserves externally added settings", () => {
		it("should preserve enabledModels when changing thinking level", async () => {
			// Seed initial settings in DB
			const storage = AgentStorage.open(getAgentDbPath(agentDir));
			storage.saveSettings({
				theme: "dark",
				modelRoles: { default: "claude-sonnet" },
			});

			// Manager loads the initial state
			const manager = await SettingsManager.create(projectDir, agentDir);

			// Simulate external edit (e.g., user modifying DB directly or another process)
			storage.saveSettings({
				theme: "dark",
				modelRoles: { default: "claude-sonnet" },
				enabledModels: ["claude-opus-4-5", "gpt-5.2-codex"],
			});

			// Manager saves a change - should merge, not overwrite
			manager.setDefaultThinkingLevel("high");

			const savedSettings = storage.getSettings() ?? {};
			expect(savedSettings.enabledModels).toEqual(["claude-opus-4-5", "gpt-5.2-codex"]);
			expect(savedSettings.defaultThinkingLevel).toBe("high");
			expect(savedSettings.theme).toBe("dark");
			expect(savedSettings.modelRoles?.default).toBe("claude-sonnet");
		});

		it("should preserve custom settings when changing theme", async () => {
			const storage = AgentStorage.open(getAgentDbPath(agentDir));
			storage.saveSettings({
				modelRoles: { default: "claude-sonnet" },
			});

			const manager = await SettingsManager.create(projectDir, agentDir);

			storage.saveSettings({
				modelRoles: { default: "claude-sonnet" },
				shellPath: "/bin/zsh",
				extensions: ["/path/to/extension.ts"],
			});

			manager.setTheme("light");

			const savedSettings = storage.getSettings() ?? {};
			expect(savedSettings.shellPath).toBe("/bin/zsh");
			expect(savedSettings.extensions).toEqual(["/path/to/extension.ts"]);
			expect(savedSettings.theme).toBe("light");
		});

		it("should let in-memory changes override file changes for same key", async () => {
			const storage = AgentStorage.open(getAgentDbPath(agentDir));
			storage.saveSettings({
				theme: "dark",
			});

			const manager = await SettingsManager.create(projectDir, agentDir);

			storage.saveSettings({
				theme: "dark",
				defaultThinkingLevel: "low",
			});

			manager.setDefaultThinkingLevel("high");

			const savedSettings = storage.getSettings() ?? {};
			expect(savedSettings.defaultThinkingLevel).toBe("high");
		});
	});
});
