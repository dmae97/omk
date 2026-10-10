import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { visibleWidth } from "omk-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerStatus } from "../src/core/mcp/manager.ts";
import type { McpInventory, McpServerEntry } from "../src/core/mcp-inventory.ts";
import { loadSubscriptionUsage, recordClaudePassiveUsage } from "../src/core/provider-usage.ts";
import {
	mcpMaxRows,
	parseCodexUsageSnapshot,
	STATUS_SIDEBAR_MAX_WIDTH,
	STATUS_SIDEBAR_WIDTH,
	StatusSidebarComponent,
	statusSidebarWidth,
} from "../src/modes/interactive/components/status-sidebar.ts";
import type { TerminationSignal } from "../src/modes/interactive/control-plane-view-model.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

// Deterministic MCP roster so the rail test does not depend on the host's real config.
vi.mock("../src/core/mcp-inventory.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/core/mcp-inventory.ts")>();
	return {
		...actual,
		loadMcpInventory: vi.fn(() => mockInventory),
	};
});

function entry(name: string, overrides: Partial<McpServerEntry> = {}): McpServerEntry {
	return {
		name,
		source: "/tmp/mcp.json",
		commandSummary: "npx some-mcp",
		envKeys: [],
		argsCount: 0,
		autoApproveCount: 0,
		networkDecision: {
			allowed: true,
			mode: "none",
			rule: "mcp.network.none",
			reason: "",
			allowedDomains: [],
			deniedDomains: [],
			allowUnixSockets: [],
		},
		capabilityDecision: {
			trustedCapabilities: [],
			malformed: false,
			unknownCapabilities: [],
			rule: "mcp.capability.none",
			reason: "",
		},
		samplingDecision: {
			allowed: false,
			mode: "disabled",
			humanApprovalRequired: false,
			rule: "mcp.sampling.none",
			reason: "",
		},
		authDecision: { mode: "none", envKeys: [], rule: "mcp.auth.none", reason: "" },
		...overrides,
	};
}

const mockInventory: McpInventory = {
	entries: [
		entry("adaptorch"),
		entry("chrome-devtools"),
		entry("filesystem", { overriddenBy: "/tmp/other.json" }),
		entry("ghidra", { commandSummary: "<unknown>" }),
		entry("\u001b[31mevil\u202ename\nnext", { commandSummary: "<unknown>" }),
	],
	presets: [],
	sources: [],
	errors: [],
};

function makeSession() {
	return {
		state: {
			model: {
				id: "claude-test",
				reasoning: true,
				contextWindow: 200000,
				provider: "anthropic",
				baseUrl: undefined as string | undefined,
			},
			thinkingLevel: "high",
		},
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionName: () => "rail-test",
			getEntries: () => [],
		},
		getContextUsage: () => ({ percent: 42, contextWindow: 200000, tokens: 84000 }),
		// Live MCP surface: tests set liveMcpStatuses to simulate manager state.
		mcpServerStatus: () => liveMcpStatuses,
		mcpCheckHealth: async () => liveMcpStatuses,
		modelRegistry: {
			isUsingOAuth: () => false,
			isUsingOAuthProvider: (_provider: string) => false,
			getProviderAuthStatus: (_provider: string) => ({ configured: false }),
			getApiKeyForProvider: async (): Promise<string | undefined> => undefined,
			getApiKeyAndHeaders: async (): Promise<
				{ ok: true; apiKey: string; headers?: Record<string, string> } | { ok: false; error: string }
			> => ({ ok: false, error: "not configured in tests" }),
		},
		autoCompactionEnabled: true,
		// Control-plane authority sources (idle defaults); authority-row tests override them per case.
		isStreaming: false,
		isCompacting: false,
		isRetrying: false,
		pendingMessageCount: 0,
		lastTermination: undefined as TerminationSignal | undefined,
		settingsManager: { getResourceGovernorSettings: () => ({}) },
	};
}

