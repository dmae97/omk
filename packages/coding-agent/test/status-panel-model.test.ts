import { beforeAll, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import type { StatusPanelActivitySnapshot } from "../src/modes/interactive/status-panel-activity.ts";
import { statusPanelModel } from "../src/modes/interactive/status-panel-model.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => initTheme("omk-paper-dark"));
function fixture() {
	const session = {
		state: {
			model: { id: "test-model", provider: "openai-codex", reasoning: true, contextWindow: 200000 },
			thinkingLevel: "high",
		},
		isStreaming: false,
		isCompacting: false,
		isRetrying: false,
		pendingMessageCount: 0,
		lastTermination: undefined,
		autoCompactionEnabled: true,
		getContextUsage: () => ({ percent: 42, contextWindow: 200000, tokens: 84000 }),
		sessionManager: { getCwd: () => "/tmp/작업", getEntries: () => [] },
		settingsManager: { getResourceGovernorSettings: () => ({}) },
		mcpServerStatus: () => [
			{ name: "filesystem", state: "ready", toolCount: 14 },
			{ name: "old", state: "failed", toolCount: 0, error: "disabled by configuration" },
		],
	} as unknown as AgentSession;
	const footer = {
		getSystemCpuPercent: () => 0,
		getSystemMemoryUsedBytes: () => null,
		getSystemMemoryTotalBytes: () => null,
		getCpuPercent: () => 2,
		getMemoryRssBytes: () => 512 * 1024 * 1024,
		getGitBranch: () => "main",
	} as unknown as ReadonlyFooterDataProvider;
	return { session, footer };
}
it("keeps compact status truthful and only uses the active provider quota", () => {
	const { session, footer } = fixture();
	const model = statusPanelModel(
		session,
		footer,
		[
			{ label: "CODEX", windows: [{ label: "5H", usedPercent: 16 }] },
			{ label: "CLAUDE", windows: [{ label: "5H", usedPercent: 90 }] },
		],
		false,
	);
	expect(model.rows.find((row) => row.label === "Verify")?.value).toContain("unverified");
	expect(model.usage.windows[0].percent).toBe(16);
	expect(model.context.percent).toBe(42);
	expect(model.sections).toHaveLength(1);
	expect(model.system.cpuPercent).toBe(0);
	expect(model.system.memoryPercent).toBeNull();
});
it("exposes whole-host CPU and RAM in compact mode, distinct from process metrics", () => {
	const { session, footer } = fixture();
	footer.getSystemCpuPercent = () => 82.9;
	footer.getSystemMemoryUsedBytes = () => 12 * 1024 ** 3;
	footer.getSystemMemoryTotalBytes = () => 16 * 1024 ** 3;
	const model = statusPanelModel(session, footer, [], false);
	expect(model.system.cpuPercent).toBe(82.9);
	expect(model.system.memoryPercent).toBe(75);
	expect(model.system.memoryCaption).toBe("12.0G / 16.0G");
	const runtime = statusPanelModel(session, footer, [], true).sections.find((section) => section.title === "Runtime");
	expect(runtime?.rows.find((row) => row.label === "CPU (OMK)")?.value).toBe("2%");
	expect(runtime?.rows.find((row) => row.label === "RSS (OMK)")?.value).toBe("512M");
});

it("expands runtime data without letting external display text drive the terminal", () => {
	const { session, footer } = fixture();
	session.state.model!.id = "bad\x1b[2J\nname";
	const model = statusPanelModel(session, footer, [], true);
	expect(model.model).toBe("bad name");
	expect(model.sections.some((section) => section.title === "Runtime")).toBe(true);
	expect(model.sections[0].rows.find((row) => row.label === "old")?.value).toBe("off");
});
it("adds only task progress and active tools to compact mode, keeps observations in details", () => {
	const { session, footer } = fixture();
	const activity: StatusPanelActivitySnapshot = {
		task: { label: "Connect\x1b[2J data", done: 2, total: 4, blocked: 1 },
		tool: { name: "bash", seconds: 12, count: 2 },
		skills: { selected: ["programming"], loaded: ["debugging"] },
		checks: {
			tests: { text: "7 passed", state: "success", stale: true },
			diagnostics: { text: "1 error", state: "error", stale: false },
		},
	};
	const compact = statusPanelModel(session, footer, [], false, activity);
	expect(compact.rows.find((row) => row.label === "Tasks")?.value).toBe("2/4 / 1 blocked");
	expect(compact.rows.find((row) => row.label === "Now")?.value).toBe("Connect data");
	expect(compact.rows.find((row) => row.label === "Tool")?.value).toBe("bash 12s +1");
	expect(compact.sections.map((section) => section.title)).toEqual(["Connections"]);
	const expanded = statusPanelModel(session, footer, [], true, activity);
	expect(expanded.sections.find((section) => section.title === "Skills")?.rows.map((row) => row.value)).toEqual([
		"programming",
		"debugging",
	]);
	expect(expanded.sections.find((section) => section.title === "Recent checks")?.rows[0].value).toContain(
		"7 passed / earlier",
	);
	expect(expanded.rows.find((row) => row.label === "Verify")?.value).toContain("unverified");
});
it("leaves idle compact mode unchanged and shows unobserved details explicitly", () => {
	const { session, footer } = fixture();
	const activity: StatusPanelActivitySnapshot = { skills: { selected: [], loaded: [] }, checks: {} };
	expect(statusPanelModel(session, footer, [], false, activity).rows.map((row) => row.label)).toEqual([
		"Run",
		"Verify",
	]);
	expect(
		statusPanelModel(session, footer, [], true, activity)
			.sections.find((section) => section.title === "Recent checks")
			?.rows.every((row) => row.value === "not observed"),
	).toBe(true);
});
