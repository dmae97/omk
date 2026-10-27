/**
 * Spec 107 suite check: with OMK_EDIT_DIAGNOSTICS=1 the tool result the model sees after
 * an edit carries the new diagnostic; with the flag off it does not; and the first request
 * (system prompt, tool schema, messages) is identical in both arms. Fake checker, no tsc.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	flushEditDiagnosticsSession,
	setCheckerVersionProbeForTest,
	setEditDiagnosticsCollectorForTest,
} from "../../src/core/tools/edit-diagnostics.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
const savedFlag = process.env.OMK_EDIT_DIAGNOSTICS;
let restore: (() => void) | undefined;

afterEach(() => {
	flushEditDiagnosticsSession();
	restore?.();
	restore = undefined;
	if (savedFlag === undefined) delete process.env.OMK_EDIT_DIAGNOSTICS;
	else process.env.OMK_EDIT_DIAGNOSTICS = savedFlag;
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
});

async function runArm(
	flag: "1" | "shadow" | undefined,
): Promise<{ first: string; toolResult: string; toolDetails: string; calls: number }> {
	if (flag) process.env.OMK_EDIT_DIAGNOSTICS = flag;
	else process.env.OMK_EDIT_DIAGNOSTICS = "0";
	const harness = await createHarness();
	harnesses.push(harness);
	const dir = harness.tempDir;
	writeFileSync(join(dir, "a.ts"), "export const x: number = 1;\n");
	let calls = 0;
	restore = setEditDiagnosticsCollectorForTest(async () => {
		calls++;
		if (calls === 1) return { lines: [] };
		const broken = readFileSync(join(dir, "a.ts"), "utf8").includes('"one"');
		return {
			lines: broken
				? [
						{
							language: "typescript",
							severity: "error",
							path: join(dir, "a.ts"),
							line: 1,
							column: 14,
							message: "Type 'string' is not assignable to type 'number'.",
						},
					]
				: [],
		};
	});
	const contexts: Context[] = [];
	harness.setResponses([
		(context) => {
			contexts.push(JSON.parse(JSON.stringify(context)) as Context);
			return fauxAssistantMessage(
				[fauxToolCall("edit", { path: "a.ts", edits: [{ oldText: "= 1", newText: '= "one"' }] })],
				{ stopReason: "toolUse" },
			);
		},
		(context) => {
			contexts.push(JSON.parse(JSON.stringify(context)) as Context);
			return fauxAssistantMessage("done");
		},
	]);
	await harness.session.prompt("Change x to the string one.");
	expect(contexts).toHaveLength(2);
	const toolMessage = contexts[1].messages.find((m) => m.role === "toolResult");
	const toolResult = JSON.stringify(toolMessage?.content ?? null).replaceAll(dir, "<cwd>");
	const toolDetails = JSON.stringify((toolMessage as { details?: unknown } | undefined)?.details ?? null).replaceAll(
		dir,
		"<cwd>",
	);
	const first = JSON.stringify({
		systemPrompt: contexts[0].systemPrompt,
		tools: contexts[0].tools,
		messages: contexts[0].messages.map((m) => ("timestamp" in m ? { ...m, timestamp: 0 } : m)),
	}).replaceAll(dir, "<cwd>");
	return { first, toolResult, toolDetails, calls };
}

describe("spec 107 OMK_EDIT_DIAGNOSTICS in a session", () => {
	it("ON shows the new diagnostic in the next request, OFF does not, first request identical", async () => {
		const on = await runArm("1");
		const off = await runArm(undefined);
		expect(on.toolResult).toContain("New diagnostics after this edit (1, vs pre-edit baseline):");
		expect(on.toolResult).toContain("ERROR a.ts:1:14 Type 'string' is not assignable to type 'number'.");
		expect(off.toolResult).toContain("Successfully replaced 1 block(s) in a.ts.");
		expect(off.toolResult).not.toContain("New diagnostics");
		expect(on.first).toBe(off.first);
	});

	it("shadow: tool result text, details and first request byte-identical to OFF; checker still ran", async () => {
		const shadow = await runArm("shadow");
		const off = await runArm(undefined);
		expect(shadow.calls).toBe(2);
		expect(off.calls).toBe(0);
		expect(shadow.toolResult).toBe(off.toolResult);
		expect(shadow.toolDetails).toBe(off.toolDetails);
		expect(shadow.toolDetails).not.toContain("newDiagnostics");
		expect(shadow.first).toBe(off.first);
	});
});

describe("spec 107 checkerRan per session (pre-registration)", () => {
	const savedLogDir = process.env.OMK_RUN_LOG_DIR;
	let logDir: string | undefined;
	afterEach(() => {
		if (savedLogDir === undefined) delete process.env.OMK_RUN_LOG_DIR;
		else process.env.OMK_RUN_LOG_DIR = savedLogDir;
		if (logDir) rmSync(logDir, { recursive: true, force: true });
		logDir = undefined;
	});

	async function sessionLine(flag: "1" | "shadow" | undefined, missing: boolean) {
		logDir = mkdtempSync(join(tmpdir(), "omk-edit-diag-session-"));
		process.env.OMK_RUN_LOG_DIR = logDir;
		if (flag) process.env.OMK_EDIT_DIAGNOSTICS = flag;
		else process.env.OMK_EDIT_DIAGNOSTICS = "0";
		const harness = await createHarness();
		harnesses.push(harness);
		writeFileSync(join(harness.tempDir, "a.ts"), "export const x: number = 1;\n");
		restore = setEditDiagnosticsCollectorForTest(async () =>
			missing ? { lines: [], skipped: "no tsconfig found" } : { lines: [] },
		);
		const restoreProbe = setCheckerVersionProbeForTest(async () => ({
			tsc: "Version 5.9.3",
			pyright: null,
			ruff: null,
		}));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "a.ts", edits: [{ oldText: "= 1", newText: "= 2" }] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		try {
			await harness.session.prompt("Change x to 2.");
			await new Promise((r) => setTimeout(r, 0));
		} finally {
			restoreProbe();
		}
		const record = flushEditDiagnosticsSession();
		const file = join(logDir, "edit-diag-session.jsonl");
		const lines = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
		return { record, lines };
	}

	it("ON and shadow: checkerRan true when the checker runs", async () => {
		for (const flag of ["1", "shadow"] as const) {
			const { record, lines } = await sessionLine(flag, false);
			expect(record).toMatchObject({ checkerRan: true, checkerRuns: 2 });
			expect(lines).toHaveLength(1);
			expect(JSON.parse(lines[0])).toMatchObject({ checkerRan: true, checkerVersions: { tsc: "Version 5.9.3" } });
		}
	});

	it("checkerRan false when the checker is missing", async () => {
		const { record } = await sessionLine("1", true);
		expect(record).toMatchObject({ checkerRan: false, checkerRuns: 0, checkerVersions: null });
	});

	it("OFF: no session record, nothing written", async () => {
		const { record, lines } = await sessionLine(undefined, false);
		expect(record).toBeUndefined();
		expect(lines).toEqual([]);
	});

	it("ON/shadow with zero edits writes exactly one session line, checkerRan=false; OFF writes none", async () => {
		for (const flag of ["1", "shadow", undefined] as const) {
			logDir = mkdtempSync(join(tmpdir(), "omk-edit-diag-session-"));
			process.env.OMK_RUN_LOG_DIR = logDir;
			if (flag) process.env.OMK_EDIT_DIAGNOSTICS = flag;
			else process.env.OMK_EDIT_DIAGNOSTICS = "0";
			const harness = await createHarness();
			harnesses.push(harness);
			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt("Say done.");
			flushEditDiagnosticsSession();
			const file = join(logDir, "edit-diag-session.jsonl");
			const lines = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
			if (flag) {
				expect(lines).toHaveLength(1);
				expect(JSON.parse(lines[0])).toMatchObject({ checkerRan: false, checks: 0, checkerRuns: 0 });
			} else expect(lines).toEqual([]);
			rmSync(logDir, { recursive: true, force: true });
		}
	});
});