function makeFooterData() {
	return {
		getGitBranch: () => "main",
		getCpuPercent: () => 37,
		getMemoryRssBytes: () => 512 * 1024 * 1024,
		getSystemCpuPercent: () => null,
		getSystemMemoryUsedBytes: () => null,
		getSystemMemoryTotalBytes: () => null,
		getPackageIntakeSummary: () => ({
			total: 5,
			acceptedNative: 3,
			acceptedReference: 1,
			acceptedMeasurement: 1,
			acceptedAdvisory: 0,
			deferred: 0,
			reject: 0,
			hardForkBlocked: 0,
		}),
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => 1,
	};
}

beforeAll(() => {
	process.env.OMK_PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
	initTheme("omk-neon-control");
});

/** Mutable live MCP feed consumed by the session fake; reset per test. */
let liveMcpStatuses: McpServerStatus[] = [];

// Captured at import time: one roster test swaps mockInventory.entries and never
// restores it, so later tests must put the original roster back themselves.
const originalMcpEntries = mockInventory.entries;

beforeEach(() => {
	liveMcpStatuses = [];
	mockInventory.entries = originalMcpEntries;
});

describe("StatusSidebarComponent (pinned opencode-style rail)", () => {
	it("renders a full-height rail with every line clipped to the rail width", () => {
		const sidebar = new StatusSidebarComponent(
			() => makeSession() as never,
			makeFooterData() as never,
			() => true,
		);
		const lines = sidebar.render(STATUS_SIDEBAR_WIDTH);
		expect(lines.length).toBeGreaterThan(10);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(STATUS_SIDEBAR_WIDTH);
		}
	});

	it("shows the MCP roster with a stable/total counter and stability dots", () => {
		const sidebar = new StatusSidebarComponent(
			() => makeSession() as never,
			makeFooterData() as never,
			() => true,
			() => 40,
		);
		const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		// 2 stable of 5 total → counter in the section rule.
		expect(text).toContain("MCP");
		expect(text).toContain("2/5");
		// Server names are listed.
		expect(text).toContain("adaptorch");
		expect(text).toContain("chrome-devtools");
		expect(text).toContain("filesystem");
		expect(text).toContain("ghidra");
		expect(text).toContain("evilname next");
		expect(text).not.toContain("\u202e");
		// Stability dots: stable (●), overridden (◐), unstable (○).
		expect(text).toContain("●");
		expect(text).toContain("◐");
		expect(text).toContain("○");
	});

	it("renders the live header elements (uptime + activity sparkline)", () => {
		const sidebar = new StatusSidebarComponent(
			() => makeSession() as never,
			makeFooterData() as never,
			() => true,
		);
		const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		expect(text).toContain("up");
		expect(text).toContain("act");
	});

	it("renders Codex 5H and 7D quota bars on separate status lines", async () => {
		const session = makeSession();
		session.state.model.provider = "openai-codex";
		session.modelRegistry.isUsingOAuth = () => true;
		session.modelRegistry.isUsingOAuthProvider = (provider) => provider === "openai-codex";
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 32,
			{
				requestRender,
				fetchCodexUsage: async () => ({
					fiveHour: { usedPercent: 42, resetsAt: Math.floor(Date.now() / 1000) + 2 * 60 * 60 },
					sevenDay: { usedPercent: 7, resetsAt: Math.floor(Date.now() / 1000) + 4 * 24 * 60 * 60 },
				}),
			},
		);

		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
		const lines = sidebar.render(STATUS_SIDEBAR_WIDTH);
		const plainLines = lines.map(stripAnsi);
		const text = plainLines.join("\n");
		expect(text).toContain("USAGE");
		expect(plainLines.some((line) => line.includes("5H") && line.includes("42%"))).toBe(true);
		expect(plainLines.some((line) => line.includes("7D") && line.includes("7%"))).toBe(true);
		expect(text).toContain("reset");
		expect(text).toContain("█");
		expect(text).toContain("░");
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(STATUS_SIDEBAR_WIDTH);
		}
	});

	it("renders Devin 1D and 7D quota bars from the CLI GetUserStatus surface", async () => {
		const session = makeSession();
		session.state.model.provider = "devin";
		session.state.model.id = "swe-2";
		session.state.model.baseUrl = "https://server.codeium.com";
		session.modelRegistry.getProviderAuthStatus = (provider) => ({
			configured: provider === "devin",
		});
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 32,
			{
				requestRender,
				fetchSubscriptionUsage: async () => ({
					label: "DEVIN",
					windows: [
						{ label: "1D", usedPercent: 42, resetsAt: Math.floor(Date.now() / 1000) + 3 * 60 * 60 },
						{ label: "7D", usedPercent: 58 },
					],
					message: "Devin Pro",
				}),
			},
		);

		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
		const plainLines = sidebar.render(STATUS_SIDEBAR_WIDTH).map(stripAnsi);
		const text = plainLines.join("\n");
		expect(text).toContain("USAGE");
		expect(text).toContain("DEVIN");
		expect(text).toContain("server.codeium.com");
		expect(plainLines.some((line) => line.includes("1D") && line.includes("42%"))).toBe(true);
		expect(plainLines.some((line) => line.includes("7D") && line.includes("58%"))).toBe(true);
		for (const line of sidebar.render(STATUS_SIDEBAR_WIDTH)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(STATUS_SIDEBAR_WIDTH);
		}
	});

	it("renders Command Code 5H, 7D, and monthly quota bars on the status rail", async () => {
		const session = makeSession();
		session.state.model.provider = "commandcode";
		session.state.model.baseUrl = "https://api.commandcode.ai/provider/v1";
		session.modelRegistry.getProviderAuthStatus = (provider) => ({
			configured: provider === "commandcode",
		});
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 32,
			{
				requestRender,
				fetchSubscriptionUsage: async () => ({
					label: "COMMAND CODE",
					windows: [
						{ label: "5H", usedPercent: 50, resetsAt: Math.floor(Date.now() / 1000) + 2 * 60 * 60 },
						{ label: "7D", usedPercent: 50 },
						{ label: "MO", usedPercent: 18.33 },
					],
					message: "Pro",
				}),
			},
		);

		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
		const plainLines = sidebar.render(STATUS_SIDEBAR_WIDTH).map(stripAnsi);
		const text = plainLines.join("\n");
		expect(text).toContain("USAGE");
		expect(text).toContain("COMMAND CODE");
		expect(plainLines.some((line) => line.includes("5H") && line.includes("50%"))).toBe(true);
		expect(plainLines.some((line) => line.includes("7D") && line.includes("50%"))).toBe(true);
		expect(plainLines.some((line) => line.includes("MO") && line.includes("18%"))).toBe(true);
		for (const line of sidebar.render(STATUS_SIDEBAR_WIDTH)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(STATUS_SIDEBAR_WIDTH);
		}
	});

	it("renders quota windows for non-Codex subscription providers", async () => {
		const session = makeSession();
		session.state.model.provider = "anthropic";
		session.modelRegistry.isUsingOAuth = () => true;
		session.modelRegistry.isUsingOAuthProvider = (provider) => provider === "anthropic";
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 32,
			{
				requestRender,
				fetchSubscriptionUsage: async () => ({
					label: "CLAUDE",
					windows: [
						{ label: "5H", usedPercent: 35 },
						{ label: "7D", usedPercent: 18 },
					],
				}),
			},
		);

		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
		const plainLines = sidebar.render(STATUS_SIDEBAR_WIDTH).map(stripAnsi);
		const text = plainLines.join("\n");
		expect(text).toContain("CLAUDE");
		expect(plainLines.some((line) => line.includes("5H") && line.includes("35%"))).toBe(true);
		expect(plainLines.some((line) => line.includes("7D") && line.includes("18%"))).toBe(true);
	});

	it("refreshes Claude quota immediately after passive headers arrive", async () => {
		const session = makeSession();
		session.state.model.provider = "anthropic";
		session.modelRegistry.isUsingOAuth = () => true;
		session.modelRegistry.isUsingOAuthProvider = (provider) => provider === "anthropic";
		let usedPercent = 35;
		const fetchSubscriptionUsage = vi.fn(async () => ({
			label: "CLAUDE",
			windows: [{ label: "5H", usedPercent }],
		}));
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 32,
			{ requestRender, fetchSubscriptionUsage },
		);

		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(fetchSubscriptionUsage).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalledTimes(1));
		usedPercent = 48;
		recordClaudePassiveUsage("test-sidebar-claude-token", {
			limitId: "anthropic-unified",
			primary: {
				usedPercent,
				windowSeconds: 5 * 60 * 60,
				resetsAt: Math.floor(Date.now() / 1000) + 3_600,
			},
		});
		sidebar.render(STATUS_SIDEBAR_WIDTH);

		await vi.waitFor(() => expect(fetchSubscriptionUsage).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => {
			const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
			expect(text).toContain("48%");
		});
	});

	it("renders the Model Studio Token Plan 7-day window from the QwenCloud CLI", async () => {
		const session = makeSession();
		session.state.model.provider = "modelstudio-maas";
		session.modelRegistry.getProviderAuthStatus = (provider) => ({
			configured: provider === "modelstudio-maas",
		});
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 32,
			{
				requestRender,
				fetchSubscriptionUsage: (usageSession, provider) =>
					loadSubscriptionUsage(usageSession, undefined, provider, async () => ({
						kind: "ran",
						exitCode: 0,
						stdout: JSON.stringify({
							token_plan: { subscribed: true, usedPct: 69.08, resetDate: "2026-08-24T06:45:00.000Z" },
						}),
					})),
			},
		);

		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
		const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		expect(text).toContain("QWEN TOKEN PLAN");
		expect(text).toContain("69%");
	});

	it("guides connecting the Token Plan when the QwenCloud CLI is missing", async () => {
		const session = makeSession();
		session.state.model.provider = "modelstudio-maas";
		session.modelRegistry.getProviderAuthStatus = (provider) => ({
			configured: provider === "modelstudio-maas",
		});
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 32,
			{
				requestRender,
				fetchSubscriptionUsage: (usageSession, provider) =>
					loadSubscriptionUsage(usageSession, undefined, provider, async () => ({ kind: "missing" })),
			},
		);

		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
		const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		expect(text).toContain("QWEN TOKEN PLAN");
		expect(text).toContain("connect:");
	});

	it("renders every configured provider while quota requests settle independently", async () => {
		const session = makeSession();
		session.state.model.provider = "openai-codex";
		session.modelRegistry.isUsingOAuth = () => true;
		session.modelRegistry.isUsingOAuthProvider = (provider) =>
			provider === "openai-codex" || provider === "anthropic";
		let resolveCodex:
			| ((snapshot: { label: string; windows: { label: string; usedPercent: number }[] }) => void)
			| undefined;
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 32,
			{
				requestRender,
				fetchSubscriptionUsage: async (_session, provider) => {
					if (provider === "openai-codex") {
						return new Promise((resolve) => {
							resolveCodex = resolve;
						});
					}
					return { label: "CLAUDE", windows: [{ label: "5H", usedPercent: 22 }] };
				},
			},
		);

		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalledTimes(1));
		let text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		expect(text).toContain("CODEX loading…");
		expect(text).toContain("CLAUDE");
		expect(text).toContain("22%");

		resolveCodex?.({ label: "CODEX", windows: [{ label: "7D", usedPercent: 41 }] });
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalledTimes(2));
		text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		expect(text).toContain("CODEX");
		expect(text).toContain("41%");
		expect(text).toContain("CLAUDE");
		expect(text).toContain("22%");
	});

	it("loads subscription quota from the official endpoint with the OAuth account header", async () => {
		const session = makeSession();
		session.state.model.provider = "openai-codex";
		session.modelRegistry.isUsingOAuth = () => true;
		session.modelRegistry.isUsingOAuthProvider = (provider) => provider === "openai-codex";
		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-test" } }),
		).toString("base64url");
		const token = `header.${payload}.signature`;
		session.modelRegistry.getApiKeyForProvider = async () => token;
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				rate_limit: {
					primary_window: { used_percent: 31, limit_window_seconds: 5 * 60 * 60 },
					secondary_window: { used_percent: 12, limit_window_seconds: 7 * 24 * 60 * 60 },
				},
			}),
		}));
		vi.stubGlobal("fetch", fetchMock);
		try {
			const requestRender = vi.fn();
			const sidebar = new StatusSidebarComponent(
				() => session as never,
				makeFooterData() as never,
				() => true,
				() => 32,
				{ requestRender },
			);
			sidebar.render(STATUS_SIDEBAR_WIDTH);
			await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
			expect(fetchMock).toHaveBeenCalledWith(
				"https://chatgpt.com/backend-api/wham/usage",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: `Bearer ${token}`,
						"chatgpt-account-id": "account-test",
					}),
				}),
			);
			const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
			expect(text).toContain("31%");
			expect(text).toContain("12%");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("identifies 5h and 7d windows by duration instead of response order", () => {
		expect(
			parseCodexUsageSnapshot({
				rate_limit: {
					primary_window: { used_percent: 9, limit_window_seconds: 7 * 24 * 60 * 60, reset_at: 111 },
					secondary_window: { used_percent: 41, limit_window_seconds: 5 * 60 * 60, reset_at: 222 },
				},
			}),
		).toEqual({
			fiveHour: { usedPercent: 41, resetsAt: 222 },
			sevenDay: { usedPercent: 9, resetsAt: 111 },
		});
	});

	it("collapses long rosters into a '+N more' line", () => {
		const many = Array.from({ length: 12 }, (_, i) => entry(`server-${i}`));
		mockInventory.entries = many;
		const sidebar = new StatusSidebarComponent(
			() => makeSession() as never,
			makeFooterData() as never,
			() => true,
		);
		const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		expect(text).toContain("+6 more");
		expect(text).toContain("12/12");
		// Only the first 6 rows are rendered (default 32-row terminal).
		expect(text).toContain("server-5");
		expect(text).not.toContain("server-6");
	});

	it("scales the rail width with the terminal (responsive, clamped)", () => {
		expect(statusSidebarWidth(96)).toBe(STATUS_SIDEBAR_WIDTH); // floor(24.9) → min 34
		expect(statusSidebarWidth(140)).toBe(36);
		expect(statusSidebarWidth(160)).toBe(41);
		expect(statusSidebarWidth(200)).toBe(STATUS_SIDEBAR_MAX_WIDTH); // capped at 48
		expect(statusSidebarWidth(400)).toBe(STATUS_SIDEBAR_MAX_WIDTH);
	});

	it("lists more MCP servers on taller terminals", () => {
		expect(mcpMaxRows(24)).toBe(4);
		expect(mcpMaxRows(32)).toBe(6);
		expect(mcpMaxRows(40)).toBe(14);
		expect(mcpMaxRows(60)).toBe(18); // capped

		mockInventory.entries = Array.from({ length: 12 }, (_, i) => entry(`server-${i}`));
		const tall = new StatusSidebarComponent(
			() => makeSession() as never,
			makeFooterData() as never,
			() => true,
			() => 40,
		);
		const text = stripAnsi(tall.render(statusSidebarWidth(200)).join("\n"));
		// 14 rows available → all 12 servers listed, no collapse line.
		expect(text).toContain("server-11");
		expect(text).not.toContain("more…");
	});

	it("renders cleanly at the maximum rail width", () => {
		const sidebar = new StatusSidebarComponent(
			() => makeSession() as never,
			makeFooterData() as never,
			() => true,
			() => 50,
		);
		const lines = sidebar.render(STATUS_SIDEBAR_MAX_WIDTH);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(STATUS_SIDEBAR_MAX_WIDTH);
		}
	});
});

