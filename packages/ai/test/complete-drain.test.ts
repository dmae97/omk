import { afterEach, describe, expect, it } from "vitest";
import { registerApiProvider, unregisterApiProviders } from "../src/api-registry.ts";
import { complete, completeSimple } from "../src/stream.ts";
import type { AssistantMessage, AssistantMessageEvent, Context, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const api = "fixture-complete-drain";
const sourceId = "test-complete-drain";
const model: Model<typeof api> = {
	id: "fixture",
	name: "Fixture",
	api,
	provider: "fixture",
	baseUrl: "https://fixture.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 64,
};
const context: Context = { messages: [{ role: "user", content: "ping", timestamp: 1 }] };

class ObservedStream extends AssistantMessageEventStream {
	produced = 0;
	consumed = 0;
	maxBacklog = 0;

	override push(event: AssistantMessageEvent): void {
		this.produced++;
		this.maxBacklog = Math.max(this.maxBacklog, this.produced - this.consumed);
		super.push(event);
	}

	override async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
		const iterator = super[Symbol.asyncIterator]();
		try {
			while (true) {
				const event = await iterator.next();
				if (event.done) return;
				this.consumed++;
				yield event.value;
			}
		} finally {
			await iterator.return?.();
		}
	}
}

function fixture(stopReason: "stop" | "error"): { source: ObservedStream; message: AssistantMessage } {
	const source = new ObservedStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "pong" }],
		api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		errorMessage: stopReason === "error" ? "fixture terminal failure" : undefined,
		timestamp: 1,
	};
	(async () => {
		for (let index = 0; index < 24; index++) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			source.push({ type: "text_delta", contentIndex: 0, delta: "x", partial: message });
		}
		source.push(
			stopReason === "stop"
				? { type: "done", reason: "stop", message }
				: { type: "error", reason: "error", error: message },
		);
	})();
	return { source, message };
}

afterEach(() => unregisterApiProviders(sourceId));

describe("completion-only event consumption", () => {
	for (const [name, run] of [
		["complete", complete],
		["completeSimple", completeSimple],
	] as const) {
		for (const stopReason of ["stop", "error"] as const) {
			it(`${name} drains incremental events and preserves ${stopReason} final results`, async () => {
				const { source, message } = fixture(stopReason);
				registerApiProvider({ api, stream: () => source, streamSimple: () => source }, sourceId);
				expect(await run(model, context)).toBe(message);
				expect(source.consumed).toBe(25);
				expect(source.maxBacklog).toBeLessThanOrEqual(2);
			});
		}
	}

	it("keeps direct result() compatible with subsequent event iteration", async () => {
		const { source, message } = fixture("stop");
		expect(await source.result()).toBe(message);
		expect(source.consumed).toBe(0);
		const events: AssistantMessageEvent[] = [];
		for await (const event of source) events.push(event);
		expect(events).toHaveLength(25);
		expect(events.at(-1)).toEqual({ type: "done", reason: "stop", message });
	});
});
