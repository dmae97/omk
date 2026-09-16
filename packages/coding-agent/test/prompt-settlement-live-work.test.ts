import { describe, expect, it } from "vitest";
import type { PromptSettledEvent } from "../src/core/prompt-settlement.ts";
import { SessionPromptLifecycle } from "../src/core/session-prompt-lifecycle.ts";

describe("prompt settlement live work counters (spec 020 Req3)", () => {
	it("detached child blocks prompt_settled until exactly-once release", () => {
		const lifecycle = new SessionPromptLifecycle();
		const events: PromptSettledEvent[] = [];
		const { finish } = lifecycle.begin("prompt-run-settle-1");

		const release = lifecycle.noteDetachedChild();
		finish("completed", (event) => events.push(event));
		// Active child keeps the run unsettled.
		expect(events).toHaveLength(0);

		release();
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("prompt_settled");
		expect(events[0].outcome).toBe("completed");
	});

	it("double release never underflows and never re-emits", () => {
		const lifecycle = new SessionPromptLifecycle();
		const events: PromptSettledEvent[] = [];
		const { finish } = lifecycle.begin("prompt-run-settle-2");

		const release = lifecycle.noteDetachedChild();
		release();
		release(); // second call must be a no-op
		finish("completed", (event) => events.push(event));
		expect(events).toHaveLength(1);
	});

	it("detached shard blocks settlement the same way", () => {
		const lifecycle = new SessionPromptLifecycle();
		const events: PromptSettledEvent[] = [];
		const { finish } = lifecycle.begin("prompt-run-settle-3");

		const release = lifecycle.noteDetachedShard();
		finish("completed", (event) => events.push(event));
		expect(events).toHaveLength(0);
		release();
		expect(events).toHaveLength(1);
	});

	it("aborted run still waits for the child's terminal cleanup", () => {
		const lifecycle = new SessionPromptLifecycle();
		const events: PromptSettledEvent[] = [];
		const { finish } = lifecycle.begin("prompt-run-settle-4");

		const release = lifecycle.noteDetachedChild();
		finish("aborted", (event) => events.push(event));
		expect(events).toHaveLength(0);
		release();
		expect(events).toHaveLength(1);
		expect(events[0].outcome).toBe("aborted");
	});

	it("noteDetachedChild without an open run is a safe no-op", () => {
		const lifecycle = new SessionPromptLifecycle();
		const release = lifecycle.noteDetachedChild();
		expect(() => release()).not.toThrow();
	});
});
