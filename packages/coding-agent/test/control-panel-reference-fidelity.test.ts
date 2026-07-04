import { visibleWidth } from "omk-tui";
import { describe, expect, test } from "vitest";
import {
	ControlPanelComponent,
	ControlPanelRightPaneComponent,
	type ControlPanelStatusSnapshot,
} from "../src/modes/interactive/components/control-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const ESC_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
	return value.replace(ESC_RE, "");
}

function makePanel(): ControlPanelComponent {
	const statusSnapshot = (): ControlPanelStatusSnapshot => ({
		modelProvider: "deepseek",
		modelId: "deepseek-v4-pro",
		thinkingLevel: "max",
		contextPercent: 0,
		contextWindowTokens: 1_000_000,
		headroomStatus: "headroom:0.29.0",
		skillCount: 96,
		mcpCount: 12,
		runtimeState: "ready",
		routeState: "active",
		evidenceState: "tracking",
		controlState: "ready",
		dagOrchestrationState: "DAG:omk-parallel-orchestrator",
		ansiColorState: "on",
		startupState: "linked",
		linkState: "ready",
		sidebarState: "pinned",
		cwdLabel: "~/open_multi-agent_kit",
		gitBranch: "main",
	});

	return new ControlPanelComponent({
		appName: "omk",
		version: "0.78.0",
		compactInstructions: () => "escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more",
		compactOnboarding: () => "Press ctrl+o to show full startup help and loaded resources.",
		expandedInstructions: () => "OMK//CONTROL READ route/verify/loop/control",
		onboarding: () =>
			[
				"[Context]",
				" 2 loaded · ~/AGENTS.md, AGENTS.md",
				"",
				"[Skills]",
				" 96 loaded · agentmemory, andrej-karpathy-skills, appshot-visual-context, blue-ribbon-nearby, browser-feedback, +91 more",
				"",
				"[Prompts]",
				" 2 loaded · /omk-parallel-goal, /root",
				"",
				"[Extensions]",
				" 3 loaded · headroom-integration, omk-runtime, subagent",
				"",
				"[Themes]",
				" 1 loaded · omk-control-grid-dark",
			].join("\n"),
		statusSnapshot,
	});
}

describe("ControlPanelComponent reference fidelity", () => {
	test("expanded wide render preserves the screenshot deck and fixed right control pane", () => {
		initTheme("omk-control-grid-dark");
		const panel = makePanel();

		panel.setExpanded(true);
		const plain = stripAnsi(panel.render(172).join("\n"));
		panel.dispose();

		expect(plain).toContain("omk v0.78.0 · OMK://CONTROL");
		expect(plain).toContain("████");
		expect(plain).toContain("OMK://CONTROL");
		expect(plain).toContain("CYBERPUNK OPS CORE");
		expect(plain).toContain("MATRIX RAIN");
		expect(plain).toContain("NEON GRID ONLINE");
		expect(plain).toContain("NIGHT-CITY-MATRIX-V3");
		expect(plain).toContain("sidebar: pinned");
		expect(plain).toContain("meter:");
		expect(plain).toContain("pulse:");
		expect(plain).toContain("OMK://CONTROL READ route/verify/loop/control");
		expect(plain).toContain("route: active");
		expect(plain).toContain("control");
		expect(plain).toContain("[Context]");
		expect(plain).toContain("1 loaded · omk-control-grid-dark");

		const contextLine = plain.split("\n").find((line) => line.includes("[Context]"));
		const skillsLine = plain.split("\n").find((line) => line.includes("browser-feedback"));
		expect(contextLine).toMatch(/\[Context\]\s+│/);
		expect(contextLine).not.toContain("OMK://CONTROL");
		expect(skillsLine).toMatch(/browser-feedback, \+91 more\s+│/);
	});

	test("right pane component renders the fixed overlay control rail", () => {
		initTheme("omk-control-grid-dark");
		const pane = new ControlPanelRightPaneComponent({
			appName: "omk",
			version: "0.78.0",
			compactInstructions: () => "route/verify/loop/control",
			expandedInstructions: () => "OMK://CONTROL READ route/verify/loop/control",
			compactOnboarding: () => "",
			onboarding: () => "",
			statusSnapshot: () => ({
				modelProvider: "deepseek",
				modelId: "deepseek-v4-pro",
				thinkingLevel: "max",
				contextPercent: 0,
				contextWindowTokens: 1_000_000,
				headroomStatus: "headroom:0.29.0",
				skillCount: 96,
				mcpCount: 12,
				runtimeState: "ready",
				routeState: "active",
				evidenceState: "tracking",
				controlState: "ready",
				dagOrchestrationState: "DAG:omk-parallel-orchestrator",
				ansiColorState: "on",
				startupState: "linked",
				linkState: "ready",
				sidebarState: "pinned",
				cwdLabel: "~/open_multi-agent_kit",
				gitBranch: "main",
			}),
		});

		const lines = pane.render(38).map(stripAnsi);
		expect(lines.join("\n")).toContain("OMK://CONTROL");
		expect(lines.join("\n")).toContain("CYBERPUNK OPS CORE");
		expect(lines.join("\n")).toContain("MATRIX RAIN");
		expect(lines.join("\n")).toContain("NIGHT-CITY-MATRIX-V3");
		expect(lines.join("\n")).toContain("meter:");
		expect(lines.join("\n")).toContain("pulse:");
		expect(lines.join("\n")).toContain("sidebar: pinned");
		expect(lines.every((line) => visibleWidth(line) === 38)).toBe(true);
	});
});

test("CJK emoji combining visibleWidth fixture keeps every row within 38 display cells", () => {
	const fixture = "模型🚀e\u0301";
	const statusSnapshot = (): ControlPanelStatusSnapshot => ({
		modelProvider: "openrouter",
		modelId: `${fixture}-model-with-a-very-long-tail-${fixture}`,
		thinkingLevel: "high",
		contextPercent: 38,
		contextWindowTokens: 128_000,
		headroomStatus: `headroom-${fixture}`,
		skillCount: 96,
		mcpCount: 12,
		runtimeState: "ready",
		routeState: "active",
		evidenceState: "tracking",
		controlState: "ready",
		dagOrchestrationState: "DAG:omk-parallel-orchestrator",
		ansiColorState: "on",
		startupState: "linked",
		linkState: "ready",
		sidebarState: "pinned",
		cwdLabel: `~/작업/${fixture}/a-very-long-current-working-directory-that-must-fit`,
		gitBranch: `feature/${fixture}`,
		todoState: {
			items: [
				{ id: "done", label: `done ${fixture}`, status: "done" },
				{ id: "active", label: `active long TODO ${fixture} ${"測".repeat(24)}`, status: "active" },
				{ id: "pending", label: `pending ${fixture}`, status: "pending" },
			],
			updatedAt: 1,
		},
	});
	const panel = new ControlPanelRightPaneComponent({
		appName: "omk",
		version: "0.80.5",
		compactInstructions: () => "compact",
		expandedInstructions: () => "expanded",
		compactOnboarding: () => "compact onboarding",
		onboarding: () => "onboarding",
		statusSnapshot,
	});
	const lines = panel.render(38).map(stripAnsi);
	const wrongWidth = lines.filter((line) => visibleWidth(line) !== 38);

	expect(
		wrongWidth,
		"CJK emoji combining fixture must use display-cell visibleWidth, not code-unit length, for every 38-column right-rail row",
	).toEqual([]);
	expect(
		lines.join("\n"),
		"long TODO CJK semantic fixture should not be clipped to a single 38-cell wide glyph",
	).toContain("測測");
});
