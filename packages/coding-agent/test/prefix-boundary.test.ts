/**
 * Spec 102 (`OMK_PREFIX_BOUNDARY`): keep the cache boundary when only the
 * dynamic tail after it differs. Checked through the real request payloads of
 * every adapter that reads the boundary.
 */
import { type Context, getModel, type Model } from "omk-ai";
import { streamAnthropic } from "omk-ai/anthropic";
import { streamAzureOpenAIResponses } from "omk-ai/azure-openai-responses";
import { streamOpenAICodexResponses } from "omk-ai/openai-codex-responses";
import { streamOpenAICompletions } from "omk-ai/openai-completions";
import { streamOpenAIResponses } from "omk-ai/openai-responses";
import { describe, expect, it } from "vitest";
import { boundaryChangeReason } from "../src/core/request-trace-metadata.ts";
import {
	isPrefixBoundaryEnabled,
	PrefixBoundaryCauseHolder,
	resolveExtendedSystemPromptCache,
	type SystemPromptCachePlan,
	type SystemPromptCacheState,
} from "../src/core/system-prompt-cache-boundary.ts";

/** Verbatim copy of the resolver body on `main` a3f7a3a1ac (spec 052), the flag-off reference. */
function mainResolver(plan: SystemPromptCachePlan, systemPrompt: string): SystemPromptCacheState {
	if (systemPrompt === plan.prompt) return { cacheBoundary: plan.cacheBoundary, bypass: false };
	const boundary = plan.cacheBoundary;
	const validBoundary =
		boundary !== undefined && Number.isSafeInteger(boundary) && boundary > 0 && boundary <= plan.prompt.length;
	if (plan.prompt.length > 0 && validBoundary && systemPrompt.startsWith(plan.prompt)) {
		return { cacheBoundary: boundary, bypass: false };
	}
	return { cacheBoundary: undefined, bypass: true };
}

class PayloadCaptured extends Error {}

