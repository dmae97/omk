import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import {
	cachedMcpInventory,
	classifyMcpStability,
	controlPanelHeaderKey,
	controlPanelStatusReaders,
	countRoutableNonHubSkills,
	countStableMcpServers,
	parseHeadroomVersionOutput,
} from "../src/modes/interactive/components/control-panel-runtime-status.ts";

function mcpEntry(
	overrides: {
		commandSummary?: string;
		overriddenBy?: string;
		authRule?: string;
		networkRule?: string;
		malformed?: boolean;
		unknownCapabilities?: readonly string[];
	} = {},
) {
	return {
		commandSummary: overrides.commandSummary ?? "npx stable-mcp",
		...(overrides.overriddenBy ? { overriddenBy: overrides.overriddenBy } : {}),
		authDecision: { rule: overrides.authRule ?? "mcp.auth.none" },
		networkDecision: { rule: overrides.networkRule ?? "mcp.network.unspecified" },
		capabilityDecision: {
			malformed: overrides.malformed ?? false,
			unknownCapabilities: [...(overrides.unknownCapabilities ?? [])],
		},
	};
}

describe("control panel runtime status helpers", () => {
	it("counts only stable MCP entries for the runtime badge", () => {
		expect(
			countStableMcpServers([
				mcpEntry(),
				mcpEntry({ commandSummary: "<unknown>" }),
				mcpEntry({ commandSummary: "sudo npx risky-mcp" }),
				mcpEntry({ authRule: "mcp.auth.invalid" }),
				mcpEntry({ networkRule: "mcp.network.invalid_mode" }),
				mcpEntry({ malformed: true }),
				mcpEntry({ unknownCapabilities: ["root"] }),
				mcpEntry({ overriddenBy: "/tmp/other-mcp.json" }),
			]),
		).toBe(1);
	});

	it("classifies MCP entries into stable / overridden / unstable for the rail dots", () => {
		expect(classifyMcpStability(mcpEntry())).toBe("stable");
		expect(classifyMcpStability(mcpEntry({ overriddenBy: "/tmp/other-mcp.json" }))).toBe("overridden");
		expect(classifyMcpStability(mcpEntry({ commandSummary: "<unknown>" }))).toBe("unstable");
		expect(classifyMcpStability(mcpEntry({ commandSummary: "sudo npx risky-mcp" }))).toBe("unstable");
		expect(classifyMcpStability(mcpEntry({ authRule: "mcp.auth.invalid" }))).toBe("unstable");
		expect(classifyMcpStability(mcpEntry({ networkRule: "mcp.network.invalid_mode" }))).toBe("unstable");
		expect(classifyMcpStability(mcpEntry({ malformed: true }))).toBe("unstable");
		expect(classifyMcpStability(mcpEntry({ unknownCapabilities: ["root"] }))).toBe("unstable");
	});

	it("parses Headroom 3.0 and legacy version outputs", () => {
		expect(parseHeadroomVersionOutput("github.com/headroomlabs-ai/headroom 3.0")).toBe("3.0");
		expect(parseHeadroomVersionOutput("headroom version 3.0.1\n")).toBe("3.0.1");
		expect(parseHeadroomVersionOutput("headroom, version 0.22.4")).toBe("0.22.4");
		expect(parseHeadroomVersionOutput("headroom unavailable")).toBeNull();
	});

	it("excludes OMK hub skills from the displayed skill total", () => {
		expect(
			countRoutableNonHubSkills([
				{ name: "omk-skills" },
				{ name: "omk-frontend" },
				{ name: "omk-loop" },
				{ name: "programming" },
				{ name: "headroom" },
			]),
		).toBe(2);
	});
});

describe("cachedMcpInventory", () => {
	it("reuses the inventory for the same cwd within the TTL and re-reads after it or for another cwd", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omk-mcp-cache-"));
		const a = path.join(root, "a");
		const b = path.join(root, "b");
		fs.mkdirSync(path.join(a, ".omk"), { recursive: true });
		fs.mkdirSync(b);
		try {
			const first = cachedMcpInventory(a, 1_000);
			fs.writeFileSync(path.join(a, ".omk", "mcp.json"), JSON.stringify({ mcpServers: { x: { command: "x" } } }));
			expect(cachedMcpInventory(a, 5_999)).toBe(first);
			const refreshed = cachedMcpInventory(a, 6_000);
			expect(refreshed).not.toBe(first);
			expect(refreshed.entries.length).toBe(first.entries.length + 1);
			expect(cachedMcpInventory(b, 6_001)).not.toBe(refreshed);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("keys the startup header on model, manual thinking level and session id", () => {
		const fakeSession = (
			model: { provider: string; id: string } | undefined,
			thinkingLevel: string,
			thinkingMode: "manual" | "auto",
			sessionId: string,
		) =>
			({
				state: { model, thinkingLevel },
				thinkingMode,
				sessionManager: { getSessionId: () => sessionId },
			}) as unknown as AgentSession;
		const model = { provider: "openrouter", id: "m1" };
		expect(controlPanelHeaderKey(fakeSession(model, "high", "manual", "s1"))).toEqual({
			model: "openrouter/m1/high",
			session: "s1",
		});
		expect(controlPanelHeaderKey(fakeSession(undefined, "off", "manual", "s1")).model).toBe("//off");
		// Auto thinking resolves a level per turn; it must not refresh the header each turn.
		expect(controlPanelHeaderKey(fakeSession(model, "low", "auto", "s1")).model).toBe(
			controlPanelHeaderKey(fakeSession(model, "xhigh", "auto", "s1")).model,
		);

		// The readers follow the current session, which /new and /resume replace.
		let current = fakeSession(model, "high", "manual", "s1");
		const readers = controlPanelStatusReaders(() => current);
		expect(readers.headerKey?.()).toEqual({ model: "openrouter/m1/high", session: "s1" });
		current = fakeSession({ provider: "openrouter", id: "m2" }, "high", "manual", "s2");
		expect(readers.headerKey?.()).toEqual({ model: "openrouter/m2/high", session: "s2" });
	});
});
