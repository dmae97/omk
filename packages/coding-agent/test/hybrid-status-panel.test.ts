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
			expect(panel.renderState).toBe("opentui-frame");
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
	expect(panel.renderState).toBe("render-error");
	panel.dispose();
	await panel.waitForClose();
});

it.skipIf(Number(process.versions.node.split(".")[0]) < 26)(
	"does not serialize footer models while the worker already has a frame in flight",
	async () => {
		let serializations = 0;
		const model = { text: "#ede6d6", lines: [{ left: [{ text: "fixture" }], right: [] }] };
		const panel = new HybridStatusPanel(
			() => ({
				...model,
				toJSON() {
					serializations++;
					return model;
				},
			}),
			{ render: () => ["native footer"], invalidate() {} },
			() => 30,
			() => {},
			{ kind: "footer", height: (current) => current.lines.length },
		);
		try {
			panel.render(72);
			const initial = serializations;
			expect(initial).toBeGreaterThan(0);
			for (let i = 0; i < 200; i++) panel.render(72);
			expect(serializations - initial).toBe(0);
		} finally {
			panel.dispose();
			await panel.waitForClose();
		}
	},
);
it.skipIf(Number(process.versions.node.split(".")[0]) < 26)(
	"swaps a footer surface to an OpenTUI frame sized by the model's rows",
	async () => {
		const repaint = vi.fn();
		const widths: number[] = [];
		const panel = new HybridStatusPanel(
			(_expanded, width) => {
				widths.push(width);
				return {
					text: "#ede6d6",
					lines: [
						{ left: [{ text: "~/repo (main)" }], right: [] },
						{ left: [{ text: "12.3%/200k", color: "#7f7f7f" }], right: [{ text: "model-x", color: "#7f7f7f" }] },
					],
				};
			},
			{ render: () => ["native footer"], invalidate() {} },
			() => 40,
			repaint,
			{ kind: "footer", height: (model) => model.lines.length },
		);
		try {
			expect(panel.render(72)).toEqual(["native footer"]);
			await vi.waitFor(() => expect(repaint).toHaveBeenCalled(), { timeout: 10000 });
			const output = panel.render(72);
			expect(widths.every((width) => width === 72)).toBe(true);
			expect(output).toHaveLength(2);
			expect(stripAnsi(output[1]!)).toMatch(/^12\.3%\/200k +model-x$/);
			expect(output.every((line) => visibleWidth(line) === 72)).toBe(true);
			// A different width keeps the native footer until the matching frame arrives.
			expect(panel.render(50)).toEqual(["native footer"]);
		} finally {
			panel.dispose();
			await panel.waitForClose();
		}
	},
	15000,
);