async function capture(
	run: (onPayload: (payload: unknown) => never) => AsyncIterable<{ type: string }>,
): Promise<Record<string, unknown>> {
	let captured: Record<string, unknown> | undefined;
	const onPayload = (payload: unknown): never => {
		captured = structuredClone(payload) as Record<string, unknown>;
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

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const FAKE_CODEX_JWT = `${b64({ alg: "none" })}.${b64({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-test" } })}.sig`;

const anthropicModel = { ...getModel("anthropic", "claude-haiku-4-5"), baseUrl: "https://proxy.invalid/v1" };
const openaiModel = getModel("openai", "gpt-4o-mini");
const azureModel = getModel("azure-openai-responses", "gpt-4o-mini");
const codexModel = getModel("openai-codex", "gpt-5.5");
const completionsModel = {
	...openaiModel,
	api: "openai-completions",
	baseUrl: "https://api.openai.com/v1",
} as Model<"openai-completions">;

interface Sent {
	/** Full system text as it appears in the request body. */
	readonly system: string;
	/** Anthropic: cached flag per system block. OpenAI: `prompt_cache_key`. */
	readonly marker: unknown;
	readonly body: Record<string, unknown>;
}

type Adapter = (context: Context) => Promise<Sent>;

function responsesSystem(body: Record<string, unknown>): string {
	const input = body.input as Array<{ role?: string; content?: unknown }>;
	const first = input.find((item) => item.role === "system" || item.role === "developer");
	return typeof first?.content === "string" ? first.content : "";
}

const adapters: Record<string, Adapter> = {
	anthropic: async (context) => {
		const body = await capture((onPayload) =>
			streamAnthropic(anthropicModel, context, { apiKey: "fake-key", sessionId: "s1", onPayload }),
		);
		const blocks = body.system as Array<{ text: string; cache_control?: unknown }>;
		return {
			body,
			system: blocks.map((b) => b.text).join(""),
			marker: blocks.map((b) => b.cache_control !== undefined),
		};
	},
	"openai-responses": async (context) => {
		const body = await capture((onPayload) =>
			streamOpenAIResponses(openaiModel, context, { apiKey: "fake-key", sessionId: "s1", onPayload }),
		);
		return { body, system: responsesSystem(body), marker: body.prompt_cache_key };
	},
	"azure-openai-responses": async (context) => {
		const body = await capture((onPayload) =>
			streamAzureOpenAIResponses(azureModel, context, {
				apiKey: "fake-key",
				sessionId: "s1",
				azureBaseUrl: "https://example.invalid/openai/v1",
				onPayload,
			}),
		);
		return { body, system: responsesSystem(body), marker: body.prompt_cache_key };
	},
	"openai-codex-responses": async (context) => {
		const body = await capture((onPayload) =>
			streamOpenAICodexResponses(codexModel, context, {
				apiKey: FAKE_CODEX_JWT,
				sessionId: "s1",
				transport: "sse",
				onPayload,
			}),
		);
		return { body, system: String(body.instructions), marker: body.prompt_cache_key };
	},
	"openai-completions": async (context) => {
		const body = await capture((onPayload) =>
			streamOpenAICompletions(completionsModel, context, { apiKey: "fake-key", sessionId: "s1", onPayload }),
		);
		const messages = body.messages as Array<{ role: string; content: unknown }>;
		const first = messages.find((m) => m.role === "system" || m.role === "developer");
		return { body, system: String(first?.content ?? ""), marker: body.prompt_cache_key };
	},
};

const STABLE = "You are a coding agent.\n<rules>Never push to main.</rules>";
const TAIL_A = "\nCurrent date: 2026-10-20\nRule version one.";
const TAIL_B = "\nCurrent date: 2026-10-21\nRule version two.";
const EMOJI = "\u{1F600}";

function contextFor(plan: SystemPromptCachePlan, systemPrompt: string, prefixBoundary: boolean): Context {
	const cache = resolveExtendedSystemPromptCache(plan, systemPrompt, { prefixBoundary });
	return {
		systemPrompt,
		systemPromptCacheBoundary: cache.cacheBoundary,
		systemPromptCacheBoundaryBypass: cache.bypass,
		messages: [{ role: "user", content: "Say ok.", timestamp: 1 }],
	};
}

const cachedMarkerPresent = (name: string, sent: Sent) =>
	name === "anthropic" ? (sent.marker as boolean[])[0] === true : typeof sent.marker === "string";

describe("spec 102 resolver", () => {
	const plan = { prompt: `${STABLE}${TAIL_A}`, cacheBoundary: STABLE.length };

	it("reads OMK_PREFIX_BOUNDARY, default on; 0/false/off opt out", () => {
		expect(isPrefixBoundaryEnabled({})).toBe(true);
		expect(isPrefixBoundaryEnabled({ OMK_PREFIX_BOUNDARY: "0" })).toBe(false);
		expect(isPrefixBoundaryEnabled({ OMK_PREFIX_BOUNDARY: "false" })).toBe(false);
		expect(isPrefixBoundaryEnabled({ OMK_PREFIX_BOUNDARY: " OFF " })).toBe(false);
		expect(isPrefixBoundaryEnabled({ OMK_PREFIX_BOUNDARY: "1" })).toBe(true);
		expect(isPrefixBoundaryEnabled({ OMK_PREFIX_BOUNDARY: "true" })).toBe(true);
	});

	it("records a cause only when the prefix matched", () => {
		const tail = `${STABLE}${TAIL_B}`;
		expect(resolveExtendedSystemPromptCache(plan, tail, { prefixBoundary: true }).cause).toBe("suffix_changed");
		expect(resolveExtendedSystemPromptCache(plan, tail, { prefixBoundary: false }).cause).toBe("flag_off");
		expect(resolveExtendedSystemPromptCache(plan, `x${tail}`, { prefixBoundary: true }).cause).toBeUndefined();
		expect(
			resolveExtendedSystemPromptCache(plan, `${plan.prompt}more`, { prefixBoundary: true }).cause,
		).toBeUndefined();
		expect(resolveExtendedSystemPromptCache(plan, STABLE, { prefixBoundary: true })).toEqual({
			cacheBoundary: STABLE.length,
			bypass: false,
			cause: "suffix_changed",
		});
		expect(resolveExtendedSystemPromptCache(plan, STABLE.slice(0, -1), { prefixBoundary: true }).bypass).toBe(true);
	});

	it("maps the cause onto boundaryChangeReason, with first, tool changes and unavailable still winning", () => {
		const a = { prefix: "p1", tools: "t1" };
		expect(boundaryChangeReason(a, { prefix: "p2", tools: "t1" }, "suffix_changed")).toBe("suffix_changed");
		expect(boundaryChangeReason(undefined, a, "flag_off")).toBe("first");
		expect(boundaryChangeReason(a, a, "bypass_surrogate")).toBe("bypass_surrogate");
		expect(boundaryChangeReason(a, { prefix: "p2", tools: "t2" }, "suffix_changed")).toBe("prefix_and_tools_changed");
		expect(boundaryChangeReason(a, undefined, "suffix_changed")).toBe("unavailable");
		expect(boundaryChangeReason(a, { prefix: "p2", tools: "t1" })).toBe("prefix_changed");
	});

	it("hands the cause to the trace once, for the exact prompt only", () => {
		const causes = new PrefixBoundaryCauseHolder();
		causes.record("prompt-1", { cause: "suffix_changed" });
		expect(causes.take("prompt-2")).toBeUndefined();
		expect(causes.take("prompt-1")).toEqual({ cause: "suffix_changed" });
		expect(causes.take("prompt-1")).toBeUndefined();
		causes.record("prompt-1", { cause: "flag_off" });
		causes.record("prompt-1", undefined);
		expect(causes.take("prompt-1")).toBeUndefined();
	});

	it("keeps causes per session when two sessions share the same prompt", () => {
		const prompt = `${STABLE}${TAIL_B}`;
		const on = { cause: "suffix_changed" } as const;
		const off = { cause: "flag_off", shadowCause: "suffix_changed" } as const;
		const orders: Array<Array<"recA" | "recB" | "takeA" | "takeB">> = [
			["recA", "recB", "takeA", "takeB"],
			["recA", "recB", "takeB", "takeA"],
			["recB", "recA", "takeA", "takeB"],
			["recA", "takeA", "recB", "takeB"],
			["recB", "takeB", "recA", "takeA"],
			["recA", "recB", "takeB", "recA", "takeA", "takeA"],
		];
		for (const order of orders) {
			const a = new PrefixBoundaryCauseHolder();
			const b = new PrefixBoundaryCauseHolder();
			const taken: { A: unknown[]; B: unknown[] } = { A: [], B: [] };
			for (const step of order) {
				if (step === "recA") a.record(prompt, on);
				else if (step === "recB") b.record(prompt, off);
				else if (step === "takeA") taken.A.push(a.take(prompt));
				else taken.B.push(b.take(prompt));
			}
			expect(taken.A[0], order.join(",")).toEqual(on);
			expect(taken.B[0], order.join(",")).toEqual(off);
			// a second read of the same session never sees the other session's cause
			for (const extra of taken.A.slice(1)) expect(extra).toBeUndefined();
		}
	});

	it("gives the off arm the flag-on cause as a shadow", () => {
		const prefix = `${STABLE}${EMOJI}`;
		expect(resolveExtendedSystemPromptCache(plan, `${STABLE}${TAIL_B}`, { prefixBoundary: false })).toEqual({
			cacheBoundary: undefined,
			bypass: true,
			cause: "flag_off",
			shadowCause: "suffix_changed",
		});
		const split = { prompt: `${prefix}${TAIL_A}`, cacheBoundary: prefix.length - 1 };
		expect(resolveExtendedSystemPromptCache(split, `${prefix}${TAIL_B}`, { prefixBoundary: false }).shadowCause).toBe(
			"bypass_surrogate",
		);
		expect(
			resolveExtendedSystemPromptCache(plan, `${STABLE}${TAIL_B}`, { prefixBoundary: true }).shadowCause,
		).toBeUndefined();
	});
});

describe.each(Object.entries(adapters))("spec 102 payloads: %s", (name, send) => {
	const plan = { prompt: `${STABLE}${TAIL_A}`, cacheBoundary: STABLE.length };

	it("§4.1/§4.3 tail A→B keeps the boundary and sends tail B verbatim", async () => {
		const tailA = await send(contextFor(plan, plan.prompt, true));
		const prompt = `${STABLE}${TAIL_B}`;
		const tailB = await send(contextFor(plan, prompt, true));
		expect(tailB.system).toBe(prompt);
		expect(cachedMarkerPresent(name, tailB)).toBe(true);
		if (name === "anthropic") {
			const blocks = tailB.body.system as Array<{ text: string; cache_control?: unknown }>;
			expect(blocks).toHaveLength(2);
			expect(blocks[0].text).toBe(STABLE);
			expect(blocks[1]).toEqual({ type: "text", text: TAIL_B });
		} else {
			expect(tailB.marker).toBe(tailA.marker);
		}
	});

	it("§4.2/§4.3 a one-unit change before the boundary bypasses", async () => {
		const prompt = `${STABLE.replace("main", "mair")}${TAIL_B}`;
		const sent = await send(contextFor(plan, prompt, true));
		expect(sent.system).toBe(prompt);
		if (name === "anthropic") expect(sent.marker).toEqual([false]);
		else expect(sent.marker).toBeUndefined();
	});

	it("§4.4a a boundary splitting a surrogate pair bypasses, emoji intact", async () => {
		const prefix = `${STABLE}${EMOJI}`;
		const splitPlan = { prompt: `${prefix}${TAIL_A}`, cacheBoundary: prefix.length - 1 };
		const prompt = `${prefix}${TAIL_B}`;
		const cache = resolveExtendedSystemPromptCache(splitPlan, prompt, { prefixBoundary: true });
		expect(cache).toEqual({ cacheBoundary: undefined, bypass: true, cause: "bypass_surrogate" });
		const sent = await send(contextFor(splitPlan, prompt, true));
		expect(sent.system).toBe(prompt);
		expect(sent.system).toContain(EMOJI);
		if (name === "anthropic") expect(sent.marker).toEqual([false]);
		else expect(sent.marker).toBeUndefined();
	});

	it("§4.4b an emoji ending exactly at the boundary keeps it", async () => {
		const prefix = `${STABLE}${EMOJI}`;
		const abutPlan = { prompt: `${prefix}${TAIL_A}`, cacheBoundary: prefix.length };
		const prompt = `${prefix}${TAIL_B}`;
		const sent = await send(contextFor(abutPlan, prompt, true));
		expect(sent.system).toBe(prompt);
		expect(cachedMarkerPresent(name, sent)).toBe(true);
		if (name === "anthropic") {
			const blocks = sent.body.system as Array<{ text: string }>;
			expect(blocks[0].text).toBe(prefix);
			expect(blocks[0].text.endsWith(EMOJI)).toBe(true);
		}
	});

	it("§4.5 flag off: payloads deep-equal the main implementation over the corpus", async () => {
		const corpus: Array<[SystemPromptCachePlan, string]> = [
			[plan, plan.prompt], // equal
			[plan, `${plan.prompt}\n<extension_note/>`], // appended
			[plan, `${STABLE}${TAIL_B}`], // tail-changed
			[plan, `X${STABLE}${TAIL_A}`], // prefix-changed
			[plan, "Extension-controlled replacement."], // replaced
			[{ prompt: "", cacheBoundary: 0 }, "anything"], // empty plan
			[{ prompt: plan.prompt, cacheBoundary: plan.prompt.length + 1 }, `${STABLE}${TAIL_B}`], // invalid boundary
			[{ prompt: plan.prompt, cacheBoundary: 1.5 }, `${plan.prompt}x`], // invalid boundary
		];
		for (const [p, prompt] of corpus) {
			const ref = mainResolver(p, prompt);
			const offCache = resolveExtendedSystemPromptCache(p, prompt, { prefixBoundary: false });
			expect({ cacheBoundary: offCache.cacheBoundary, bypass: offCache.bypass }).toEqual(ref);
			const off = await send(contextFor(p, prompt, false));
			const main = await send({
				systemPrompt: prompt,
				systemPromptCacheBoundary: ref.cacheBoundary,
				systemPromptCacheBoundaryBypass: ref.bypass,
				messages: [{ role: "user", content: "Say ok.", timestamp: 1 }],
			});
			expect(off.body).toEqual(main.body);
		}
	});
});
