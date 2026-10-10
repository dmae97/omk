import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { AgentMessage } from "omk-agent-core";
import { createFallbackTokenCounter } from "../src/core/context-budget-token-counter.ts";
import { memoryContextPair } from "../src/core/verified-memory-context.ts";
import { memoryMatches, memoryQueryTerms } from "../src/core/verified-memory-score.ts";
import { memoryWorkspace } from "../src/core/verified-memory-source.ts";
import { VerifiedMemoryStore } from "../src/core/verified-memory-store.ts";
import {
	eligibleMemoryRecords,
	injectedMemoryEvidence,
	type MemoryExperimentRow,
	type MemoryReference,
	type MemoryRegime,
	memoryFixture,
	solveVisibleEvidence,
} from "./memory-factorial-protocol.ts";

export interface MemoryFactorialOptions {
	readonly tasks?: number;
	readonly seeds?: readonly number[];
	readonly memoryBudget?: number;
}
const regimes: readonly MemoryRegime[] = ["independent", "dependent"];
const counter = createFallbackTokenCounter();
const modelId = "offline-rule-solver-v1";
const tokens = (text: string) => counter.countText(text, modelId).tokens;

// Fixture-only recovery: preserve the store's real-clock guard and bound time spent waiting.
function waitForClock(target: number): number {
	const started = performance.now();
	const pause = new Int32Array(new SharedArrayBuffer(4));
	let waited = false;
	while (Date.now() < target) {
		if (performance.now() - started >= 5000) throw new Error("fixture clock did not recover");
		Atomics.wait(pause, 0, 0, 50);
		waited = true;
	}
	return waited ? performance.now() - started : 0;
}
function runEpisode(
	seed: number,
	index: number,
	regime: MemoryRegime,
	memory: boolean,
	budget: number,
): MemoryExperimentRow {
	const root = mkdtempSync(join(tmpdir(), "omk-memory-factorial-"));
	try {
		const started = performance.now();
		const fixture = memoryFixture(seed, index, regime);
		const pairId = `${seed}:${index}:${regime}`;
		const workspaceId = memoryWorkspace(root).id;
		const references: MemoryReference[] = [];
		let writeCalls = 0;
		let retrieveCalls = 0;
		let selectionCalls = 0;
		let eligibleRecords = 0;
		let recallReachable = false;
		let clockWaitMs = 0;
		let messages: AgentMessage[] = [];
		if (memory) {
			writeFileSync(join(root, "prior.txt"), fixture.priorEvidence, { mode: 0o600 });
			writeCalls++;
			const admissionClock = Date.now();
			const admissionStarted = performance.now();
			const admission = new VerifiedMemoryStore(root).remember({ path: "prior.txt", startLine: 1, endLine: 1 });
			if (admission.verdict !== "accept") throw new Error(`memory admission failed: ${admission.reason}`);
			references.push({ recordId: admission.recordId, episodeId: pairId, sessionIndex: 0 });
			const boundary = {
				episodeId: pairId,
				sessionIndex: 1,
				frozenIds: new Set(references.map((ref) => ref.recordId)),
			};
			clockWaitMs = waitForClock(
				Math.max(admissionClock + Math.ceil(performance.now() - admissionStarted), Date.now()),
			);
			retrieveCalls++;
			const recalled = new VerifiedMemoryStore(root).retrieve();
			if (recalled.omitted !== 0 || recalled.records.length !== references.length)
				throw new Error("memory recall unavailable");
			const records = eligibleMemoryRecords(recalled.records, references, boundary);
			eligibleRecords = records.length;
			recallReachable = records.some(
				(record) => memoryMatches(record, memoryQueryTerms(fixture.baseInput.query)).size > 0,
			);
			selectionCalls++;
			messages = memoryContextPair(records, budget, fixture.baseInput.query, counter, modelId, {
				mode: "v2",
			}).messages;
		}
		const injected = injectedMemoryEvidence(messages);
		const relevantRecords = injected.filter((item) => item.quote === fixture.priorEvidence).length;
		const answer = solveVisibleEvidence(fixture.baseInput.query, fixture.baseInput.currentEvidence, messages);
		const estimatedInputTokens = tokens(JSON.stringify({ ...fixture.baseInput, messages }));
		const estimatedOutputTokens = tokens(answer);
		return {
			pairId,
			seed,
			regime,
			memory,
			workspaceId,
			baseInputHash: fixture.baseInputHash,
			success: answer === fixture.expected,
			writeCalls,
			retrieveCalls,
			selectionCalls,
			eligibleRecords,
			selectedRecords: injected.length,
			relevantRecords,
			recallReachable,
			recallRelevance: injected.length === 0 ? null : relevantRecords / injected.length,
			estimatedInputTokens,
			estimatedOutputTokens,
			estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens,
			peakEstimatedCallTokens: estimatedInputTokens + estimatedOutputTokens,
			peakKvBytes: null,
			clockWaitMs,
			elapsedMs: performance.now() - started,
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

export function runMemoryFactorial(options: MemoryFactorialOptions = {}) {
	const tasks = options.tasks ?? 100;
	const seeds = options.seeds ?? [42, 43, 44];
	const memoryBudget = options.memoryBudget ?? 2048;
	if (
		!Number.isSafeInteger(tasks) ||
		tasks < 1 ||
		tasks > 1000 ||
		seeds.length < 3 ||
		seeds.length > 10 ||
		new Set(seeds).size !== seeds.length ||
		seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0) ||
		!Number.isSafeInteger(memoryBudget) ||
		memoryBudget < 0 ||
		memoryBudget > 2048
	)
		throw new Error("invalid factorial configuration");
	const rows: MemoryExperimentRow[] = [];
	for (const [seedIndex, seed] of seeds.entries()) {
		for (let index = 0; index < tasks; index++) {
			for (const [regimeIndex, regime] of regimes.entries()) {
				const order = (index + seedIndex + regimeIndex) % 2 === 0 ? [false, true] : [true, false];
				for (const memory of order) rows.push(runEpisode(seed, index, regime, memory, memoryBudget));
			}
		}
	}
	const cells = regimes.flatMap((regime) =>
		[false, true].map((memory) => {
			const selected = rows.filter((row) => row.regime === regime && row.memory === memory);
			const sum = (
				field:
					| "writeCalls"
					| "retrieveCalls"
					| "selectionCalls"
					| "estimatedTotalTokens"
					| "selectedRecords"
					| "relevantRecords",
			) => selected.reduce((total, row) => total + row[field], 0);
			return {
				regime,
				memory,
				evaluations: selected.length,
				successRate: selected.filter((row) => row.success).length / selected.length,
				writeCalls: sum("writeCalls"),
				retrieveCalls: sum("retrieveCalls"),
				selectionCalls: sum("selectionCalls"),
				recallReachability: selected.filter((row) => row.recallReachable).length / selected.length,
				injectionRate: selected.filter((row) => row.selectedRecords > 0).length / selected.length,
				recallRelevance: sum("selectedRecords") === 0 ? null : sum("relevantRecords") / sum("selectedRecords"),
				estimatedTotalTokens: sum("estimatedTotalTokens"),
				peakEstimatedCallTokens: Math.max(...selected.map((row) => row.peakEstimatedCallTokens)),
				peakKvBytes: null,
				perSeed: seeds.map((seed) => {
					const sample = selected.filter((row) => row.seed === seed);
					return { seed, successRate: sample.filter((row) => row.success).length / sample.length };
				}),
			};
		}),
	);
	const pairedDeltas = regimes.map((regime) => {
		const off = new Map(rows.filter((row) => row.regime === regime && !row.memory).map((row) => [row.pairId, row]));
		const deltas = rows
			.filter((row) => row.regime === regime && row.memory)
			.map((row) => {
				const peer = off.get(row.pairId);
				if (!peer || peer.baseInputHash !== row.baseInputHash) throw new Error("unpaired factorial input");
				return Number(row.success) - Number(peer.success);
			});
		return {
			regime,
			pairs: deltas.length,
			successDelta: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
		};
	});
	return {
		schemaVersion: 1,
		kind: "offline-mechanism-check",
		configuration: { tasks, seeds, memoryBudget },
		tokenAccounting: "fallback-estimate-evaluation-only-not-provider-usage",
		solver: modelId,
		limitations: [
			"Deterministic two-session fixtures, not LLM performance or SCM/PESCO validation.",
			"Seeds vary facts, not stochastic inference. No inferential confidence interval or significance claim.",
			"Single-record retrieval does not measure distractor ranking, long-session scaling or accelerator KV.",
		],
		cells,
		pairedDeltas,
		rows,
	};
}
