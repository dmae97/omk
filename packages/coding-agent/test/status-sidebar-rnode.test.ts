import { visibleWidth } from "omk-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifiedRunError } from "../src/core/verified-run/storage.ts";
import type { RunGraphSnapshot } from "../src/core/verified-run/workbench-run-graph.ts";
import { STATUS_SIDEBAR_WIDTH, StatusSidebarComponent } from "../src/modes/interactive/components/status-sidebar.ts";
import { RNodeController } from "../src/modes/interactive/rnode/rnode-controller.ts";
import type { RNodePanelInput } from "../src/modes/interactive/rnode/rnode-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const inventory = vi.hoisted(() => ({ names: [] as string[] }));

vi.mock("../src/core/mcp-inventory.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/core/mcp-inventory.ts")>();
	return {
		...actual,
		loadMcpInventory: vi.fn(() => ({
			entries: inventory.names.map((name) => ({
				name,
				commandSummary: "npx mcp",
				source: "/tmp/mcp.json",
				envKeys: [],
				argsCount: 0,
				autoApproveCount: 0,
				networkDecision: { allowed: true, mode: "none", rule: "mcp.network.none", reason: "" },
				capabilityDecision: { trustedCapabilities: [], malformed: false, unknownCapabilities: [], rule: "x" },
				samplingDecision: { allowed: false, mode: "disabled", humanApprovalRequired: false, rule: "x" },
				authDecision: { mode: "none", envKeys: [], rule: "x", reason: "" },
			})),
			presets: [],
			sources: [],
			errors: [],
		})),
	};
});

const D = (c: string) => c.repeat(64);

function snapshot(): RunGraphSnapshot {
	return {
		schemaVersion: "omk.run-graph.v1",
		runtime: "node",
		graphKind: "verified-run",
		executionRequested: false,
		capabilities: { execute: false, amendGraph: false },
		runId: "dag-1",
		cursor: {
			journalDigest: D("a"),
			contractDigest: D("b"),
			candidateDigest: null,
			receiptDigest: null,
			environmentDigest: null,
			revision: 3,
			generation: 1,
			authorityRevision: 0,
			authorityDigest: D("0"),
		},
		state: {
			execution: "running",
			settlement: "open",
			verification: "not_requested",
			application: "not_requested",
			publication: "none",
		},
		proofVerdict: "unverified",
		nodes: [
			{ id: "fetch", dependsOn: [], status: "succeeded", attempt: 1, generation: 1, ready: false },
			{ id: "build", dependsOn: ["fetch"], status: "running", attempt: 1, generation: 1, ready: false },
		],
		edges: [{ source: "fetch", target: "build", kind: "dependency" }],
	};
}

function session() {
	return {
		state: { model: { id: "m", reasoning: false, contextWindow: 1000, provider: "p" }, thinkingLevel: "off" },
		sessionManager: { getCwd: () => "/tmp/project", getSessionName: () => undefined, getEntries: () => [] },
		getContextUsage: () => ({ percent: 10, contextWindow: 1000, tokens: 100 }),
		mcpServerStatus: () => [],
		mcpCheckHealth: async () => [],
		modelRegistry: {
			isUsingOAuth: () => false,
			isUsingOAuthProvider: () => false,
			getProviderAuthStatus: () => ({ configured: false }),
		},
		autoCompactionEnabled: true,
		isStreaming: false,
		isCompacting: false,
		isRetrying: false,
		pendingMessageCount: 0,
		lastTermination: undefined,
		settingsManager: { getResourceGovernorSettings: () => ({}), getSubscriptionUsageProviders: () => [] },
	};
}

const footer = {
	getGitBranch: () => "main",
	getSystemCpuPercent: () => null,
	getMemoryRssBytes: () => null,
	getCpuPercent: () => null,
	getSystemMemoryUsedBytes: () => null,
	getSystemMemoryTotalBytes: () => null,
	getPackageIntakeSummary: () => ({
		total: 0,
		acceptedNative: 0,
		acceptedReference: 0,
		acceptedMeasurement: 0,
		acceptedAdvisory: 0,
		deferred: 0,
		reject: 0,
		hardForkBlocked: 0,
	}),
	getExtensionStatuses: () => new Map<string, string>(),
};

function render(rows: number, rnode?: () => RNodePanelInput): string[] {
	const sidebar = new StatusSidebarComponent(
		() => session() as never,
		footer as never,
		() => true,
		() => rows,
		{ rnode },
	);
	return sidebar.render(STATUS_SIDEBAR_WIDTH).map(stripAnsi);
}

beforeAll(() => {
	initTheme("omk-control-grid-dark");
});

beforeEach(() => {
	inventory.names = [];
});

describe("pinned status sidebar R·NODE", () => {
	const controller = new RNodeController({ changed: () => {}, read: snapshot });
	controller.bind({ runId: "dag-1", stateRoot: "/runs" });
	const bound = () => controller.panelInput();

	it("adds nothing while no run is bound", () => {
		expect(render(50).join("\n")).not.toContain("R·NODE");
		expect(render(50, () => undefined)).toEqual(render(50));
	});

	it("shows the bound run beside RUN and VERIFY, inside the rail width", () => {
		const lines = render(50, bound);
		const text = lines.join("\n");
		expect(text).toContain("R·NODE");
		expect(text).toContain("dag-1 · rev 3 · gen 1");
		expect(text).toContain("? unverified");
		expect(text).toContain("✓ done");
		expect(text).toContain("● running");
		const rnodeAt = lines.findIndex((line) => line.includes("R·NODE"));
		expect(lines.findIndex((line) => line.includes("vrfy"))).toBeLessThan(rnodeAt);
		expect(lines.findIndex((line) => line.includes("MODEL"))).toBeGreaterThan(rnodeAt);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(STATUS_SIDEBAR_WIDTH);
	});

	it("takes rows from the MCP roster and never pushes the rail past the terminal", () => {
		inventory.names = Array.from({ length: 20 }, (_, i) => `server-${i}`);
		// Up to the roster cap, every R·NODE row replaces a roster row.
		for (const rows of [36, 44]) {
			const plain = render(rows);
			const withRnode = render(rows, bound);
			expect(withRnode).toHaveLength(plain.length);
			expect(withRnode.join("\n")).toContain("R·NODE");
		}
		// Past the cap the roster stops at 18 rows, so R·NODE uses spare height without overflowing.
		const tall = render(60, bound);
		expect(tall.length).toBeLessThanOrEqual(60);
		expect(tall.join("\n")).toContain("server-17");
	});

	it("drops the section when the terminal leaves no room for it", () => {
		const text = render(30, bound).join("\n");
		expect(text).not.toContain("R·NODE");
	});

	it("shows a bound run whose first read failed as unreadable, not healthy", () => {
		const failing = new RNodeController({
			changed: () => {},
			read: () => {
				throw new VerifiedRunError("run_missing");
			},
		});
		failing.bind({ runId: "dag-9", stateRoot: "/runs" });
		const text = render(50, () => failing.panelInput()).join("\n");
		expect(text).toContain("dag-9");
		expect(text).toContain("~ unreadable");
		failing.dispose();
	});
});
