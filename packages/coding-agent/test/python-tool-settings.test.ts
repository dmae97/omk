import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as pythonExecutor from "@oh-my-pi/pi-coding-agent/ipy/executor";
import * as pythonKernel from "@oh-my-pi/pi-coding-agent/ipy/kernel";
import { createTools, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { PythonTool } from "@oh-my-pi/pi-coding-agent/tools/python";

function createSettings(overrides?: Partial<ToolSession["settings"]>): ToolSession["settings"] {
	return {
		getImageAutoResize: () => true,
		getLspFormatOnWrite: () => false,
		getLspDiagnosticsOnWrite: () => true,
		getLspDiagnosticsOnEdit: () => false,
		getEditFuzzyMatch: () => true,
		getBashInterceptorEnabled: () => false,
		getBashInterceptorSimpleLsEnabled: () => true,
		getBashInterceptorRules: () => [],
		getPythonToolMode: () => "ipy-only",
		getPythonKernelMode: () => "session",
		getPythonSharedGateway: () => true,
		...overrides,
	};
}

function createSession(cwd: string, overrides?: Partial<ToolSession["settings"]>): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => "session.json",
		getSessionSpawns: () => null,
		settings: createSettings(overrides),
	};
}

describe("python tool settings", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = path.join(os.tmpdir(), `python-tool-settings-${crypto.randomUUID()}`);
		fs.mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it("exposes python tool when kernel is available", async () => {
		vi.spyOn(pythonKernel, "checkPythonKernelAvailability").mockResolvedValue({ ok: true });
		const tools = await createTools(createSession(testDir), ["python"]);

		expect(tools.map(tool => tool.name).sort()).toEqual(["exit_plan_mode", "python"]);
	});

	it("falls back to bash when python is unavailable", async () => {
		vi.spyOn(pythonKernel, "checkPythonKernelAvailability").mockResolvedValue({
			ok: false,
			reason: "missing",
		});
		const tools = await createTools(createSession(testDir), ["python"]);

		expect(tools.map(tool => tool.name).sort()).toEqual(["bash", "exit_plan_mode"]);
	});

	it("passes kernel mode from settings to executor", async () => {
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

		const session = createSession(testDir, { getPythonKernelMode: () => "per-call" });
		const pythonTool = new PythonTool(session);

		await pythonTool.execute("tool-call", { cells: [{ code: "print(1)" }] });

		expect(executeSpy).toHaveBeenCalledWith(
			"print(1)",
			expect.objectContaining({
				kernelMode: "per-call",
				sessionId: `session:session.json:cwd:${testDir}`,
			}),
		);
	});
});
