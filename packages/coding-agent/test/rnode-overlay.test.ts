import { join, resolve } from "node:path";
import { visibleWidth } from "omk-tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { VerifiedRunError } from "../src/core/verified-run/storage.ts";
import type { RunGraphSnapshot } from "../src/core/verified-run/workbench-run-graph.ts";
import {
	type ControlPanelContent,
	renderControlPanelLayout,
	renderControlPanelRightPane,
} from "../src/modes/interactive/components/control-panel-layout.ts";
import { handleRNodeInput, parseRNodeCommand, runRNodeCommand } from "../src/modes/interactive/rnode/rnode-command.ts";
import { RNodeController } from "../src/modes/interactive/rnode/rnode-controller.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const D = (c: string) => c.repeat(64);

function snapshot(revision: number, status: "pending" | "running" = "pending"): RunGraphSnapshot {
	return {
		schemaVersion: "omk.run-graph.v1",
		runtime: "node",
		graphKind: "verified-run",
		executionRequested: false,
		capabilities: { execute: false, amendGraph: false },
		runId: "dag-1",
		cursor: {
			journalDigest: D(String(revision)),
			contractDigest: D("b"),
			candidateDigest: null,
			receiptDigest: null,
			environmentDigest: null,
			revision,
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
		nodes: [{ id: "fetch", dependsOn: [], status, attempt: 1, generation: 1, ready: status === "pending" }],
		edges: [],
	};
}

function host() {
	return { status: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() };
}

const CONTEXT = { agentDir: "/agent", cwd: "/work", expandKey: "ctrl+o" };

describe("parseRNodeCommand", () => {
	test("parses bind, status and off, and ignores other commands", () => {
		expect(parseRNodeCommand("/rnode")).toEqual({ kind: "status" });
		expect(parseRNodeCommand("/rnode off")).toEqual({ kind: "off" });
		expect(parseRNodeCommand("/rnode dag-1")).toEqual({ kind: "bind", runId: "dag-1", stateDir: undefined });
		expect(parseRNodeCommand("/rnode dag-1 --state-dir ./runs")).toEqual({
			kind: "bind",
			runId: "dag-1",
			stateDir: "./runs",
		});
		expect(parseRNodeCommand("/rnodes dag-1")).toBeUndefined();
		expect(parseRNodeCommand("hello /rnode")).toBeUndefined();
	});

	test("rejects path-like run ids and stray arguments before any read", () => {
		for (const text of ["/rnode ../x", "/rnode -x", "/rnode a/b"]) {
			expect(parseRNodeCommand(text)).toEqual({ kind: "usage", problem: "invalid run id" });
		}
		for (const text of ["/rnode dag-1 --state-dir", "/rnode dag-1 --execute", "/rnode dag-1 --state-dir a b"]) {
			expect(parseRNodeCommand(text)).toEqual({ kind: "usage", problem: "unexpected arguments" });
		}
	});
});

describe("RNodeController", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("reads once on bind, polls while bound and stops after off", () => {
		vi.useFakeTimers();
		const frames = [snapshot(1), snapshot(1), snapshot(2, "running")];
		const read = vi.fn(() => frames[Math.min(read.mock.calls.length - 1, frames.length - 1)] as RunGraphSnapshot);
		const changed = vi.fn();
		const controller = new RNodeController({ changed, read, intervalMs: 100 });

		controller.bind({ runId: "dag-1", stateRoot: "/runs" });
		expect(read).toHaveBeenCalledWith("/runs", "dag-1");
		expect(controller.panelInput()).toMatchObject({ runId: "dag-1", revision: 1 });

		vi.advanceTimersByTime(100);
		vi.advanceTimersByTime(100);
		expect(controller.panelInput()).toMatchObject({ revision: 2 });
		const changesWhileBound = changed.mock.calls.length;

		controller.clear();
		expect(controller.panelInput()).toBeUndefined();
		vi.advanceTimersByTime(1000);
		expect(read).toHaveBeenCalledTimes(3);
		expect(changed).toHaveBeenCalledTimes(changesWhileBound + 1);
	});

	test("does not repaint for a repeated identical frame", () => {
		const controller = new RNodeController({ changed: vi.fn(), read: () => snapshot(1) });
		controller.bind({ runId: "dag-1", stateRoot: "/runs" });
		controller.refresh();
		expect(controller.refresh()).toBe(false);
		controller.dispose();
	});

	test("keeps the last snapshot and reports a code, not a raw message, when a read fails", () => {
		let fail = false;
		const read = () => {
			if (fail) throw Object.assign(new Error("ENOENT: /home/someone/private/journal"), { code: "ENOENT" });
			return snapshot(1);
		};
		const controller = new RNodeController({ changed: vi.fn(), read });
		controller.bind({ runId: "dag-1", stateRoot: "/runs" });
		fail = true;
		expect(controller.refresh()).toBe(true);
		expect(controller.failure).toBe("ENOENT");
		expect(controller.panelInput()).toMatchObject({ revision: 1, feed: { state: "stale", label: "unreadable" } });
		controller.dispose();
	});

	test("shows the bound run as pending when no snapshot was ever read", () => {
		const read = () => {
			throw new VerifiedRunError("run_missing");
		};
		const controller = new RNodeController({ changed: vi.fn(), read });
		controller.bind({ runId: "dag-9", stateRoot: "/runs" });
		expect(controller.failure).toBe("run_missing");
		expect(controller.panelInput()).toEqual({ runId: "dag-9", feed: { state: "stale", label: "unreadable" } });
		controller.dispose();
	});
});

