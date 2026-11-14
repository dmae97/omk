import { type AssistantMessage, createAssistantMessageEventStream, fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settledRunCostUsd } from "../src/core/extensions/builtin/goal-autonomy.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length) harnesses.pop()?.cleanup();
});
const reply = (cost: number, failed = false) => {
	const message = fauxAssistantMessage(
		failed ? "" : "done",
		failed ? { stopReason: "error", errorMessage: "503 service unavailable" } : {},
	);
	message.usage = structuredClone(message.usage);
	message.usage.cost.total = cost;
	return message;
};
async function setup(baseDelayMs = 1) {
	const costs: Array<number | undefined> = [];
	const harness = await createHarness({
		settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs } },
		extensionFactories: [
			(omk) => {
				omk.on("agent_settled", (event) => {
					costs.push(settledRunCostUsd(event.messages));
				});
			},
		],
	});
	harnesses.push(harness);
	let responses: AssistantMessage[] = [];
	harness.session.agent.streamFn = (model) => {
		const scripted = responses.shift();
		if (!scripted) throw new Error("Missing scripted response");
		const message = { ...scripted, api: model.api, provider: model.provider, model: model.id };
		const stream = createAssistantMessageEventStream();
		if (message.stopReason === "error" || message.stopReason === "aborted")
			stream.push({ type: "error", reason: message.stopReason, error: message });
		else stream.push({ type: "done", reason: message.stopReason, message });
		stream.end(message);
		return stream;
	};
	return {
		harness,
		costs,
		setResponses: (next: AssistantMessage[]) => {
			responses = next;
		},
	};
}
describe("prompt attempt accounting at the public settlement boundary", () => {
	it("preserves three billed attempts after retry messages leave the context", async () => {
		const { harness, costs, setResponses } = await setup();
		setResponses([reply(0.03, true), reply(0.03, true), reply(0.03, true)]);
		await harness.session.prompt("fixture");
		expect(costs).toHaveLength(1);
		expect(costs[0]).toBeCloseTo(0.09);
	});
	it("preserves a billed attempt when the retry wait is cancelled", async () => {
		const { harness, costs, setResponses } = await setup(60_000);
		setResponses([reply(0.03, true)]);
		const run = harness.session.prompt("fixture");
		await vi.waitFor(() => expect(harness.session.isRetrying).toBe(true));
		await harness.session.abort();
		await run;
		expect(costs).toEqual([0.03]);
	});
	it("does not include a previous prompt's cost in a later settlement", async () => {
		const { harness, costs, setResponses } = await setup();
		setResponses([reply(0.03), reply(0.04)]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");
		expect(costs).toEqual([0.03, 0.04]);
	});
});