describe("StatusSidebarComponent live MCP connectivity", () => {
	it("shows live ready/failed/idle state from the session manager, not just config stability", () => {
		liveMcpStatuses = [
			{ name: "adaptorch", state: "ready", toolCount: 7 },
			{ name: "chrome-devtools", state: "failed", toolCount: 0, error: "health check failed: write EPIPE" },
			{ name: "ghidra", state: "idle", toolCount: 0 },
		];
		const sidebar = new StatusSidebarComponent(
			() => makeSession() as never,
			makeFooterData() as never,
			() => true,
			() => 40,
		);
		const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		// Header counts live-ready servers over attached ones.
		expect(text).toContain("1/3");
		// Live badges and details per state.
		expect(text).toContain("✕");
		expect(text).toContain("failed");
		expect(text).toContain("idle");
		expect(text).toContain("7t");
		expect(text).toContain("●");
	});

	it("renders configuration-disabled servers as off instead of a scary failure", () => {
		liveMcpStatuses = [{ name: "adaptorch", state: "failed", toolCount: 0, error: "disabled by configuration" }];
		const sidebar = new StatusSidebarComponent(
			() => makeSession() as never,
			makeFooterData() as never,
			() => true,
			() => 40,
		);
		const text = stripAnsi(sidebar.render(STATUS_SIDEBAR_WIDTH).join("\n"));
		expect(text).toContain("off");
		expect(text).not.toContain("✕");
	});

	it("probes MCP health on the first render and throttles subsequent ones", async () => {
		liveMcpStatuses = [{ name: "adaptorch", state: "ready", toolCount: 7 }];
		const session = makeSession();
		const checkHealth = vi.fn(async () => liveMcpStatuses);
		session.mcpCheckHealth = checkHealth;
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 40,
			{ requestRender },
		);
		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(checkHealth).toHaveBeenCalledTimes(1));
		// A repaint inside the probe interval must not re-probe.
		sidebar.render(STATUS_SIDEBAR_WIDTH);
		expect(checkHealth).toHaveBeenCalledTimes(1);
		// The probe completion repaints so fresh status lands on screen.
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
	});

	it("never probes when no MCP manager is attached", () => {
		const session = makeSession();
		const checkHealth = vi.fn(async () => liveMcpStatuses);
		session.mcpCheckHealth = checkHealth;
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => 40,
		);
		sidebar.render(STATUS_SIDEBAR_WIDTH);
		expect(checkHealth).not.toHaveBeenCalled();
	});
});

