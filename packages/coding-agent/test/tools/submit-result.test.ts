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
	it("exposes top-level object parameters with required result union", () => {
		const tool = new SubmitResultTool(createSession());
		const schema = tool.parameters as {
			type?: string;
			properties?: Record<string, unknown>;
			required?: string[];
		};
		expect(schema.type).toBe("object");
		expect(Object.keys(schema.properties ?? {})).toEqual(["result"]);
		expect(schema.required).toEqual(["result"]);
	});

	it("accepts success payload with data", async () => {
		const tool = new SubmitResultTool(createSession());
		const result = await tool.execute("call-1", { result: { data: { ok: true } } } as never);
		expect(result.details).toEqual({ data: { ok: true }, status: "success", error: undefined });
	});

	it("accepts aborted payload with error only", async () => {
		const tool = new SubmitResultTool(createSession());
		const result = await tool.execute("call-2", { result: { error: "blocked" } } as never);
		expect(result.details).toEqual({ data: undefined, status: "aborted", error: "blocked" });
	});

	it("accepts arbitrary data when outputSchema is null", async () => {
		const tool = new SubmitResultTool(createSession({ outputSchema: null }));
		const result = await tool.execute("call-null", { result: { data: { nested: { x: 1 }, ok: true } } } as never);
		expect(result.details).toEqual({
			data: { nested: { x: 1 }, ok: true },
			status: "success",
			error: undefined,
		});
	});
	it("rejects submissions without a result object", async () => {
		const tool = new SubmitResultTool(createSession());
		await expect(tool.execute("call-3", {} as never)).rejects.toThrow(
			"result must be an object containing either data or error",
		);
	});
});
