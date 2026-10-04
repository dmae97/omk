import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptOrchClient } from "../src/adaptorch-client.ts";
import { type MissingReviewInput, ReviewWorkflow } from "../src/review-workflow.ts";
import { reviewFixture, SyntheticReviewStore } from "./review-fixtures.ts";

const audit = (runId = "r1"): MissingReviewInput => ({
	code: "MISSING_REVIEW_INPUT",
	source: "caller_input_audit",
	runId,
	missingEvidenceIds: ["test:edge"],
});
const withNewEvidence = () => {
	const input = reviewFixture();
	return {
		...input,
		tests: [
			...input.tests,
			{ ...input.tests[0], id: "edge", command: "npm test -- edge", output: "boundary tests passed" },
		],
	};
};
function setup() {
	let count = 0;
	const callTool = vi.fn(async (name: string) => {
		if (name === "adaptorch_run") return { run_id: `r${++count}`, status: "QUEUED" };
		if (name === "adaptorch_get_run") return { run_id: "r1", status: "SUCCEEDED" };
		if (name === "adaptorch_get_artifacts") return [];
		if (name === "adaptorch_get_traces") return [];
		throw new Error("unexpected tool");
	});
	const store = new SyntheticReviewStore();
	const client = new AdaptOrchClient({ callTool });
	return { store, client, callTool, workflow: new ReviewWorkflow({ store, client }) };
}
afterEach(() => vi.useRealTimers());

describe("durable explicit review workflow (synthetic, no providers)", () => {
	it("submits asynchronously and resumes with get_run without duplicate submission", async () => {
		const { workflow, callTool } = setup();
		expect(await workflow.submit(reviewFixture())).toMatchObject({
			state: "submitted",
			runId: "r1",
			canApply: false,
			shouldSubmit: false,
		});
		expect(callTool.mock.calls[0]).toEqual([
			"adaptorch_run",
			expect.objectContaining({
				wait_for_terminal: false,
				synthesis_mode: "robust",
				payload: expect.objectContaining({ subtasks: expect.any(Array) }),
			}),
		]);
		expect(await workflow.resume("synthetic-packet", "spec-v1")).toMatchObject({
			state: "terminal",
			summary: { status: "SUCCEEDED" },
			canApply: false,
			shouldSubmit: false,
		});
		expect(callTool.mock.calls.filter(([name]) => name === "adaptorch_run")).toHaveLength(1);
	});
	it("deduplicates simultaneous submit calls and restart using the same durable journal", async () => {
		const { store, client, workflow, callTool } = setup();
		await Promise.all([
			workflow.submit(reviewFixture()),
			new ReviewWorkflow({ store, client }).submit(reviewFixture()),
		]);
		expect(await new ReviewWorkflow({ store, client }).submit(reviewFixture())).toMatchObject({ runId: "r1" });
		expect(callTool.mock.calls.filter(([name]) => name === "adaptorch_run")).toHaveLength(1);
	});
	it("requires the durable store before any transport call", () => {
		const { client, callTool } = setup();
		expect(() => new ReviewWorkflow({ client, store: undefined! })).toThrow("durable");
		expect(callTool).not.toHaveBeenCalled();
	});
	it("does not submit if persistence fails", async () => {
		const { client, callTool, store } = setup();
		store.compareAndSwap = async () => {
			throw new Error("disk full");
		};
		await expect(new ReviewWorkflow({ client, store }).submit(reviewFixture())).rejects.toThrow("disk full");
		expect(callTool).not.toHaveBeenCalled();
	});
	it("never blindly retries rejected or malformed admission responses", async () => {
		for (const raw of [undefined, {}, { run_id: "" }]) {
			const callTool = vi.fn(async () => raw);
			const client = new AdaptOrchClient({ callTool });
			const store = new SyntheticReviewStore();
			expect(await new ReviewWorkflow({ client, store }).submit(reviewFixture())).toMatchObject({
				state: "submission_unknown",
			});
			expect(await new ReviewWorkflow({ client, store }).submit(reviewFixture())).toMatchObject({
				state: "submission_unknown",
			});
			expect(callTool).toHaveBeenCalledTimes(1);
		}
	});
	it("records late run ID after observation timeout without resubmitting", async () => {
		vi.useFakeTimers();
		let resolve!: (value: unknown) => void;
		const callTool = vi.fn(
			() =>
				new Promise<unknown>((r) => {
					resolve = r;
				}),
		);
		const store = new SyntheticReviewStore();
		const client = new AdaptOrchClient({ callTool });
		const workflow = new ReviewWorkflow({ client, store, submitTimeoutMs: 10 });
		const pending = workflow.submit(reviewFixture());
		await vi.advanceTimersByTimeAsync(11);
		expect(await pending).toMatchObject({ state: "submission_unknown" });
		expect(await new ReviewWorkflow({ client, store }).submit(reviewFixture())).toMatchObject({
			state: "submission_unknown",
		});
		resolve({ run_id: "late-run", status: "QUEUED" });
		await vi.advanceTimersByTimeAsync(0);
		expect(await workflow.submit(reviewFixture())).toMatchObject({ runId: "late-run" });
		expect(callTool).toHaveBeenCalledTimes(1);
	});
	it("allows exactly one fresh-input retry, durably including concurrent callers and restart", async () => {
		const { client, store, workflow, callTool } = setup();
		await workflow.submit(reviewFixture());
		const other = new ReviewWorkflow({ client, store });
		await Promise.all([
			workflow.retryMissingInput(withNewEvidence(), audit()),
			other.retryMissingInput(withNewEvidence(), audit()),
		]);
		expect(await new ReviewWorkflow({ client, store }).retryMissingInput(withNewEvidence(), audit())).toMatchObject({
			state: "submitted",
			runId: "r2",
		});
		expect(callTool.mock.calls.filter(([name]) => name === "adaptorch_run")).toHaveLength(2);
		expect([...store.records.values()][0].retryCount).toBe(1);
	});
	it("does not retry from prose, unbound run, absent evidence, or unchanged content", async () => {
		const { workflow, callTool } = setup();
		await workflow.submit(reviewFixture());
		for (const reason of [audit("other-run"), { ...audit(), source: "model_prose" }, audit()]) {
			expect(await workflow.retryMissingInput(reviewFixture(), reason as MissingReviewInput)).toMatchObject({
				state: "revalidation_required",
			});
		}
		const input = reviewFixture();
		const renamed = { ...input, tests: [{ ...input.tests[0], id: "edge", executedAt: "2026-10-04T01:00:00Z" }] };
		expect(await workflow.retryMissingInput(renamed, audit())).toMatchObject({ state: "revalidation_required" });
		expect(callTool.mock.calls.filter(([name]) => name === "adaptorch_run")).toHaveLength(1);
	});
	it("cannot retry or assess a changed specification/diff under the same revision", async () => {
		const { workflow } = setup();
		await workflow.submit(reviewFixture());
		for (const patch of [
			{ diff: "another diff" },
			{ specification: [{ id: "other", text: "changed" }], tests: [] },
			{ candidateCount: 3 },
		]) {
			await expect(workflow.retryMissingInput({ ...reviewFixture(), ...patch }, audit())).rejects.toThrow(
				"binding changed",
			);
			await expect(workflow.assess({ ...reviewFixture(), ...patch })).rejects.toThrow("binding changed");
		}
	});
	it("does not submit altered evidence through the initial submit entry point", async () => {
		const { workflow, callTool } = setup();
		await workflow.submit(reviewFixture());
		expect(await workflow.submit(withNewEvidence())).toMatchObject({ state: "revalidation_required" });
		expect(callTool).toHaveBeenCalledTimes(1);
	});
	it("routes terminal unverified review to the reachable per-spec revalidation gate", async () => {
		const { workflow } = setup();
		await workflow.submit(reviewFixture());
		const result = await workflow.assess(reviewFixture());
		expect(result.state).toBe("revalidation_required");
		expect(result.revalidation?.state).toBe("blocked");
		expect(result.revalidation?.plan.items.map((i) => i.spec.id)).toEqual(["bounds"]);
		expect(result.revalidation?.executions).toEqual([]);
		expect(result.canApply).toBe(false);
		expect(result.shouldSubmit).toBe(false);
	});
});

