import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AdaptiveEdge,
	computeAdaptiveTopology,
	createFirstRunAdaptivePlan,
	detectOuroborosPreference,
	getAdaptivePlanPath,
	isHeadroomDisabled,
	OMK_STARTUP_DAG_EDGES,
	OMK_STARTUP_DAG_NODES,
	resolveAdaptiveHeadroomThreshold,
	shouldUseHeadroomBeforeLimit,
	writeFirstRunAdaptivePlan,
} from "../src/core/adaptive-runtime.ts";

// ============================================================================
// Temp dir helpers
// ============================================================================

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

// ============================================================================
// Headroom threshold
// ============================================================================

describe("resolveAdaptiveHeadroomThreshold", () => {
	it("defaults to 0.90", () => {
		expect(resolveAdaptiveHeadroomThreshold({})).toBe(0.9);
		expect(resolveAdaptiveHeadroomThreshold()).toBe(0.9);
	});

	it("reads OMK_HEADROOM_THRESHOLD as a fraction or percentage", () => {
		expect(resolveAdaptiveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "0.95" })).toBe(0.95);
		expect(resolveAdaptiveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "85" })).toBeCloseTo(0.85, 10);
	});

	it("clamps to [0.5, 0.99]", () => {
		expect(resolveAdaptiveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "0.1" })).toBe(0.5);
		expect(resolveAdaptiveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "0.999" })).toBe(0.99);
	});

	it("returns 0 when disabled via OMK_HEADROOM", () => {
		expect(resolveAdaptiveHeadroomThreshold({ OMK_HEADROOM: "off" })).toBe(0);
		expect(resolveAdaptiveHeadroomThreshold({ OMK_HEADROOM: "0" })).toBe(0);
		expect(resolveAdaptiveHeadroomThreshold({ OMK_HEADROOM: "false" })).toBe(0);
	});

	it("ignores unparseable overrides", () => {
		expect(resolveAdaptiveHeadroomThreshold({ OMK_HEADROOM_THRESHOLD: "abc" })).toBe(0.9);
	});
});

describe("isHeadroomDisabled", () => {
	it("detects disable flags", () => {
		expect(isHeadroomDisabled({ OMK_HEADROOM: "OFF" })).toBe(true);
		expect(isHeadroomDisabled({ OMK_HEADROOM: "no" })).toBe(true);
		expect(isHeadroomDisabled({ OMK_HEADROOM: "on" })).toBe(false);
		expect(isHeadroomDisabled({})).toBe(false);
	});
});

describe("shouldUseHeadroomBeforeLimit", () => {
	it("is true when enabled and utilization meets the threshold", () => {
		expect(shouldUseHeadroomBeforeLimit(90000, 100000, {})).toBe(true);
		expect(shouldUseHeadroomBeforeLimit(89999, 100000, {})).toBe(false);
	});

	it("respects the threshold override", () => {
		expect(shouldUseHeadroomBeforeLimit(80000, 100000, { OMK_HEADROOM_THRESHOLD: "0.8" })).toBe(true);
		expect(shouldUseHeadroomBeforeLimit(79999, 100000, { OMK_HEADROOM_THRESHOLD: "0.8" })).toBe(false);
	});

	it("is false when disabled", () => {
		expect(shouldUseHeadroomBeforeLimit(99000, 100000, { OMK_HEADROOM: "off" })).toBe(false);
	});

	it("is false for invalid inputs", () => {
		expect(shouldUseHeadroomBeforeLimit(90000, 0, {})).toBe(false);
		expect(shouldUseHeadroomBeforeLimit(-1, 100000, {})).toBe(false);
		expect(shouldUseHeadroomBeforeLimit(90000, Number.NaN, {})).toBe(false);
	});
});

// ============================================================================
// Topology routing
// ============================================================================

