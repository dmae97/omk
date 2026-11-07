import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length) harnesses.pop()?.cleanup();
});

async function setup() {
	const events: string[] = [];
	const harness = await createHarness({
		settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
		extensionFactories: [
			(omk) => {
				omk.on("agent_start", () => {
					events.push("agent_start");
				});
				omk.on("agent_end", () => {
					events.push("agent_end");
				});
				omk.on("agent_settled", () => {
					events.push("agent_settled");
				});
			},
		],
	});
	harnesses.push(harness);
	return { harness, events };
}

describe("agent_settled extension event", () => {
	it("emits agent_settled after agent_end when no retry follows", async () => {
		const { harness, events } = await setup();
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("fixture");
		expect(events).toEqual(["agent_start", "agent_end", "agent_settled"]);
	});

	it("does not emit agent_settled while a retry is still pending", async () => {
		const { harness, events } = await setup();
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" }),
			() => {
				expect(events).not.toContain("agent_settled");
				return fauxAssistantMessage("recovered");
			},
		]);
		await harness.session.prompt("fixture");
		expect(events.at(-1)).toBe("agent_settled");
	});

	it("emits agent_settled exactly once across a retry sequence", async () => {
		const { harness, events } = await setup();
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" }),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" }),
			fauxAssistantMessage("recovered"),
		]);
		await harness.session.prompt("fixture");
		expect(events.filter((event) => event === "agent_end")).toHaveLength(3);
		expect(events.filter((event) => event === "agent_settled")).toHaveLength(1);
	});

	it("orders agent_settled strictly after its agent_end", async () => {
		const { harness, events } = await setup();
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("fixture");
		expect(events.indexOf("agent_settled")).toBeGreaterThan(events.lastIndexOf("agent_end"));
	});

	it("does not emit agent_settled for passive messages without a run", async () => {
		const { harness, events } = await setup();
		await harness.session.sendCustomMessage({ customType: "passive", content: "note", display: false });
		expect(events).toEqual([]);
	});
});
