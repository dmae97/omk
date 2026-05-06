import { getModel } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/execution-env.js";
import { createAgentHarness, createSession } from "../../src/harness/factory.js";
import { InMemorySessionStorage } from "../../src/harness/session/storage/memory.js";

describe("harness factories", () => {
	it("creates sessions from storage", async () => {
		const storage = new InMemorySessionStorage({
			metadata: { id: "session-1", createdAt: "2026-01-01T00:00:00.000Z" },
		});
		const session = createSession(storage);
		expect(session.getStorage()).toBe(storage);
		expect(await session.getMetadata()).toEqual({ id: "session-1", createdAt: "2026-01-01T00:00:00.000Z" });
	});

	it("creates agent harnesses", () => {
		const session = createSession(new InMemorySessionStorage());
		const env = new NodeExecutionEnv({ cwd: process.cwd() });
		const harness = createAgentHarness({ env, session, initialModel: getModel("anthropic", "claude-sonnet-4-5") });
		expect(harness.env).toBe(env);
		expect(harness.conversation.session).toBe(session);
	});
});
