import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolTerminalError, toolTerminalCauseOf } from "omk-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBashTool } from "../src/core/tools/bash.ts";
import { createEditTool } from "../src/core/tools/edit.ts";
import { createWriteTool } from "../src/core/tools/write.ts";

let dir: string;
beforeEach(() => {
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
	dir = mkdtempSync(join(tmpdir(), "omk-terminal-cause-"));
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error("expected a rejection");
}

describe("spec 119 AU4: tools throw a typed terminal cause, message unchanged", () => {
	it("bash timeout", async () => {
		const error = await rejection(() =>
			createBashTool(dir).execute("t1", { command: "sleep 5", timeout: 1 }, undefined, undefined),
		);
		expect(error).toBeInstanceOf(ToolTerminalError);
		expect(toolTerminalCauseOf(error)).toBe("timeout");
		expect((error as Error).message).toContain("Command timed out after 1 seconds");
	});

	it("bash abort", async () => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 200);
		const error = await rejection(() =>
			createBashTool(dir).execute("t2", { command: "sleep 5" }, controller.signal, undefined),
		);
		expect(toolTerminalCauseOf(error)).toBe("aborted");
		expect((error as Error).message).toContain("Command aborted");
	});

	it("edit abort", async () => {
		writeFileSync(join(dir, "a.txt"), "old\n");
		const controller = new AbortController();
		controller.abort();
		const error = await rejection(() =>
			createEditTool(dir).execute(
				"t3",
				{ path: "a.txt", edits: [{ oldText: "old", newText: "new" }] } as never,
				controller.signal,
				undefined,
			),
		);
		expect(toolTerminalCauseOf(error)).toBe("aborted");
		expect((error as Error).message).toBe("Operation aborted");
	});

	it("write abort", async () => {
		const controller = new AbortController();
		controller.abort();
		const error = await rejection(() =>
			createWriteTool(dir).execute("t4", { path: "b.txt", content: "x" }, controller.signal, undefined),
		);
		expect(toolTerminalCauseOf(error)).toBe("aborted");
		expect((error as Error).message).toBe("Operation aborted");
	});

	it("a plain failure carries no cause", () => {
		expect(toolTerminalCauseOf(new Error("Command timed out after 1 seconds"))).toBeUndefined();
	});
});
