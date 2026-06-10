import { type Component, visibleWidth } from "@earendil-works/omk-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { OmkControlDashboardComponent } from "../src/modes/interactive/components/omk-control-dashboard.ts";
import { OmkControlLayout } from "../src/modes/interactive/components/omk-control-layout.ts";
import { OmkNeonHudComponent } from "../src/modes/interactive/components/omk-neon-hud.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function createSession(): AgentSession {
	const entries = [
		{
			type: "message",
			message: {
				role: "assistant",
				usage: {
					input: 12_300,
					output: 4_200,
					cacheRead: 500,
					cacheWrite: 250,
					cost: { total: 0.456 },
				},
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "todo",
				details: {
					todos: [
						{ id: 1, text: "Move footer telemetry into the right rail", done: false },
						{ id: 2, text: "Keep /omk-parallel-goal usable", done: true },
					],
				},
			},
		},
	];

	return {
		state: {
			model: { id: "claude-sonnet-4", provider: "anthropic", contextWindow: 200_000, reasoning: true },
			thinkingLevel: "high",
		},
		sessionManager: {
			getEntries: () => entries,
			getBranch: () => entries,
			getSessionName: () => "dashboard-session",
			getCwd: () => "/home/user/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 42.4 }),
		promptTemplates: [{ name: "omk-parallel-goal" }],
		resourceLoader: {
			getSkills: () => ({ skills: [{ name: "omk-plan-first" }, { name: "omk-quality-gate" }], diagnostics: [] }),
			getExtensions: () => ({ extensions: [{ path: "omk-runtime" }], errors: [], runtime: {} }),
		},
	} as unknown as AgentSession;
}

function createFooterData(): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => "main",
		getExtensionStatuses: () =>
			new Map([
				["omk", "DAG:omk-parallel-orchestrator MCP:14 skills:36"],
				["headroom", "headroom:0.22.4"],
			]),
		getAvailableProviderCount: () => 2,
		onBranchChange: () => () => {},
	};
}

class WidthProbeComponent implements Component {
	lastWidth = 0;

	render(width: number): string[] {
		this.lastWidth = width;
		return [`const result = ${"x".repeat(width)};`];
	}

	invalidate(): void {}
}

class StaticComponent implements Component {
	private lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

describe("OmkControlDashboardComponent", () => {
	beforeAll(() => {
		initTheme("omk-control", false);
	});

	it("renders OMK status, TODO, session, runtime, and cost data inside the rail width", () => {
		const component = new OmkControlDashboardComponent(createSession(), createFooterData(), () => ({
			label: "working...",
			detail: "planning/read/write loop active",
			pendingToolCount: 1,
			queuedMessageCount: 2,
		}));

		const lines = component.render(44);
		const text = stripAnsi(lines.join("\n"));

		expect(text).toContain("OMK://CONTROL");
		expect(text).toContain("MATRIX RAIN // NEON GRID ONLINE");
		expect(text).toContain("CYBERPUNK OPS CORE");
		expect(text).toContain("working...");
		expect(text).toContain("TODO");
		expect(text).toContain("CONTROL");
		expect(text).toContain("evidence gated");
		expect(text).toContain("Move footer telemetry");
		expect(text).toContain("DAG:omk-parallel-orchestrator");
		expect(text).toContain("headroom:0.22.4");
		expect(text).toContain("$0.456");
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(44);
		}
	});

	it("collapses without rendering below the minimum dashboard width", () => {
		const component = new OmkControlDashboardComponent(createSession(), createFooterData());

		expect(component.render(29)).toEqual([]);
	});

	it("renders composer-lift neon HUD with exact requested rows", () => {
		const component = new OmkNeonHudComponent(createSession(), createFooterData(), {
			getRows: () => 4,
			getActivity: () => ({ label: "working...", detail: "planning/read/write loop active" }),
		});

		const lines = component.render(72);
		const text = stripAnsi(lines.join("\n"));

		expect(lines).toHaveLength(4);
		expect(text).toContain("OMK://NEON HUD");
		expect(text).toContain("ROUTE");
		expect(text).toContain("MODEL");
		expect(text).toContain("claude-sonnet-4");
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(72);
		}
	});

	it("reserves a tmux-style right rail instead of overlaying main code", () => {
		let active = false;
		const main = new WidthProbeComponent();
		const dashboard = new StaticComponent(["DASH", "TODO"]);
		const layout = new OmkControlLayout(dashboard, {
			dashboardWidth: 20,
			minWidth: 80,
			onActiveChange: (nextActive) => {
				active = nextActive;
			},
		});
		layout.addChild(main);

		const splitLines = layout.render(100);
		expect(active).toBe(true);
		expect(main.lastWidth).toBe(78);
		expect(stripAnsi(splitLines[0])).toContain(" │DASH");
		expect(stripAnsi(splitLines[0]).slice(0, 78)).toContain("const result");
		for (const line of splitLines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(100);
		}

		const narrowLines = layout.render(79);
		expect(active).toBe(false);
		expect(main.lastWidth).toBe(79);
		expect(stripAnsi(narrowLines.join("\n"))).not.toContain("DASH");
	});

	it("supports panel hide and compact modes", () => {
		const main = new WidthProbeComponent();
		const dashboard = new StaticComponent(["DASH"]);
		const layout = new OmkControlLayout(dashboard, {
			dashboardWidth: 44,
			minWidth: 80,
		});
		layout.addChild(main);

		layout.setPanelMode("hide");
		const hiddenLines = layout.render(120, 10);
		expect(stripAnsi(hiddenLines.join("\n"))).not.toContain("DASH");
		expect(main.lastWidth).toBe(120);

		layout.setPanelMode("compact");
		const compactLines = layout.render(120, 10);
		expect(stripAnsi(compactLines.join("\n"))).toContain("DASH");
		expect(main.lastWidth).toBe(84);
	});

	it("pins the right rail to the visible viewport while long main transcripts scroll", () => {
		const dashboard = new StaticComponent(["RAIL-0", "RAIL-1", "RAIL-2"]);
		const layout = new OmkControlLayout(dashboard, {
			dashboardWidth: 20,
			minWidth: 80,
		});
		layout.addChild(new StaticComponent(["main-0", "main-1", "main-2", "main-3", "main-4", "main-5"]));

		const lines = layout.render(100, 3).map(stripAnsi);

		expect(lines).toHaveLength(6);
		expect(lines[0]).not.toContain("RAIL-0");
		expect(lines[1]).not.toContain("RAIL-1");
		expect(lines[2]).not.toContain("RAIL-2");
		expect(lines[3]).toContain("RAIL-0");
		expect(lines[4]).toContain("RAIL-1");
		expect(lines[5]).toContain("RAIL-2");
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(100);
		}
	});
});
