import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { describe, expect, it } from "vitest";
import { inspectSessionOwnerLeaseSync } from "../../src/core/session-owner-lease.ts";
import { createHarness } from "./harness.ts";

function fixturePid(value: unknown): number {
	if (typeof value !== "object" || value === null || !("details" in value)) throw new Error("missing details");
	const details = value.details;
	if (typeof details !== "object" || details === null || !("structuredContent" in details))
		throw new Error("missing structured result");
	const content = details.structuredContent;
	if (typeof content !== "object" || content === null || !("pid" in content) || typeof content.pid !== "number")
		throw new Error("missing fixture pid");
	return content.pid;
}

describe("AgentSession native MCP retirement", () => {
	it("joins the native child before releasing the session lease and denies later attachment", async () => {
		const h = await createHarness({ persistSession: true });
		try {
			const statuses = await h.session.attachMcpServers({
				servers: [
					{
						name: "fixture",
						command: process.execPath,
						args: [fileURLToPath(new URL("../fixtures/phase3-catalog-server.mjs", import.meta.url)), "good"],
						inheritEnv: false,
					},
				],
			});
			expect(statuses[0].state).toBe("ready");
			h.setResponses([
				fauxAssistantMessage(fauxToolCall("fixture__echo", { message: "owned child" })),
				fauxAssistantMessage("done"),
			]);
			await h.session.prompt("Read the fixture child identity");
			const ended = h.eventsOfType("tool_execution_end").find((event) => event.toolName === "fixture__echo");
			if (!ended) throw new Error("missing execution");
			const pid = fixturePid(ended.result);
			expect(() => process.kill(pid, 0)).not.toThrow();
			const file = h.session.sessionFile;
			if (!file) throw new Error("missing persisted session");
			await h.session.close();
			expect(() => process.kill(pid, 0)).toThrow();
			expect(inspectSessionOwnerLeaseSync(file).status).toBe("absent");
			await expect(h.session.attachMcpServers({ servers: [] })).rejects.toThrow(/clos/);
			await expect(h.session.executeBash("must not execute")).rejects.toThrow(/clos/);
		} finally {
			await h.session.close();
			h.cleanup();
		}
	});
});