describe("computeAdaptiveTopology", () => {
	it("classifies a single node as singleton", () => {
		const decision = computeAdaptiveTopology(["a"], []);
		expect(decision.topology).toBe("singleton");
		expect(decision.features.width).toBe(1);
		expect(decision.features.criticalDepth).toBe(1);
		expect(decision.waves).toEqual([["a"]]);
		expect(decision.hasCycle).toBe(false);
	});

	it("classifies an empty DAG as dag", () => {
		const decision = computeAdaptiveTopology([], []);
		expect(decision.topology).toBe("dag");
		expect(decision.features.nodeCount).toBe(0);
		expect(decision.features.width).toBe(0);
		expect(decision.waves).toEqual([]);
	});

	it("classifies a linear chain (startup DAG) as pipeline", () => {
		const decision = computeAdaptiveTopology(OMK_STARTUP_DAG_NODES, OMK_STARTUP_DAG_EDGES);
		expect(decision.topology).toBe("pipeline");
		expect(decision.features.width).toBe(1);
		expect(decision.features.criticalDepth).toBe(4);
		expect(decision.features.couplingDensity).toBeCloseTo(0.5, 10);
		expect(decision.features.parallelRatio).toBeCloseTo(0.25, 10);
		expect(decision.waves).toEqual([["session_start"], ["resources_discover"], ["model_select"], ["run_loop"]]);
	});

	it("classifies a fan-out/fan-in low-coupling DAG as map_reduce", () => {
		const nodes = ["root", "m1", "m2", "m3", "m4", "m5", "m6", "sink"];
		const edges: AdaptiveEdge[] = [];
		for (const m of ["m1", "m2", "m3", "m4", "m5", "m6"]) {
			edges.push({ from: "root", to: m });
			edges.push({ from: m, to: "sink" });
		}
		const decision = computeAdaptiveTopology(nodes, edges);
		expect(decision.topology).toBe("map_reduce");
		expect(decision.features.width).toBe(6);
		expect(decision.features.criticalDepth).toBe(3);
	});

	it("classifies independent wide chains as parallel", () => {
		const decision = computeAdaptiveTopology(
			["a", "b", "c", "d"],
			[
				{ from: "a", to: "c" },
				{ from: "b", to: "d" },
			],
		);
		expect(decision.topology).toBe("parallel");
		expect(decision.features.width).toBe(2);
	});

	it("classifies wide + high coupling as hybrid", () => {
		const decision = computeAdaptiveTopology(
			["root", "a", "b", "c", "sink"],
			[
				{ from: "root", to: "a" },
				{ from: "root", to: "b" },
				{ from: "root", to: "c" },
				{ from: "a", to: "sink" },
				{ from: "b", to: "sink" },
				{ from: "c", to: "sink" },
			],
		);
		expect(decision.features.couplingDensity).toBeCloseTo(0.6, 10);
		expect(decision.topology).toBe("hybrid");
	});

	it("guards against cycles", () => {
		const decision = computeAdaptiveTopology(
			["a", "b", "c"],
			[
				{ from: "a", to: "b" },
				{ from: "b", to: "c" },
				{ from: "c", to: "a" },
			],
		);
		expect(decision.hasCycle).toBe(true);
		expect(decision.topology).toBe("dag");
		// Unresolved cyclic nodes are still surfaced.
		expect(decision.waves.flat().sort()).toEqual(["a", "b", "c"]);
	});

	it("treats self loops as cycles", () => {
		const decision = computeAdaptiveTopology(
			["a", "b"],
			[
				{ from: "a", to: "a" },
				{ from: "a", to: "b" },
			],
		);
		expect(decision.hasCycle).toBe(true);
		expect(decision.features.edgeCount).toBe(1);
	});

	it("ignores dangling edges and de-duplicates edges", () => {
		const decision = computeAdaptiveTopology(
			["a", "b"],
			[
				{ from: "a", to: "b" },
				{ from: "a", to: "b" },
				{ from: "a", to: "z" },
				{ from: "x", to: "b" },
			],
		);
		expect(decision.features.edgeCount).toBe(1);
		expect(decision.hasCycle).toBe(false);
	});
});

// ============================================================================
// Ouroboros preference detection
// ============================================================================

function seedOuroborosAgentDir(): string {
	const agentDir = makeTempDir("omk-agent");
	writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { ouroboros: {}, memory: {} } }), "utf-8");
	mkdirSync(join(agentDir, "skills", "ouroboros-auto"), { recursive: true });
	return agentDir;
}

