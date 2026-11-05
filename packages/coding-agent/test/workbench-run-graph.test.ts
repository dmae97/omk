import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import * as authorityRuntime from "../src/core/verified-run/authority-runtime.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { projectRunGraph, RUN_GRAPH_VERSION, readRunGraph } from "../src/core/verified-run/workbench-run-graph.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "workbench-graph-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

async function start(fail = false, expected?: string) {
	const fixture = dagFixture(root, fail);
	if (expected !== undefined) fixture.contract.checks[0].stdout = expected;
	const digest = planVerifiedRun(fixture.contract).contractDigest;
	await fixture.coordinator.start(
		fixture.contract,
		{ ...fixture.command, contractDigest: digest },
		{ approvedContractDigest: digest },
	);
	return fixture;
}

describe("workbench observation bridge", () => {
	it("projects actual dependency edges, attempts and journal identity without changing the journal", async () => {
		const f = await start();
		const before = readFileSync(journalPath(f.runPath));
		const explanation = f.coordinator.explain("dag");
		const graph = projectRunGraph(explanation, authorityRuntime.inspectRunAuthority(f.stateRoot));
		expect(graph).toMatchObject({
			schemaVersion: RUN_GRAPH_VERSION,
			runtime: "node",
			graphKind: "verified-run",
			executionRequested: false,
			capabilities: { execute: false, amendGraph: false },
			runId: "dag",
			cursor: { revision: explanation.revision, generation: 1, ...explanation.binding },
			state: { execution: "succeeded", settlement: "settled", verification: "verified", publication: "none" },
			proofVerdict: "verified",
		});
		expect(graph.edges).toEqual([
			{ source: "left", target: "join", kind: "dependency" },
			{ source: "right", target: "join", kind: "dependency" },
		]);
		expect(graph.nodes.map((node) => [node.id, node.status, node.attempt, node.generation])).toEqual([
			["left", "succeeded", 1, 1],
			["right", "succeeded", 1, 1],
			["join", "succeeded", 1, 1],
		]);
		expect(Object.isFrozen(graph)).toBe(true);
		expect(Object.isFrozen(graph.nodes[0].dependsOn)).toBe(true);
		expect(Object.isFrozen(graph.edges[0])).toBe(true);
		expect(JSON.stringify(graph)).not.toContain(f.workspace);
		expect(readFileSync(journalPath(f.runPath))).toEqual(before);
	});

	it("never promotes successful task outputs to verified or published when a check fails", async () => {
		const f = await start(false, "wrong output");
		const graph = readRunGraph(f.stateRoot, "dag");
		expect(graph.nodes.every((node) => node.status === "succeeded")).toBe(true);
		expect(graph.state.verification).toBe("violated");
		expect(graph.proofVerdict).toBe("violated");
		expect(graph.state.publication).toBe("none");
	});

	it("preserves failed and pending tasks without manufacturing a running agent", async () => {
		const f = await start(true);
		const explanation = f.coordinator.explain("dag");
		const graph = readRunGraph(f.stateRoot, "dag");
		expect(graph.nodes.find((node) => node.id === "right")).toMatchObject({ status: "failed", attempt: 1 });
		expect(graph.nodes.find((node) => node.id === "join")).toMatchObject({ status: "pending", ready: false });
		expect(graph.proofVerdict).toBe("inconclusive");
		expect(graph.cursor.journalDigest).toBe(explanation.binding.journalDigest);
		expect(graph.capabilities.execute).toBe(false);
	});

	it("refuses a proof read spanning a committed authority update", async () => {
		const f = await start();
		const actual = authorityRuntime.inspectRunAuthority;
		const authority = actual(f.stateRoot);
		vi.spyOn(authorityRuntime, "inspectRunAuthority")
			.mockReturnValueOnce({ ...authority, records: [] })
			.mockReturnValueOnce(authority);
		expect(() => readRunGraph(f.stateRoot, "dag")).toThrow("integrity");
	});
});
