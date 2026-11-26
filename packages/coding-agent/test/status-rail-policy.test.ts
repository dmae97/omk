import { afterEach, expect, it, vi } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { railVisibility } from "../src/modes/interactive/layout-class.ts";

afterEach(() => vi.unstubAllEnvs());
it("unpins the right rail by default while keeping explicit opt-ins and owner precedence", () => {
	vi.stubEnv("OMK_PIN_STATUS_SIDEBAR", undefined);
	expect(SettingsManager.inMemory().getPinStatusSidebar()).toBe(false);
	expect(SettingsManager.inMemory({ pinStatusSidebar: true }).getPinStatusSidebar()).toBe(true);
	vi.stubEnv("OMK_PIN_STATUS_SIDEBAR", "1");
	expect(SettingsManager.inMemory().getPinStatusSidebar()).toBe(true);
	vi.stubEnv("OMK_PIN_STATUS_SIDEBAR", "0");
	expect(SettingsManager.inMemory().getPinStatusSidebar()).toBe(false);
	expect(railVisibility(true, false, false, 160, 40)).toBe("visible");
	expect(railVisibility(true, false, false, 120, 16)).toBe("visible");
	expect(railVisibility(true, false, false, 80, 24)).toBe("terminal-too-small");
	expect(railVisibility(true, true, false, 160, 40)).toBe("custom-footer");
	expect(railVisibility(true, false, true, 160, 40)).toBe("tmux-owner");
	expect(railVisibility(false, false, false, 160, 40)).toBe("unpinned");
});
