import { describe, expect, it } from "bun:test";
import { createTools, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
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
			getPythonToolMode: () => "bash-only",
			getPythonKernelMode: () => "session",
		},
		...overrides,
	};
}

describe("createTools python fallback", () => {
	it("falls back to bash when python is requested but disabled", async () => {
		const previous = process.env.OMP_PYTHON_SKIP_CHECK;
		process.env.OMP_PYTHON_SKIP_CHECK = "1";
		const session = createSession();
		const tools = await createTools(session, ["python"]);
		const names = tools.map(tool => tool.name).sort();

		expect(names).toEqual(["bash", "exit_plan_mode"]);

		if (previous === undefined) {
			delete process.env.OMP_PYTHON_SKIP_CHECK;
		} else {
			process.env.OMP_PYTHON_SKIP_CHECK = previous;
		}
	});
});
