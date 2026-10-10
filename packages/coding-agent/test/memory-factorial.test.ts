import * as fs from "node:fs";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMemoryFactorial } from "../scripts/memory-factorial.ts";
import { memoryFactorialCli } from "../scripts/memory-factorial-cli.ts";
import {
	eligibleMemoryRecords,
	injectedMemoryEvidence,
	memoryFixture,
	solveVisibleEvidence,
} from "../scripts/memory-factorial-protocol.ts";
import { createFallbackTokenCounter } from "../src/core/context-budget-token-counter.ts";
import { memoryContextPair } from "../src/core/verified-memory-context.ts";
import { VerifiedMemoryStore } from "../src/core/verified-memory-store.ts";

vi.mock("node:fs", { spy: true });
const seeds = [42, 43, 44];
const temporaryRoots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sourceStore() {
	const root = mkdtempSync(join(tmpdir(), "omk-factorial-test-"));
	temporaryRoots.push(root);
	writeFileSync(join(root, "facts.txt"), "entityalpha = factone\nentitybeta = facttwo\n");
	const store = new VerifiedMemoryStore(root);
	return { root, store };
}

describe.skipIf(process.platform === "win32")("offline memory factorial experiment", () => {
	it("executes all four cells through reopened real storage without giving the solver gold", () => {
		const result = runMemoryFactorial({ tasks: 2, seeds });
		expect(result.rows).toHaveLength(24);
		expect(result.kind).toBe("offline-mechanism-check");
		for (const cell of result.cells) {
			expect(cell.evaluations).toBe(6);
			expect(cell.successRate).toBe(cell.regime === "dependent" && !cell.memory ? 0 : 1);
			expect(cell.writeCalls).toBe(cell.memory ? 6 : 0);
			expect(cell.retrieveCalls).toBe(cell.memory ? 6 : 0);
			expect(cell.selectionCalls).toBe(cell.memory ? 6 : 0);
		}
		const dependentOn = result.rows.filter((row) => row.regime === "dependent" && row.memory);
		expect(dependentOn.every((row) => row.selectedRecords === 1 && row.relevantRecords === 1)).toBe(true);
		expect(result.rows.every((row) => row.peakKvBytes === null)).toBe(true);
		expect(result.rows.every((row) => row.estimatedTotalTokens > 0)).toBe(true);
		expect(new Set(result.rows.map((row) => row.workspaceId)).size).toBe(24);
		expect(result.pairedDeltas.map((pair) => pair.successDelta)).toEqual([0, 1]);
	});

	it("pairs exactly the same base request and counterbalances execution order", () => {
		const { rows } = runMemoryFactorial({ tasks: 2, seeds });
		const pairs = new Map<string, typeof rows>();
		for (const row of rows) pairs.set(row.pairId, [...(pairs.get(row.pairId) ?? []), row]);
		let onFirst = 0;
		for (const pair of pairs.values()) {
			expect(pair).toHaveLength(2);
			expect(pair[0].baseInputHash).toBe(pair[1].baseInputHash);
			expect(pair[0].memory).not.toBe(pair[1].memory);
			if (pair[0].memory) onFirst++;
		}
		expect(onFirst).toBe(pairs.size / 2);
	});

	it("freezes earlier-session IDs and excludes late, current, future and foreign evidence", () => {
		const { root, store } = sourceStore();
		for (let i = 0; i < 5; i++)
			expect(store.remember({ path: "facts.txt", startLine: 1, endLine: 1 }).verdict).toBe("accept");
		const records = new VerifiedMemoryStore(root).retrieve().records;
		const references = records.map((record, index) => ({
			recordId: record.id,
			episodeId: index === 3 ? "foreign" : "episode",
			sessionIndex: [0, 1, 2, 0, 0][index],
		}));
		const boundary = {
			episodeId: "episode",
			sessionIndex: 1,
			frozenIds: new Set(records.slice(0, 4).map((r) => r.id)),
		};
		expect(eligibleMemoryRecords(records, references, boundary).map((r) => r.id)).toEqual([records[0].id]);
		expect(eligibleMemoryRecords(records, [], boundary)).toEqual([]);
		expect(() => eligibleMemoryRecords(records, [...references, references[0]], boundary)).toThrow(/duplicate/);
	});

	it("distinguishes reachable memory from injection when the memory budget is zero", () => {
		const result = runMemoryFactorial({ tasks: 1, seeds, memoryBudget: 0 });
		for (const row of result.rows.filter((row) => row.regime === "dependent" && row.memory)) {
			expect(row.recallReachable).toBe(true);
			expect(row.selectedRecords).toBe(0);
			expect(row.recallRelevance).toBeNull();
			expect(row.success).toBe(false);
		}
	});

	it.each([
		{ tasks: 0 },
		{ tasks: 1001 },
		{ tasks: 1.5 },
		{ seeds: [42, 43] },
		{ seeds: [42, 42, 43] },
		{ seeds: [42, 43, -1] },
		{ seeds: [42, 43, Number.NaN] },
		{ memoryBudget: -1 },
		{ memoryBudget: 2049 },
	])("refuses malformed or unbounded configuration %#", (config) => {
		expect(() => runMemoryFactorial(config)).toThrow(/invalid/);
	});

	it("keeps semantic outcomes reproducible without claiming timings or UUIDs are deterministic", () => {
		const semantic = (result: ReturnType<typeof runMemoryFactorial>) =>
			result.rows.map((row) => ({
				pair: row.pairId,
				hash: row.baseInputHash,
				memory: row.memory,
				success: row.success,
				reachable: row.recallReachable,
				selected: row.selectedRecords,
				relevant: row.relevantRecords,
			}));
		expect(semantic(runMemoryFactorial({ tasks: 1, seeds }))).toEqual(
			semantic(runMemoryFactorial({ tasks: 1, seeds })),
		);
	});

	it("cleans only owned temporary workspaces even after memory admission fails", () => {
		const before = readdirSync(tmpdir()).filter((name) => name.startsWith("omk-memory-factorial-"));
		vi.spyOn(VerifiedMemoryStore.prototype, "remember").mockReturnValue({ verdict: "abstain", reason: "fixture" });
		expect(() => runMemoryFactorial({ tasks: 1, seeds })).toThrow(/admission/);
		expect(readdirSync(tmpdir()).filter((name) => name.startsWith("omk-memory-factorial-"))).toEqual(before);
		const { root } = sourceStore();
		expect(existsSync(root)).toBe(true);
	});
	it("delivers only frozen evidence through the real V2 tool-pair adapter and respects source revocation", () => {
		const { root, store } = sourceStore();
		const fixture = memoryFixture(42, 0, "dependent");
		writeFileSync(join(root, "prior.txt"), fixture.priorEvidence);
		const admitted = store.remember({ path: "prior.txt", startLine: 1, endLine: 1 });
		if (admitted.verdict !== "accept") throw new Error("fixture admission");
		const refs = [{ recordId: admitted.recordId, episodeId: "episode", sessionIndex: 0 }];
		const boundary = { episodeId: "episode", sessionIndex: 1, frozenIds: new Set([admitted.recordId]) };
		writeFileSync(join(root, "late.txt"), `${fixture.baseInput.query}\n${fixture.priorEvidence}`);
		expect(store.remember({ path: "late.txt", startLine: 1, endLine: 2 }).verdict).toBe("accept");
		const records = eligibleMemoryRecords(new VerifiedMemoryStore(root).retrieve().records, refs, boundary);
		const messages = memoryContextPair(
			records,
			2048,
			fixture.baseInput.query,
			createFallbackTokenCounter(),
			"offline",
			{ mode: "v2" },
		).messages;
		expect(injectedMemoryEvidence(messages).map((item) => item.id)).toEqual([admitted.recordId]);
		expect(solveVisibleEvidence(fixture.baseInput.query, "", messages)).toBe(fixture.expected);
		expect(solveVisibleEvidence(fixture.baseInput.query, "", [])).toBe("unknown");
		expect(() => injectedMemoryEvidence(messages.slice(1))).toThrow(/pair/);
		const newer = fixture.priorEvidence.replace(fixture.expected, "fact000000000000");
		expect(solveVisibleEvidence(fixture.baseInput.query, newer, messages)).toBe("fact000000000000");
		store.forget(admitted.recordId);
		expect(eligibleMemoryRecords(new VerifiedMemoryStore(root).retrieve().records, refs, boundary)).toEqual([]);
	});

	it("runs the actual CLI, binds source hashes and refuses overwrites or extra arguments", () => {
		const report = memoryFactorialCli(["--tasks", "1", "--seeds", "42,43,44"]);
		temporaryRoots.push(join(report, ".."));
		const payload = JSON.parse(readFileSync(report, "utf8"));
		expect(payload.rows).toHaveLength(12);
		expect(payload.sourceHashes["memory-factorial.ts"]).toMatch(/^[a-f0-9]{64}$/);
		expect(() => memoryFactorialCli(["--tasks", "1", "--out", join(report, "..")])).toThrow(/EEXIST/);
		expect(() => memoryFactorialCli(["--unknown", "value"])).toThrow();
	});

	it("waits for the real clock to catch up without admitting future-dated fixture memory", () => {
		const epoch = Date.now();
		let current = epoch - 2500;
		vi.spyOn(Date, "now")
			.mockImplementationOnce(() => epoch)
			.mockImplementation(() => current);
		const pause = vi.spyOn(Atomics, "wait").mockImplementation(() => {
			current += 3000;
			return "timed-out";
		});
		const result = runMemoryFactorial({ tasks: 1, seeds });
		expect(pause).toHaveBeenCalled();
		expect(result.rows.filter((row) => row.memory).every((row) => row.selectedRecords === 1)).toBe(true);
	});
	it("accounts only for evaluation input and output, never an unexecuted setup response", () => {
		for (const row of runMemoryFactorial({ tasks: 1, seeds }).rows) {
			expect(row.estimatedTotalTokens).toBe(row.estimatedInputTokens + row.estimatedOutputTokens);
			expect(row.peakEstimatedCallTokens).toBe(row.estimatedTotalTokens);
		}
	});

	it("removes only a newly owned report directory after partial publication fails", async () => {
		const root = mkdtempSync(join(tmpdir(), "omk-factorial-publish-test-"));
		temporaryRoots.push(root);
		const out = join(root, "new-report");
		const originalWrite = (await vi.importActual<typeof fs>("node:fs")).writeFileSync;
		vi.spyOn(fs, "writeFileSync").mockImplementation((path, data, options) => {
			if (String(path).endsWith("results.json")) {
				originalWrite(path, "partial", options);
				throw new Error("injected report publication failure");
			}
			return originalWrite(path, data, options);
		});
		expect(() => memoryFactorialCli(["--tasks", "1", "--out", out])).toThrow(/publication/);
		expect(existsSync(out)).toBe(false);
		expect(existsSync(root)).toBe(true);
	});

	it.each(["42,,43", "42,43,", "42,43,4e1"])("refuses malformed CLI seed text %s", (value) => {
		expect(() => memoryFactorialCli(["--tasks", "1", "--seeds", value])).toThrow(/invalid/);
	});
});