describe("runRNodeCommand", () => {
	test("binds to the CLI default state root, or a cwd-relative --state-dir", () => {
		const read = vi.fn(() => snapshot(1));
		const controller = new RNodeController({ changed: vi.fn(), read });
		const h = host();
		runRNodeCommand({ kind: "bind", runId: "dag-1", stateDir: undefined }, controller, h, CONTEXT);
		expect(read).toHaveBeenLastCalledWith(join("/agent", "verified-runs"), "dag-1");
		expect(h.status.mock.calls[0]?.[0]).toContain("ctrl+o");
		runRNodeCommand({ kind: "bind", runId: "dag-1", stateDir: "runs" }, controller, h, CONTEXT);
		expect(read).toHaveBeenLastCalledWith(resolve("/work", "runs"), "dag-1");
		runRNodeCommand({ kind: "status" }, controller, h, CONTEXT);
		expect(h.status.mock.calls.at(-1)?.[0]).toContain("last read ok");
		runRNodeCommand({ kind: "off" }, controller, h, CONTEXT);
		expect(controller.target).toBeUndefined();
		controller.dispose();
	});

	test("reports usage problems and failed first reads as errors", () => {
		const controller = new RNodeController({
			changed: vi.fn(),
			read: () => {
				throw new VerifiedRunError("run_missing");
			},
		});
		const h = host();
		runRNodeCommand({ kind: "usage", problem: "invalid run id" }, controller, h, CONTEXT);
		runRNodeCommand({ kind: "bind", runId: "dag-1", stateDir: undefined }, controller, h, CONTEXT);
		expect(h.error.mock.calls.map((call) => call[0])).toEqual([
			expect.stringContaining("invalid run id"),
			expect.stringContaining("First read failed: run_missing"),
		]);
		controller.dispose();
	});
});

describe("handleRNodeInput", () => {
	test("passes ordinary input through without reading the session cwd", () => {
		const controller = new RNodeController({ changed: vi.fn(), read: () => snapshot(1) });
		const cwd = vi.fn(() => "/work");
		expect(handleRNodeInput("hello", controller, host(), cwd)).toBe(false);
		expect(handleRNodeInput("/rnodes x", controller, host(), cwd)).toBe(false);
		expect(cwd).not.toHaveBeenCalled();
		expect(handleRNodeInput("/rnode dag-1 --state-dir runs", controller, host(), cwd)).toBe(true);
		expect(cwd).toHaveBeenCalledTimes(1);
		expect(controller.target).toEqual({ runId: "dag-1", stateRoot: resolve("/work", "runs") });
		controller.dispose();
	});
});

describe("control pane overlay", () => {
	beforeAll(() => {
		initTheme("omk-control-grid-dark");
	});

	function content(rnode: ControlPanelContent["rnode"]): ControlPanelContent {
		return {
			appName: "omk",
			version: "1.5.10",
			compactInstructions: () => "",
			expandedInstructions: () => "",
			compactOnboarding: () => "",
			onboarding: () => "",
			rnode,
		};
	}

	const controller = new RNodeController({ changed: () => {}, read: () => snapshot(1) });
	controller.bind({ runId: "dag-1", stateRoot: "/runs" });
	const bound = content(() => controller.panelInput());

	test("adds R·NODE inside the pane frame only when a run is bound", () => {
		const unbound = renderControlPanelRightPane(
			content(() => undefined),
			38,
		).map(stripAnsi);
		expect(unbound.join("\n")).not.toContain("R·NODE");
		const lines = renderControlPanelRightPane(bound, 38).map(stripAnsi);
		const text = lines.join("\n");
		expect(text).toContain("R·NODE");
		expect(text).toContain("dag-1 · rev 1 · gen 1");
		expect(text).toContain("? ready");
		expect(lines.at(-1)).toMatch(/^└─+┘$/);
		expect(lines.findIndex((line) => line.includes("SESSION"))).toBeLessThan(
			lines.findIndex((line) => line.includes("R·NODE")),
		);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(38);
		// Rule, 7 header rows, one layer rule and one node.
		expect(lines.length).toBe(unbound.length + 10);
	});

	test("takes only the rows the terminal leaves and keeps the frame closed", () => {
		const railRows = renderControlPanelRightPane(
			content(() => undefined),
			38,
		).length;
		for (const rows of [railRows + 3, railRows + 6]) {
			const lines = renderControlPanelRightPane(bound, 38, rows).map(stripAnsi);
			expect(lines).toHaveLength(rows);
			expect(lines.at(-1)).toMatch(/^└─+┘$/);
			expect(lines.join("\n")).toContain("R·NODE");
		}
		const cramped = renderControlPanelRightPane(bound, 38, railRows + 1).map(stripAnsi);
		expect(cramped).toHaveLength(railRows);
		expect(cramped.join("\n")).not.toContain("R·NODE");
	});

	test("never reaches the scrollback header", () => {
		for (const expanded of [false, true]) {
			for (const width of [90, 120, 160]) {
				const header = renderControlPanelLayout(bound, expanded, width).map(stripAnsi).join("\n");
				expect(header).not.toContain("R·NODE");
			}
		}
	});
});