describe("review assessment and persistence failure edges", () => {
	it.each(["RUNNING", "QUEUED", "SUCCEEDED", undefined, null, 42])(
		"retains observed BLOCKED without a second run snapshot (%s)",
		async (status) => {
			let reads = 0;
			const callTool = vi.fn(async (name: string) => {
				if (name === "adaptorch_run") return { run_id: "r1" };
				if (name === "adaptorch_get_run")
					return { run_id: "r1", status, correctness_wall: { verdict: ++reads === 1 ? "BLOCKED" : "PASS" } };
				return [];
			});
			const workflow = new ReviewWorkflow({
				client: new AdaptOrchClient({ callTool }),
				store: new SyntheticReviewStore(),
			});
			await workflow.submit(reviewFixture());
			const result = await workflow.assess(reviewFixture());
			expect(result.state).toBe("rejected");
			expect(result.revalidation).toBeUndefined();
			expect(reads).toBe(1);
		},
	);
	it("retains the admitted remote run ID if journal persistence fails afterward", async () => {
		const { client, callTool, store } = setup();
		const original = store.compareAndSwap.bind(store);
		let writes = 0;
		store.compareAndSwap = async (...args) => {
			if (++writes > 1) throw new Error("disk failed");
			return original(...args);
		};
		expect(await new ReviewWorkflow({ client, store }).submit(reviewFixture())).toMatchObject({
			state: "submission_unknown",
			runId: "r1",
		});
		expect(callTool).toHaveBeenCalledTimes(1);
	});
	it("snapshots input before awaiting journal lookup during assessment", async () => {
		const { workflow, store } = setup();
		const input = reviewFixture();
		await workflow.submit(input);
		const read = store.read.bind(store);
		store.read = async (key) => {
			(input.specification as { id: string; text: string }[])[0].text = "weakened requirement";
			return read(key);
		};
		const result = await workflow.assess(input);
		expect(result.revalidation?.plan.items[0].spec.text).toContain("Accept lengths 1 through 10");
	});
});

