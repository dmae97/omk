import { getApiProvider } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeSummarization, generateSummary } from "../src/core/compaction/compaction.ts";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { capturePayload, registryWithOmk } from "./omk-provider-flag-on-lib.ts";
import { createCatalogRegistry } from "./omk-provider-golden-lib.ts";
import { openOmkSession, stubGateway } from "./omk-provider-session-lib.ts";

afterEach(() => vi.unstubAllGlobals());

function model(id: "coder" | "reasoner") {
	const found = registryWithOmk().find("OMK", id);
	if (!found) throw new Error(`missing OMK/${id}`);
	return found;
}

describe("flag off", () => {
	// Runs first on purpose: provider registration is process-global once the flag is on.
	it("registers no OMK stream path and leaves the openai-completions provider alone", () => {
		const before = getApiProvider("openai-completions");
		registerOmkProviderIfEnabled(createCatalogRegistry(), { OMK_PROVIDER_OMK: "0", OMK_GATEWAY_BASE_URL: "x" });
		expect(getApiProvider("omk-completions")).toBeUndefined();
		expect(getApiProvider("openai-completions")).toBe(before);
	});
});

describe("OMK/reasoner internal calls (no `reasoning` key at all)", () => {
	it("go out as wire model `coder` with no thinking and no reasoning_effort", async () => {
		const payload = await capturePayload(model("reasoner"), {});
		expect(payload).toMatchObject({ model: "coder", max_tokens: 4096 });
		expect(payload).not.toHaveProperty("thinking");
		expect(payload).not.toHaveProperty("reasoning_effort");
	});

	it("do not mutate the registered model: OMK/reasoner is still reasoner afterwards", async () => {
		const reasoner = model("reasoner");
		await capturePayload(reasoner, {});
		expect([reasoner.id, reasoner.reasoning]).toEqual(["reasoner", true]);
		expect(await capturePayload(reasoner, { reasoning: "low" })).toMatchObject({ model: "reasoner" });
	});
});

describe("OMK/reasoner agent turn whose state is off (the loop passes `reasoning: undefined`, key present)", () => {
	it("is never swapped to coder: it goes out as reasoner, thinking enabled, effort low", async () => {
		const payload = await capturePayload(model("reasoner"), { reasoning: undefined });
		expect(payload).toMatchObject({ model: "reasoner", thinking: { type: "enabled" }, reasoning_effort: "low" });
	});
});

describe("OMK/reasoner calls with a reasoning level", () => {
	const inputs = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

	it.each(inputs)("level %s: wire model reasoner, thinking enabled, never disabled", async (level) => {
		const payload = await capturePayload(model("reasoner"), { reasoning: level as never });
		expect(payload.model).toBe("reasoner");
		expect(payload.thinking).toEqual({ type: "enabled" });
		expect(JSON.stringify(payload)).not.toContain("disabled");
	});

	it.each([
		["off", "low"],
		["minimal", "low"],
		["low", "low"],
		["medium", "low"],
		["high", "high"],
		["xhigh", "high"],
		["max", "high"],
	] as const)("effort mapping is pinned: %s goes out as reasoning_effort %s", async (level, effort) => {
		const payload = await capturePayload(model("reasoner"), { reasoning: level as never });
		expect(payload.reasoning_effort).toBe(effort);
	});
});

describe("OMK/coder", () => {
	it("keeps its own wire model and never gets thinking, with or without a level", async () => {
		for (const reasoning of [undefined, "high"] as const) {
			const payload = await capturePayload(model("coder"), { reasoning });
			expect(payload.model).toBe("coder");
			expect(payload).not.toHaveProperty("thinking");
			expect(payload).not.toHaveProperty("reasoning_effort");
		}
	});
});

describe("real AgentSession turns (built like main.ts: services hook, resolveCliModel, SDK clamp)", () => {
	const sent = (wire: { body: Record<string, unknown> }[]) =>
		wire.map(({ body }) => ({ model: body.model, thinking: body.thinking, effort: body.reasoning_effort }));
	const REASONER_LOW = [{ model: "reasoner", thinking: { type: "enabled" }, effort: "low" }];

	it("default settings: level medium, wire reasoner, effort low, thinking enabled", async () => {
		const wire = stubGateway();
		const { session, close } = await openOmkSession("OMK/reasoner");
		expect(session.thinkingLevel).toBe("medium");
		await session.prompt("hello").catch(() => undefined);
		expect(sent(wire)).toEqual(REASONER_LOW);
		close();
	});

	it("`--model OMK/reasoner:off` and an SDK thinkingLevel of off: session level low, wire reasoner/low", async () => {
		for (const [cli, level] of [
			["OMK/reasoner:off", undefined],
			["OMK/reasoner", "off"],
		] as const) {
			const wire = stubGateway();
			const { session, close } = await openOmkSession(cli, level);
			expect(session.thinkingLevel).toBe("low");
			await session.prompt("hello").catch(() => undefined);
			expect(sent(wire)).toEqual(REASONER_LOW);
			close();
		}
	});

	it("a path that skips the session clamp (agent state written as off) still goes out as reasoner/low", async () => {
		const wire = stubGateway();
		const { session, close } = await openOmkSession("OMK/reasoner");
		session.agent.state.thinkingLevel = "off";
		await session.prompt("hello").catch(() => undefined);
		expect(sent(wire)).toEqual(REASONER_LOW);
		close();
	});

	it("explicit high, xhigh and max inputs go out as reasoner/high", async () => {
		for (const cli of ["OMK/reasoner:high", "OMK/reasoner:xhigh"]) {
			const wire = stubGateway();
			const { session, close } = await openOmkSession(cli);
			await session.prompt("hello").catch(() => undefined);
			expect(sent(wire)).toEqual([{ model: "reasoner", thinking: { type: "enabled" }, effort: "high" }]);
			close();
		}
	});

	it("internal calls on the session stream: no level -> coder; compaction carries the session level -> reasoner/low", async () => {
		const wire = stubGateway();
		const { session, close } = await openOmkSession("OMK/reasoner");
		const reasoner = session.model;
		if (!reasoner) throw new Error("no model");
		const context = { messages: [{ role: "user" as const, content: "summarize", timestamp: 0 }] };
		// Branch summaries and other internal calls: no reasoning key.
		await completeSummarization(reasoner, context, { apiKey: "k", maxTokens: 2048 }, session.agent.streamFn).catch(
			() => undefined,
		);
		expect(sent(wire)).toEqual([{ model: "coder", thinking: undefined, effort: undefined }]);
		// Compaction (agent-session.ts passes this.thinkingLevel): a level is present, so it stays on reasoner.
		wire.length = 0;
		const messages = [{ role: "user" as const, content: "hi", timestamp: 0 }];
		const args = [messages, reasoner, 10000, "k", undefined, undefined, undefined, undefined] as const;
		await generateSummary(...args, session.thinkingLevel, session.agent.streamFn).catch(() => undefined);
		expect(sent(wire)).toEqual(REASONER_LOW);
		close();
	});
});