describe("detectOuroborosPreference", () => {
	it("prefers ouroboros when indicators exist (default mode always)", () => {
		const agentDir = seedOuroborosAgentDir();
		const home = makeTempDir("omk-home"); // no ~/.local/bin/ouroboros
		const pref = detectOuroborosPreference({ env: {}, agentDir, home });
		expect(pref.mode).toBe("always");
		expect(pref.indicators.mcp).toBe(true);
		expect(pref.indicators.skills).toBe(true);
		expect(pref.indicators.binary).toBe(false);
		expect(pref.available).toBe(true);
		expect(pref.preferred).toBe(true);
		expect(pref.fallback).toBe("ouroboros");
	});

	it("falls back to native when disabled, even if available", () => {
		const agentDir = seedOuroborosAgentDir();
		const home = makeTempDir("omk-home");
		const pref = detectOuroborosPreference({ env: { OMK_OUROBOROS: "off" }, agentDir, home });
		expect(pref.mode).toBe("off");
		expect(pref.available).toBe(true);
		expect(pref.preferred).toBe(false);
		expect(pref.fallback).toBe("native");
	});

	it("detects the binary indicator via the injected exists", () => {
		const pref = detectOuroborosPreference({
			env: {},
			home: "/fake/home",
			exists: (path) => path === join("/fake/home", ".local", "bin", "ouroboros"),
		});
		expect(pref.indicators.binary).toBe(true);
		expect(pref.indicators.mcp).toBe(false);
		expect(pref.indicators.skills).toBe(false);
		expect(pref.preferred).toBe(true);
	});

	it("is unavailable (native) when no indicators are present", () => {
		const home = makeTempDir("omk-home");
		const agentDir = makeTempDir("omk-agent");
		const pref = detectOuroborosPreference({ env: { OMK_OUROBOROS: "auto" }, agentDir, home });
		expect(pref.mode).toBe("auto");
		expect(pref.available).toBe(false);
		expect(pref.preferred).toBe(false);
		expect(pref.fallback).toBe("native");
	});

	it("never throws on bad input", () => {
		expect(() => detectOuroborosPreference()).not.toThrow();
		expect(() =>
			detectOuroborosPreference({
				agentDir: "/nonexistent/agent/dir",
				home: "/nonexistent/home",
			}),
		).not.toThrow();
	});
});

// ============================================================================
// First-run adaptive plan
// ============================================================================

describe("createFirstRunAdaptivePlan", () => {
	it("produces a JSON-serializable plan with the startup topology", () => {
		const home = makeTempDir("omk-home");
		const plan = createFirstRunAdaptivePlan({
			env: {},
			home,
			cwd: "/work/dir",
			now: () => 0,
		});

		expect(plan.version).toBe(1);
		expect(plan.runtime).toBe("omk-parallel-orchestrator");
		expect(plan.createdAt).toBe("1970-01-01T00:00:00.000Z");
		expect(plan.cwd).toBe("/work/dir");
		expect(plan.topology.topology).toBe("pipeline");
		expect(plan.headroom).toEqual({ enabled: true, threshold: 0.9 });

		// Round-trips through JSON without loss.
		expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
	});

	it("reflects headroom overrides and disable", () => {
		const home = makeTempDir("omk-home");
		const overridden = createFirstRunAdaptivePlan({ env: { OMK_HEADROOM_THRESHOLD: "0.95" }, home });
		expect(overridden.headroom).toEqual({ enabled: true, threshold: 0.95 });

		const disabled = createFirstRunAdaptivePlan({ env: { OMK_HEADROOM: "off" }, home });
		expect(disabled.headroom).toEqual({ enabled: false, threshold: 0.9 });
	});
});

describe("writeFirstRunAdaptivePlan", () => {
	it("creates the artifact, skips when present, and refreshes on demand", () => {
		const agentDir = makeTempDir("omk-agent");
		const home = makeTempDir("omk-home");
		const planPath = getAdaptivePlanPath(agentDir);
		expect(planPath).toBe(join(agentDir, "runs", "adaptive-runtime-plan.json"));

		const created = writeFirstRunAdaptivePlan({ agentDir, env: {}, home, now: () => 0 });
		expect(created.written).toBe(true);
		expect(created.reason).toBe("created");
		expect(existsSync(planPath)).toBe(true);

		const parsed = JSON.parse(readFileSync(planPath, "utf-8"));
		expect(parsed.version).toBe(1);
		expect(parsed.topology.topology).toBe("pipeline");

		const skipped = writeFirstRunAdaptivePlan({ agentDir, env: {}, home });
		expect(skipped.written).toBe(false);
		expect(skipped.reason).toBe("exists");

		const refreshed = writeFirstRunAdaptivePlan({ agentDir, env: {}, home, refresh: true });
		expect(refreshed.written).toBe(true);
		expect(refreshed.reason).toBe("refreshed");

		const envRefreshed = writeFirstRunAdaptivePlan({
			agentDir,
			env: { OMK_ADAPTIVE_PLAN_REFRESH: "1" },
			home,
		});
		expect(envRefreshed.written).toBe(true);
		expect(envRefreshed.reason).toBe("refreshed");
	});

	it("is non-fatal when the target path is invalid", () => {
		// A file where the runs directory should be makes mkdir fail.
		const agentDir = makeTempDir("omk-agent");
		writeFileSync(join(agentDir, "runs"), "not a directory", "utf-8");
		const result = writeFirstRunAdaptivePlan({ agentDir, env: {} });
		expect(result.written).toBe(false);
		expect(result.reason).toBe("error");
		expect(typeof result.error).toBe("string");
	});
});
