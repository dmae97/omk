/**
 * Spec 052 through a real session: finish-check's discipline text and another
 * appending extension keep the planned cache boundary, so the provider payloads
 * keep their cache hints. A replacing extension still drops them.
 */
import type { StreamFn } from "omk-agent-core";
import { type Context, deriveContextPromptCacheKey, fauxAssistantMessage, getModel } from "omk-ai";
import { streamAnthropic } from "omk-ai/anthropic";
import { streamOpenAIResponses } from "omk-ai/openai-responses";
import { afterEach, describe, expect, it } from "vitest";
import finishCheck from "../../src/core/extensions/builtin/finish-check.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

const APPENDED = "<extension_note>appended by a test extension</extension_note>";

class PayloadCaptured extends Error {}

async function capturePayload(
	run: (onPayload: (payload: unknown) => never) => AsyncIterable<{ type: string }>,
): Promise<Record<string, unknown>> {
	let captured: Record<string, unknown> | undefined;
	const onPayload = (payload: unknown): never => {
		captured = payload as Record<string, unknown>;
		throw new PayloadCaptured();
	};
	try {
		for await (const event of run(onPayload)) if (event.type === "error") break;
	} catch {
		// the payload hook stops the request before any network call
	}
	if (!captured) throw new Error("no payload captured");
	return captured;
}

const anthropicModel = { ...getModel("anthropic", "claude-haiku-4-5"), baseUrl: "https://proxy.invalid/v1" };
const openaiModel = { ...getModel("openai", "gpt-4o-mini"), baseUrl: "https://proxy.invalid/v1" };

const anthropicSystem = async (context: Context) =>
	(
		await capturePayload((onPayload) =>
			streamAnthropic(anthropicModel, context, { apiKey: "fake-key", sessionId: "s1", onPayload }),
		)
	).system as Array<{ text: string; cache_control?: unknown }>;

const openaiCacheKey = async (context: Context) =>
	(
		await capturePayload((onPayload) =>
			streamOpenAIResponses(openaiModel, context, { apiKey: "fake-key", sessionId: "s1", onPayload }),
		)
	).prompt_cache_key;

interface Run {
	readonly plan: string;
	readonly context: Context;
}

async function runTurn(change: (prompt: string) => string, harnesses: Harness[]): Promise<Run> {
	let plan = "";
	// Loaded first, so it sees the plan before any other handler changes it.
	const recordPlan: ExtensionFactory = (omk) => {
		omk.on("before_agent_start", (event) => {
			plan = event.systemPrompt;
			return undefined;
		});
	};
	const changePrompt: ExtensionFactory = (omk) => {
		omk.on("before_agent_start", (event) => ({ systemPrompt: change(event.systemPrompt) }));
	};
	const factories: ExtensionFactory[] = [
		recordPlan,
		(omk) => finishCheck(omk, { env: { OMK_FINISH_CHECK: "always" } }),
		changePrompt,
	];
	const resourceLoader = createTestResourceLoader({ extensionsResult: await createTestExtensionsResult(factories) });
	const harness = await createHarness({ resourceLoader });
	harnesses.push(harness);
	const contexts: Context[] = [];
	const inner = harness.session.agent.streamFn;
	const capture: StreamFn = (model, context, options) => {
		contexts.push({ ...context, messages: [...context.messages] });
		return inner(model, context, options);
	};
	harness.session.agent.streamFn = capture;
	harness.setResponses([fauxAssistantMessage("ok")]);
	await harness.session.prompt("Say ok.");
	expect(contexts).toHaveLength(1);
	return { plan, context: contexts[0] };
}

describe("system prompt cache boundary with extension text (spec 052)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("keeps the planned boundary when finish-check and an extension append text", async () => {
		const { plan, context } = await runTurn((prompt) => `${prompt}\n\n${APPENDED}`, harnesses);
		const boundary = context.systemPromptCacheBoundary;
		expect(plan.length).toBeGreaterThan(0);
		expect(context.systemPrompt?.startsWith(plan)).toBe(true);
		expect(context.systemPrompt).toContain("<finish_discipline>");
		expect(context.systemPrompt?.endsWith(APPENDED)).toBe(true);
		expect(context.systemPromptCacheBoundaryBypass).toBe(false);
		expect(boundary).toBeGreaterThan(0);
		expect(boundary).toBeLessThanOrEqual(plan.length);

		// Anthropic: the cached block is exactly the planned stable prefix; the appended text is outside it.
		const system = await anthropicSystem(context);
		expect(system[0]).toEqual({ type: "text", text: plan.slice(0, boundary), cache_control: { type: "ephemeral" } });
		expect(system).toHaveLength(2);
		expect(system[1].cache_control).toBeUndefined();
		expect(system[1].text).toContain(APPENDED);
		expect(system[1].text).toContain("<finish_discipline>");

		// OpenAI: a content-derived key, the same as for the plan alone.
		const key = await openaiCacheKey(context);
		expect(key).toBeDefined();
		expect(key).toBe(
			deriveContextPromptCacheKey({ ...context, systemPrompt: plan }, `${openaiModel.provider}/${openaiModel.id}`),
		);
	});

	it("still drops the boundary when an extension replaces the system prompt", async () => {
		const { context } = await runTurn(() => "Extension-controlled replacement.", harnesses);
		expect(context.systemPromptCacheBoundary).toBeUndefined();
		expect(context.systemPromptCacheBoundaryBypass).toBe(true);
		expect(await anthropicSystem(context)).toEqual([{ type: "text", text: "Extension-controlled replacement." }]);
		expect(await openaiCacheKey(context)).toBeUndefined();
	});
});
