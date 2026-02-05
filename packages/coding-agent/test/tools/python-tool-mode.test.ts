import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createTools, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({
			"lsp.formatOnWrite": true,
			"bashInterceptor.enabled": true,
			"python.toolMode": "bash-only",
		}),
		...overrides,
	};
}

describe("createTools python fallback", () => {
	it("falls back to bash when python is requested but disabled", async () => {
		const previous = Bun.env.PI_PYTHON_SKIP_CHECK;
		Bun.env.PI_PYTHON_SKIP_CHECK = "1";
		const session = createSession();
		const tools = await createTools(session, ["python"]);
		const names = tools.map(tool => tool.name).sort();

		expect(names).toEqual(["bash", "exit_plan_mode"]);

		if (previous === undefined) {
			delete Bun.env.PI_PYTHON_SKIP_CHECK;
		} else {
			Bun.env.PI_PYTHON_SKIP_CHECK = previous;
		}
	});
});