describe("missing-input retry cannot override a server refusal", () => {
	it.each(["SUCCEEDED", "FAILED", "RUNNING", "QUEUED", "unknown", undefined, null, 42])(
		"rejects BLOCKED before lifecycle validation (%s)",
		async (status) => {
			let submits = 0;
			const client = new AdaptOrchClient({
				callTool: async (name) => {
					if (name === "adaptorch_run") return { run_id: `r${++submits}` };
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									run_id: "r1",
									status,
									correctness_wall: { verdict: " bLoCkEd ", code: "HOST_VERIFIER_CAPABILITY_UNAVAILABLE" },
								}),
							},
						],
					};
				},
			});
			const store = new SyntheticReviewStore();
			const workflow = new ReviewWorkflow({ client, store });
			await workflow.submit(reviewFixture());
			expect(await workflow.retryMissingInput(withNewEvidence(), audit())).toMatchObject({
				state: "rejected",
				reason: "REVIEW_BLOCKED",
				runId: "r1",
			});
			expect(submits).toBe(1);
			expect([...store.records.values()][0].blockedRunIds).toEqual(["r1"]);
		},
	);
	it("preserves a prior refusal across restart even when later server data omits it", async () => {
		let blocked = true;
		let submits = 0;
		const client = new AdaptOrchClient({
			callTool: async (name) => {
				if (name === "adaptorch_run") return { run_id: `r${++submits}` };
				return { run_id: "r1", status: "SUCCEEDED", correctness_wall: { verdict: blocked ? "BLOCKED" : "PASS" } };
			},
		});
		const store = new SyntheticReviewStore();
		const workflow = new ReviewWorkflow({ client, store });
		await workflow.submit(reviewFixture());
		await workflow.retryMissingInput(withNewEvidence(), audit());
		blocked = false;
		const restored = new ReviewWorkflow({ client, store });
		expect(await restored.retryMissingInput(withNewEvidence(), audit())).toMatchObject({ state: "rejected" });
		expect(await restored.resume("synthetic-packet", "spec-v1")).toMatchObject({ state: "rejected" });
		expect(submits).toBe(1);
	});
});

it("journals a BLOCKED observation through resume before a later snapshot can omit it", async () => {
	let block = true;
	let submits = 0;
	const client = new AdaptOrchClient({
		callTool: async (name) => {
			if (name === "adaptorch_run") return { run_id: `r${++submits}` };
			return { run_id: "r1", status: "RUNNING", correctness_wall: { verdict: block ? "BLOCKED" : "PASS" } };
		},
	});
	const store = new SyntheticReviewStore();
	const workflow = new ReviewWorkflow({ client, store });
	await workflow.submit(reviewFixture());
	expect(await workflow.resume("synthetic-packet", "spec-v1")).toMatchObject({ state: "blocked" });
	block = false;
	expect(await new ReviewWorkflow({ client, store }).retryMissingInput(withNewEvidence(), audit())).toMatchObject({
		state: "rejected",
	});
	expect(submits).toBe(1);
});

it.each(["QUEUED", "SUCCEEDED", undefined, null])(
	"atomically journals an admission-time BLOCKED refusal (%s)",
	async (status) => {
		let submits = 0;
		const client = new AdaptOrchClient({
			callTool: async (name) => {
				if (name === "adaptorch_run")
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									run_id: `r${++submits}`,
									status,
									correctness_wall: { verdict: "blocked" },
								}),
							},
						],
					};
				return { run_id: "r1", status: "SUCCEEDED", correctness_wall: { verdict: "PASS" } };
			},
		});
		const store = new SyntheticReviewStore();
		const workflow = new ReviewWorkflow({ client, store });
		expect(await workflow.submit(reviewFixture())).toMatchObject({ state: "rejected", runId: "r1" });
		const restored = new ReviewWorkflow({ client, store });
		expect(await restored.retryMissingInput(withNewEvidence(), audit())).toMatchObject({ state: "rejected" });
		expect(await restored.resume("synthetic-packet", "spec-v1")).toMatchObject({ state: "rejected" });
		expect(submits).toBe(1);
		expect([...store.records.values()][0]).toMatchObject({
			attempts: [{ state: "submitted", runId: "r1" }],
			blockedRunIds: ["r1"],
		});
	},
);

it("stops the current retry when recording an observed refusal fails", async () => {
	let submits = 0;
	const client = new AdaptOrchClient({
		callTool: async (name) => {
			if (name === "adaptorch_run") return { run_id: `r${++submits}` };
			return { run_id: "r1", status: "SUCCEEDED", correctness_wall: { verdict: "BLOCKED" } };
		},
	});
	const store = new SyntheticReviewStore();
	const workflow = new ReviewWorkflow({ client, store });
	await workflow.submit(reviewFixture());
	store.compareAndSwap = async () => {
		throw new Error("refusal persistence unavailable; reconcile");
	};
	await expect(workflow.retryMissingInput(withNewEvidence(), audit())).rejects.toThrow("reconcile");
	expect(submits).toBe(1);
});
