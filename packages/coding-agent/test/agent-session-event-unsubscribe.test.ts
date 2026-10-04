import { describe, expect, test } from "vitest";
import { AgentSession, type AgentSessionEvent, type AgentSessionEventListener } from "../src/core/agent-session.ts";

interface SessionEmitterHarness {
	_eventListeners: AgentSessionEventListener[];
	subscribe(listener: AgentSessionEventListener): () => void;
	_emit(event: AgentSessionEvent): void;
}

/** Exercise the native emitter/subscribe methods without constructor or persistence side effects. */
function createEmitterHarness(): SessionEmitterHarness {
	const session = Object.create(AgentSession.prototype) as SessionEmitterHarness;
	session._eventListeners = [];
	return session;
}

const event: AgentSessionEvent = { type: "queue_update", steering: ["steer"], followUp: ["follow-up"] };

describe("AgentSession native event dispatch", () => {
	test("self-unsubscribe does not skip the next subscriber", () => {
		const session = createEmitterHarness();
		const deliveries: string[] = [];
		const unsubscribe = session.subscribe(() => {
			deliveries.push("first");
			unsubscribe();
		});
		session.subscribe(() => deliveries.push("second"));
		session.subscribe(() => deliveries.push("third"));

		session._emit(event);
		expect(deliveries).toEqual(["first", "second", "third"]);
		session._emit(event);
		expect(deliveries).toEqual(["first", "second", "third", "second", "third"]);
	});

	test("preserves queue-update order and admits newly added subscribers on the next emission", () => {
		const session = createEmitterHarness();
		const deliveries: string[] = [];
		let subscribed = false;
		session.subscribe((update) => {
			if (update.type !== "queue_update") return;
			deliveries.push(`first:${update.steering.join(",")}:${update.followUp.join(",")}`);
			if (!subscribed) {
				subscribed = true;
				session.subscribe(() => deliveries.push("late"));
			}
		});
		session.subscribe((update) => {
			if (update.type === "queue_update") deliveries.push(`second:${update.steering.join(",")}`);
		});

		session._emit(event);
		session._emit({ type: "queue_update", steering: ["next"], followUp: [] });
		expect(deliveries).toEqual(["first:steer:follow-up", "second:steer", "first:next:", "second:next", "late"]);
	});
});
