import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { SubmitResultTool } from "@oh-my-pi/pi-coding-agent/tools/submit-result";

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

describe("SubmitResultTool", () => {
	it("exposes `{ data } | { error }` parameter union", () => {
		const tool = new SubmitResultTool(createSession());
		const schema = tool.parameters as { anyOf?: Array<{ required?: string[] }> };
		expect(schema.anyOf).toHaveLength(2);
		expect(schema.anyOf?.[0]?.required).toEqual(["data"]);
		expect(schema.anyOf?.[1]?.required).toEqual(["error"]);
	});

	it("accepts success payload with data", async () => {
		const tool = new SubmitResultTool(createSession());
		const result = await tool.execute("call-1", { data: { ok: true } } as never);
		expect(result.details).toEqual({ data: { ok: true }, status: "success", error: undefined });
	});

	it("accepts aborted payload with error only", async () => {
		const tool = new SubmitResultTool(createSession());
		const result = await tool.execute("call-2", { error: "blocked" } as never);
		expect(result.details).toEqual({ data: undefined, status: "aborted", error: "blocked" });
	});

	it("rejects successful submissions without data", async () => {
		const tool = new SubmitResultTool(createSession());
		await expect(tool.execute("call-3", {} as never)).rejects.toThrow(
			"data is required when submit_result indicates success",
		);
	});
});