const TOOL_FATAL: TerminationSignal = {
	kind: "tool_fatal",
	phase: "tool",
	causeCode: "tool.fatal",
	sideEffects: "possible",
	retryable: false,
	safeToAutoRetry: false,
	nextAction: "Inspect ".repeat(25),
};

function renderRail(session: ReturnType<typeof makeSession>, width: number = STATUS_SIDEBAR_WIDTH): string[] {
	return new StatusSidebarComponent(
		() => session as never,
		makeFooterData() as never,
		() => true,
	).render(width);
}

/** Plain text of the rail row carrying a 5-column label such as `"run  "`. */
function railRow(lines: readonly string[], label: string): string | undefined {
	return lines.map(stripAnsi).find((line) => line.startsWith(`│ ${label}`));
}

describe("StatusSidebarComponent authority rows (shared control-plane view model)", () => {
	it("projects an idle run and the honest unverified verdict", () => {
		const lines = renderRail(makeSession());
		expect(railRow(lines, "run  ")).toContain("run  ✓ idle");
		expect(railRow(lines, "vrfy ")).toContain("vrfy ? unverified");
		expect(railRow(lines, "why  ")).toBeUndefined();
	});

	it("shows a streaming turn as running", () => {
		const session = makeSession();
		session.isStreaming = true;
		expect(railRow(renderRail(session), "run  ")).toContain("run  ● running");
	});

	it.each([STATUS_SIDEBAR_WIDTH, STATUS_SIDEBAR_MAX_WIDTH])(
		"carries the tool_fatal failure essentials within %i columns",
		(width) => {
			const session = makeSession();
			session.lastTermination = TOOL_FATAL;
			const lines = renderRail(session, width);
			expect(TOOL_FATAL.nextAction).toHaveLength(200);
			expect(railRow(lines, "run  ")).toContain("run  ! tool_fatal");
			expect(railRow(lines, "why  ")).toContain("why  tool.fatal");
			expect(railRow(lines, "rtry ")).toContain("rtry none · fx possible");
			expect(railRow(lines, "next ")).toMatch(/^│ next Inspect .*… +│$/);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		},
	);

	it.each([
		{ percent: 42, glyph: "✓" },
		{ percent: 75, glyph: "▲" },
		{ percent: 95, glyph: "!" },
	])("marks $percent% context with $glyph on the ctx row", ({ percent, glyph }) => {
		const session = makeSession();
		session.getContextUsage = () => ({ percent, contextWindow: 200000, tokens: percent * 2000 });
		expect(railRow(renderRail(session), "ctx  ")).toContain(`ctx  ${glyph} ${percent.toFixed(1)}%/`);
	});

	it("never claims verification without evidence", () => {
		const streaming = makeSession();
		streaming.isStreaming = true;
		const failed = makeSession();
		failed.lastTermination = TOOL_FATAL;
		for (const session of [makeSession(), streaming, failed]) {
			const text = stripAnsi(renderRail(session).join("\n"));
			expect(text.replaceAll("unverified", "")).not.toContain("verified");
		}
	});

	it("yields MCP roster rows to the failure rows so the rail still fits the terminal", () => {
		mockInventory.entries = Array.from({ length: 12 }, (_, i) => entry(`server-${i}`));
		const failed = makeSession();
		failed.lastTermination = TOOL_FATAL;
		// Default 32-row terminal.
		expect(renderRail(makeSession()).length).toBeLessThanOrEqual(32);
		expect(renderRail(failed).length).toBeLessThanOrEqual(32);
	});

	it("renders journal-restored failure text as one terminal-safe row", () => {
		const session = makeSession();
		session.lastTermination = { ...TOOL_FATAL, nextAction: "Fix\nthe \u001b]52;c;cHduZWQ=\u0007tool" };
		const lines = renderRail(session);
		expect(lines.join("")).not.toContain("]52;");
		expect(lines.some((line) => line.includes("\n"))).toBe(false);
		expect(railRow(lines, "next ")).toContain("next Fix the tool");
	});

	it("floors the ctx percent and meter figure so neither reaches a threshold before the state", () => {
		const session = makeSession();
		session.getContextUsage = () => ({ percent: 69.96, contextWindow: 200000, tokens: 139920 });
		const plain = renderRail(session).map(stripAnsi);
		const ctxRow = plain.findIndex((line) => line.startsWith("│ ctx  "));
		expect(plain[ctxRow]).toContain("ctx  ✓ 69.9%/");
		expect(plain[ctxRow + 1]).toMatch(/ 69% +│$/);
	});

	it("floors the SYSTEM cpu figure and quota meters so no figure reaches its colour threshold early", async () => {
		const session = makeSession();
		session.state.model.provider = "anthropic";
		session.modelRegistry.isUsingOAuthProvider = (provider) => provider === "anthropic";
		const footer = makeFooterData();
		footer.getCpuPercent = () => 69.96;
		const requestRender = vi.fn();
		const sidebar = new StatusSidebarComponent(
			() => session as never,
			footer as never,
			() => true,
			() => 32,
			{
				requestRender,
				fetchSubscriptionUsage: async () => ({ label: "CLAUDE", windows: [{ label: "5H", usedPercent: 89.96 }] }),
			},
		);
		sidebar.render(STATUS_SIDEBAR_WIDTH);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalled());
		const plain = sidebar.render(STATUS_SIDEBAR_WIDTH).map(stripAnsi);
		// 89.96% is still below the 90% error colour, so the figure must not read 90%.
		expect(plain.some((line) => line.includes("5H") && line.includes(" 89%"))).toBe(true);
		expect(plain.some((line) => line.includes("cpu 69%"))).toBe(true);
		expect(plain.join("\n")).not.toMatch(/90%|cpu 70%/);
	});
});

