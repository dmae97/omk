import { describe, expect, it, vi } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as pythonExecutor from "@oh-my-pi/pi-coding-agent/ipy/executor";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { PythonTool } from "@oh-my-pi/pi-coding-agent/tools/python";
import { TempDir } from "@oh-my-pi/pi-utils";

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => `${cwd}/session-file.jsonl`,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({
			"lsp.formatOnWrite": true,
			"bashInterceptor.enabled": true,
			"python.toolMode": "ipy-only",
			"python.kernelMode": "per-call",
		}),
	};
}

describe("python tool execution", () => {
	it("passes kernel options from settings and args", async () => {
		const tempDir = TempDir.createSync("@python-tool-");
		const executeSpy = vi.spyOn(pythonExecutor, "executePython").mockResolvedValue({
			output: "ok",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			totalLines: 1,
			totalBytes: 2,
			outputLines: 1,
			outputBytes: 2,
			displayOutputs: [],
			stdinRequested: false,
		});

		const tool = new PythonTool(createSession(tempDir.path()));
		const result = await tool.execute(
			"call-id",
			{ cells: [{ code: "print('hi')" }], timeout: 5, cwd: tempDir.path(), reset: true },
			undefined,
			undefined,
			undefined,
		);

		expect(executeSpy).toHaveBeenCalledWith(
			"print('hi')",
			expect.objectContaining({
				cwd: tempDir.path(),
				deadlineMs: expect.any(Number),
				signal: expect.any(AbortSignal),
				sessionFile: `${tempDir.path()}/session-file.jsonl`,
				sessionId: `session:${tempDir.path()}/session-file.jsonl:cwd:${tempDir.path()}`,
				kernelMode: "per-call",
				useSharedGateway: true,
				reset: true,
			}),
		);
		const text = result.content.find(item => item.type === "text")?.text;
		expect(text).toBe("ok");

		executeSpy.mockRestore();
		tempDir.removeSync();
	});
});
