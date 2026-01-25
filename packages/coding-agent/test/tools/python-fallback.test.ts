import { describe, expect, it, vi } from "bun:test";
import * as pythonKernelModule from "@oh-my-pi/pi-coding-agent/ipy/kernel";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { createTools } from "@oh-my-pi/pi-coding-agent/tools";

function createTestSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		...overrides,
	};
}

function createBaseSettings(overrides: Partial<NonNullable<ToolSession["settings"]>> = {}) {
	return {
		getImageAutoResize: () => true,
		getLspFormatOnWrite: () => true,
		getLspDiagnosticsOnWrite: () => true,
		getLspDiagnosticsOnEdit: () => false,
		getEditFuzzyMatch: () => true,
		getBashInterceptorEnabled: () => true,
		getBashInterceptorSimpleLsEnabled: () => true,
		getBashInterceptorRules: () => [],
		...overrides,
	};
}

describe("createTools python fallback", () => {
	it("falls back to bash-only when kernel unavailable", async () => {
		const availabilitySpy = vi
			.spyOn(pythonKernelModule, "checkPythonKernelAvailability")
			.mockResolvedValue({ ok: false, reason: "unavailable" });

		const session = createTestSession({
			settings: createBaseSettings({
				getPythonToolMode: () => "ipy-only",
				getPythonKernelMode: () => "session",
			}),
		});

		const tools = await createTools(session, ["python"]);
		const names = tools.map(tool => tool.name).sort();

		expect(names).toEqual(["bash", "exit_plan_mode"]);

		availabilitySpy.mockRestore();
	});

	it("keeps bash when python mode is both but unavailable", async () => {
		const availabilitySpy = vi
			.spyOn(pythonKernelModule, "checkPythonKernelAvailability")
			.mockResolvedValue({ ok: false, reason: "unavailable" });

		const session = createTestSession({
			settings: createBaseSettings({
				getPythonToolMode: () => "both",
				getPythonKernelMode: () => "session",
			}),
		});

		const tools = await createTools(session);
		const names = tools.map(tool => tool.name);

		expect(names).toContain("bash");
		expect(names).not.toContain("python");

		availabilitySpy.mockRestore();
	});
});