describe("StatusSidebarComponent worst-case height", () => {
	it.each([30, 36, 44])("keeps the tallest roster-capped rail inside a %i-row terminal", (termRows) => {
		mockInventory.entries = Array.from({ length: 30 }, (_, i) => entry(`server-${i}`));
		const session = makeSession();
		session.state.model.baseUrl = "https://api.example.com/v1";
		session.modelRegistry.isUsingOAuth = () => true; // cost row
		const lines = new StatusSidebarComponent(
			() => session as never,
			makeFooterData() as never,
			() => true,
			() => termRows,
		).render(STATUS_SIDEBAR_WIDTH);
		const plain = lines.map(stripAnsi);
		// Every optional row outside USAGE/EXT/failure is present and the roster overflows.
		for (const label of ["git  ", "sess ", "endp ", "think ", "cost "]) expect(railRow(lines, label)).toBeDefined();
		expect(plain.some((line) => line.includes("cpu 37% mem"))).toBe(true);
		expect(plain.some((line) => /\+\d+ more…/.test(line))).toBe(true);
		expect(lines.length).toBeLessThanOrEqual(termRows);
		// The unpin hint and the bottom border close the rail inside the terminal.
		expect(plain[plain.length - 2]).toContain("unpin");
		expect(plain[plain.length - 1]).toMatch(/^└─+┘$/);
	});
});

