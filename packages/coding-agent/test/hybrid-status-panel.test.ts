import { visibleWidth } from "omk-tui";
import { expect, it, vi } from "vitest";
import { HybridStatusPanel } from "../src/modes/interactive/hybrid-status-panel.ts";
import type { StatusPanelModel } from "../src/modes/interactive/status-panel-model.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

it.skipIf(Number(process.versions.node.split(".")[0]) < 26)(
	"swaps an actual OpenTUI framebuffer into the omk-tui component and drains it",
	async () => {
		let expanded = false;
		const model: StatusPanelModel = {
			model: "hybrid-model",
			provider: "test / high",
			path: "~/작업",
			expanded,
			rows: [{ label: "Run", value: "idle", color: "#ede6d6" }],
			context: { percent: null, caption: "unknown", color: "#b7af9f" },
			usage: { label: "Usage", windows: [], message: "unavailable" },
			sections: [],
			system: {
				cpuPercent: null,
				memoryPercent: null,
				memoryCaption: "unavailable",
				cpuColor: "#b7af9f",
				memoryColor: "#b7af9f",
			},
			palette: {
				text: "#ede6d6",
				muted: "#b7af9f",
				accent: "#e8564c",
				border: "#504b42",
				background: "#141414",
				surface: "#1c1b19",
			},
			hint: "ctrl+o details",
		};
		const repaint = vi.fn();
		const panel = new HybridStatusPanel(
			(details) => {
				expanded = details;
				return { ...model, expanded: details };
			},
			{ render: () => ["native fallback"], invalidate() {} },
			() => 30,
			repaint,
		);
		try {
			expect(panel.render(38)).toEqual(["native fallback"]);
			panel.invalidate();
			expect(panel.render(38)).toEqual(["native fallback"]);
			await vi.waitFor(() => expect(repaint).toHaveBeenCalled(), { timeout: 10000 });
			const output = panel.render(38);
			expect(output.map(stripAnsi).join("\n")).toContain("hybrid-model");
			expect(output.every((line) => visibleWidth(line) <= 38)).toBe(true);
			panel.setExpanded(true);
			panel.render(38);
			expect(expanded).toBe(true);
			repaint.mockClear();
			Object.assign(model, { palette: null });
			await vi.waitFor(
				() => {
					panel.render(38);
					expect(panel.render(38)).toEqual(["native fallback"]);
				},
				{ timeout: 10000 },
			);
			await panel.waitForClose();
		} finally {
			panel.dispose();
			await panel.waitForClose();
		}
		expect(panel.render(38)).toEqual(["native fallback"]);
	},
	15000,
);

it("preserves the native rail when model projection fails", async () => {
	const fallback = { render: () => ["native status"], invalidate() {} };
	const panel = new HybridStatusPanel(
		() => {
			throw new Error("missing model");
		},
		fallback,
		() => 30,
		() => {},
	);
	expect(panel.render(38)).toEqual(["native status"]);
	panel.dispose();
	await panel.waitForClose();
});
