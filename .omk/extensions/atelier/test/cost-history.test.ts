import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSubagentUsage } from "../vendor/src/subagent-usage.ts";

const owned: string[] = [];
afterEach(async () => {
	for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true });
});

async function fixture() {
	const cwd = await mkdtemp(join(tmpdir(), "atelier-accounting-"));
	owned.push(cwd);
	const asyncDir = join(cwd, "async", "child"),
		artifacts = join(cwd, "subagent-artifacts"),
		sessionFile = join(cwd, "parent.jsonl");
	await mkdir(asyncDir, { recursive: true });
	await mkdir(artifacts);
	const status = {
		runId: "child",
		mode: "single",
		state: "complete",
		sessionId: sessionFile,
		startedAt: 100,
		steps: [{ agent: "reader", status: "completed" }],
	};
	const metadata = {
		runId: "child",
		agent: "reader",
		timestamp: 300,
		usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.3 },
	};
	const event = (at: number, cost: unknown) => ({
		type: "message_end",
		subagentSource: "child",
		subagentRunId: "child",
		subagentStepIndex: 0,
		subagentAgent: "reader",
		observedAt: at,
		message: {
			role: "assistant",
			timestamp: at,
			content: [{ text: "PRIVATE_OUTPUT" }],
			usage: { cost: { total: cost } },
		},
	});
	const metaPath = join(artifacts, "child_reader_0_meta.json");
	await writeFile(join(asyncDir, "status.json"), JSON.stringify(status));
	await writeFile(metaPath, JSON.stringify(metadata));
	const first = event(200, 0.1);
	await writeFile(
		join(asyncDir, "events.jsonl"),
		`${[first, first, event(300, 0.2)].map((row) => JSON.stringify(row)).join("\n")}\n`,
	);
	const options = {
		cwd,
		sessionFile,
		entries: [
			{ type: "message", message: { role: "toolResult", toolName: "subagent", details: { runId: "child", asyncDir } } },
		],
	};
	return { options, asyncDir, metaPath, status, metadata, event };
}

describe("owner-validated accounting artifacts", () => {
	it("replays real file-reader/computation paths without double counting or exposing output", async () => {
		const h = await fixture();
		const result = await readSubagentUsage(h.options);
		expect(result.runs[0]?.cost).toBe(0.3);
		expect(result.costHistory[0]?.points).toHaveLength(3);
		expect(result.costHistory[0]?.points.at(-1)?.cost).toBeCloseTo(0.3);
		expect(JSON.stringify(result)).not.toContain("PRIVATE_OUTPUT");
		expect(await readSubagentUsage(h.options)).toEqual(result);
		await writeFile(join(h.asyncDir, "status.json"), JSON.stringify({ ...h.status, sessionId: "another-session" }));
		expect((await readSubagentUsage(h.options)).costHistory).toEqual([]);
	});
	it("drops conflicting final curves and retains unavailable versus observed zero", async () => {
		const h = await fixture();
		await writeFile(h.metaPath, JSON.stringify({ ...h.metadata, usage: { ...h.metadata.usage, cost: 0.5 } }));
		const conflict = await readSubagentUsage(h.options);
		expect(conflict.costHistory).toEqual([]);
		expect(conflict.historyUnavailable).toBe(1);
		await writeFile(
			h.metaPath,
			JSON.stringify({ ...h.metadata, usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 } }),
		);
		const unknown = await readSubagentUsage(h.options);
		expect(unknown.runs[0]?.priced).toBe(false);
		const controller = new AbortController();
		controller.abort();
		expect((await readSubagentUsage({ ...h.options, signal: controller.signal })).runs).toEqual([]);
	});
});
