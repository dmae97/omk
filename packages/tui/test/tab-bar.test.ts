import { describe, expect, it } from "bun:test";
import { TabBar, type TabBarTheme } from "@oh-my-pi/pi-tui/components/tab-bar";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";

const ansiTheme: TabBarTheme = {
	label: text => text,
	activeTab: text => `\x1b[30;46m${text}\x1b[0m`,
	inactiveTab: text => `\x1b[37m${text}\x1b[0m`,
	hint: text => text,
};

describe("TabBar", () => {
	it("wraps without producing style-only lines or duplicate active highlights", () => {
		const tabs = [
			{ id: "display", label: "Display" },
			{ id: "agent", label: "Agent" },
			{ id: "input", label: "Input" },
			{ id: "tools", label: "Tools" },
			{ id: "config", label: "Config" },
			{ id: "services", label: "Services" },
			{ id: "bash", label: "Bash" },
			{ id: "lsp", label: "LSP" },
			{ id: "ttsr", label: "TTSR" },
			{ id: "plugins", label: "Plugins" },
		];
		const tabBar = new TabBar("Settings", tabs, ansiTheme, 8);

		const lines = tabBar.render(55);
		expect(lines.length > 1).toBeTruthy();

		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(55);
			expect(visibleWidth(line)).toBeGreaterThan(0);
			expect(/^\x1b\[[0-9;]*m+$/.test(line)).toBe(false);
		}

		const rendered = lines.join("\n");
		const activeHighlights = rendered.match(/\x1b\[30;46m/g) ?? [];
		expect(activeHighlights.length).toBe(1);
	});
});
