import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import goalController from "../../src/core/extensions/builtin/goal-controller.ts";
import type { TaskResultDowngradeEvent, TaskResultEvent } from "../../src/core/task-result.ts";
import { runRpcMode } from "../../src/modes/rpc/rpc-mode.ts";
import { createHarness, type Harness } from "./harness.ts";

/**
 * Spec 100 case 2c over real RPC mode: the stdio writer and line reader are the only seams,
 * as in test/rpc-task-result.test.ts. The real goal controller runs a real `node --test` check.
 */
const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));
vi.mock("../../src/modes/rpc/jsonl.js", async (importOriginal) => {
	const real = await importOriginal<typeof import("../../src/modes/rpc/jsonl.ts")>();
	return {
		...real,
		attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
			rpcIo.lineHandler = onLine;
			return () => {};
		}),
	};
});

const keep = process.env.OMK_TASK_RESULT;
const harnesses: Harness[] = [];
beforeEach(() => {
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
	process.env.OMK_TASK_RESULT = "1";
});
afterEach(() => {
	vi.unstubAllEnvs();
	for (const h of harnesses.splice(0)) h.cleanup();
	if (keep === undefined) delete process.env.OMK_TASK_RESULT;
	else process.env.OMK_TASK_RESULT = keep;
});

describe("spec 100 case 2c over real RPC mode", () => {
	it("the wire carries the downgrade of the passed fact, then the final completion_refused task_result", async () => {
		const h = await createHarness({
			extensionFactories: [
				(omk) =>
					goalController(omk, {
						testHooks: {
							afterPublishBeforeComplete: ({ cwd }) => writeFileSync(join(cwd, "extra.txt"), "edit\n"),
						},
					}),
			],
		});
		harnesses.push(h);
		writeFileSync(join(h.tempDir, "calc.mjs"), "export const add = (a, b) => a + b;\n");
		writeFileSync(
			join(h.tempDir, "calc.test.mjs"),
			'import test from "node:test";\nimport assert from "node:assert";\nimport { add } from "./calc.mjs";\ntest("adds", () => assert.equal(add(1, 2), 3));\n',
		);
		const git = (...args: string[]) => execFileSync("git", args, { cwd: h.tempDir, stdio: "ignore" });
		git("init", "-q");
		git("config", "user.email", "goal@test.invalid");
		git("config", "user.name", "goal");
		git("config", "commit.gpgsign", "false");
		git("add", ".");
		git("commit", "-qm", "init");
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		await h.session.prompt("/goal verify node --test calc.test.mjs");

		const runtimeHost = {
			session: h.session,
			newSession: vi.fn(async () => ({ cancelled: true })),
			switchSession: vi.fn(async () => ({ cancelled: true })),
			fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
			dispose: vi.fn(async () => {}),
			setRebindSession: vi.fn(),
		} as unknown as AgentSessionRuntime;
		rpcIo.outputLines = [];
		void runRpcMode(runtimeHost);
		await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());
		rpcIo.lineHandler?.(JSON.stringify({ id: "go", type: "prompt", message: "go" }));
		const wire = () =>
			rpcIo.outputLines
				.flatMap((line) => line.split("\n"))
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line) as { type: string });
		await vi.waitFor(() => expect(wire().some((r) => r.type === "task_result")).toBe(true), { timeout: 20_000 });

		const records = wire();
		const types = records.map((r) => r.type);
		const downgradeAt = types.indexOf("task_result_downgrade");
		const resultAt = types.indexOf("task_result");
		expect(types.filter((t) => t === "task_result_downgrade")).toHaveLength(1);
		expect(downgradeAt).toBeGreaterThanOrEqual(0);
		expect(downgradeAt).toBeLessThan(types.indexOf("prompt_settled"));
		expect(downgradeAt).toBeLessThan(resultAt);
		const downgrade = records[downgradeAt] as TaskResultDowngradeEvent;
		expect(downgrade.from).toBe("passed");
		expect(downgrade.fact).toMatchObject({ status: "insufficient", reason: "completion_refused", attempt: 1 });
		const result = records[resultAt] as TaskResultEvent;
		expect(result.projection.facts).toHaveLength(1);
		expect(result.projection.facts[0]).toMatchObject({ status: "insufficient", reason: "completion_refused" });
		expect(result.projection.check).toBe("insufficient");
		// The pass is never on the wire as a pass: only as the `from` of its downgrade.
		expect(
			records.some((r) => r.type === "task_result" && (r as TaskResultEvent).projection.check === "passed"),
		).toBe(false);
	});
});
