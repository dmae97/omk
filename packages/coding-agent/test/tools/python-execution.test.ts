import { describe, expect, it, vi } from "bun:test";
import { createTempDirSync } from "@oh-my-pi/pi-utils";
import * as pythonExecutor from "$c/ipy/executor";
import type { ToolSession } from "$c/tools/index";
import { PythonTool } from "$c/tools/python";

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => "session-file",
		getSessionSpawns: () => "*",
		settings: {
			getImageAutoResize: () => true,
			getLspFormatOnWrite: () => true,
			getLspDiagnosticsOnWrite: () => true,
			getLspDiagnosticsOnEdit: () => false,
			getEditFuzzyMatch: () => true,
			getBashInterceptorEnabled: () => true,
			getBashInterceptorSimpleLsEnabled: () => true,
			getBashInterceptorRules: () => [],
			getPythonToolMode: () => "ipy-only",
			getPythonKernelMode: () => "per-call",
		},
	};
}

describe("python tool execution", () => {
	it("passes kernel options from settings and args", async () => {
		const tempDir = createTempDirSync("@python-tool-");
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

		const tool = new PythonTool(createSession(tempDir.path));
		const result = await tool.execute(
			"call-id",
			{ cells: [{ code: "print('hi')" }], timeout: 5, cwd: tempDir.path, reset: true },
			undefined,
			undefined,
			undefined,
		);

		expect(executeSpy).toHaveBeenCalledWith(
			"print('hi')",
			expect.objectContaining({
				cwd: tempDir.path,
				timeoutMs: 5000,
				sessionId: `session:session-file:cwd:${tempDir.path}`,
				kernelMode: "per-call",
				reset: true,
			}),
		);
		const text = result.content.find((item) => item.type === "text")?.text;
		expect(text).toBe("ok");

		executeSpy.mockRestore();
		tempDir.remove();
	});
});