describe("StatusSidebarComponent display safety", () => {
	/** OSC 52 clipboard write, CSI clear screen, right-to-left override, 8-bit CSI. */
	const HOSTILE = "\x1b]52;c;ZXZpbA==\x07\x1b[2J\u202e\u009b";
	/** Any escape except the SGR colour the rail paints itself. */
	const NON_SGR_ESCAPE = /\x1b(?!\[[0-9;]*m)/;
	const C1_OR_BIDI = /[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/;

	it.each([STATUS_SIDEBAR_WIDTH, STATUS_SIDEBAR_MAX_WIDTH])(
		"renders hostile cwd, git, session, model, endpoint, MCP and journal text as inert rows at %i columns",
		(width) => {
			mockInventory.entries = [entry(`mcp${HOSTILE}-name`)];
			const session = makeSession();
			session.sessionManager.getCwd = () => `/srv/proj${HOSTILE}-x`;
			session.sessionManager.getSessionName = () => `sess${HOSTILE}-name`;
			session.state.model.id = `model${HOSTILE}-id`;
			session.state.thinkingLevel = `high${HOSTILE}-level`;
			// The URL parser rejects this host, so the endp row is omitted instead of painted.
			session.state.model.baseUrl = `https://api${HOSTILE}.example.com/v1`;
			session.lastTermination = { ...TOOL_FATAL, nextAction: `Fix${HOSTILE}-tool` };
			const footer = makeFooterData();
			footer.getGitBranch = () => `feat${HOSTILE}-branch`;
			const lines = new StatusSidebarComponent(
				() => session as never,
				footer as never,
				() => true,
				() => 40,
			).render(width);
			for (const line of lines) {
				expect(line).not.toMatch(NON_SGR_ESCAPE);
				expect(line).not.toMatch(C1_OR_BIDI);
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			// Only the payload is dropped; every value keeps its own single row.
			expect(railRow(lines, "cwd  ")).toContain("cwd  /srv/proj-x");
			expect(railRow(lines, "git  ")).toContain("git  feat-branch");
			expect(railRow(lines, "sess ")).toContain("sess sess-name");
			expect(railRow(lines, "id   ")).toContain("id   model-id");
			expect(railRow(lines, "think ")).toContain("think high-level");
			expect(railRow(lines, "endp ")).toBeUndefined();
			expect(railRow(lines, "next ")).toContain("next Fix-tool");
			expect(lines.map(stripAnsi).some((line) => line.includes("● mcp-name"))).toBe(true);
		},
	);

	it("keeps every line inert and within the rail for arbitrary hostile display text", () => {
		const fragment = fc.oneof(
			fc.string({ unit: "binary", maxLength: 12 }),
			fc.constantFrom(HOSTILE, "\x1b]8;;https://x\x1b\\", "\x1b_Gf=100;AAAA\x1b\\", "\u0085", "\n", "\u2066"),
		);
		const text = fc.array(fragment, { maxLength: 4 }).map((parts) => parts.join(""));
		const values = fc.record({ cwd: text, git: text, sess: text, model: text, mcp: text, next: text });
		const width = fc.constantFrom(STATUS_SIDEBAR_WIDTH, STATUS_SIDEBAR_MAX_WIDTH);
		fc.assert(
			fc.property(values, width, (value, railWidth) => {
				mockInventory.entries = [entry(value.mcp)];
				const session = makeSession();
				session.sessionManager.getCwd = () => value.cwd;
				session.sessionManager.getSessionName = () => value.sess;
				session.state.model.id = value.model;
				session.lastTermination = { ...TOOL_FATAL, nextAction: value.next };
				const footer = makeFooterData();
				footer.getGitBranch = () => value.git;
				const lines = new StatusSidebarComponent(
					() => session as never,
					footer as never,
					() => true,
				).render(railWidth);
				for (const line of lines) {
					expect(line).not.toMatch(NON_SGR_ESCAPE);
					expect(line).not.toMatch(C1_OR_BIDI);
					expect(visibleWidth(line)).toBeLessThanOrEqual(railWidth);
				}
			}),
			{ numRuns: 80 },
		);
	});
});
