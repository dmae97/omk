import { type Api, type Model, streamSimple } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { FIXTURE_TOKEN, GATEWAY_URL, registryWithOmk } from "./omk-provider-flag-on-lib.ts";
import { createCatalogRegistry, FLAG_OFF_VARIANTS, variantLabel } from "./omk-provider-golden-lib.ts";

/**
 * The OMK request observer wraps `globalThis.fetch` on the first OMK request (gateway-capture.ts). These tests pin
 * the two v1 conditions: with the flag off it is never installed, and once installed every non-OMK call reaches the
 * original fetch with the same arguments and returns the same response object.
 * The flag-off block runs first in this file, before any OMK request could have installed the wrapper.
 */
const SSE_OK = [
	{ id: "1", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] },
	{
		id: "1",
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	},
]
	.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
	.concat("data: [DONE]\n\n")
	.join("");

const sseOk = () => new Response(SSE_OK, { status: 200, headers: { "content-type": "text/event-stream" } });

function stubFetch(reply: () => Response) {
	const stub = vi.fn(async (_input: unknown, _init?: unknown) => reply());
	vi.stubGlobal("fetch", stub);
	return stub;
}

function firstModel(provider: string, api: string): Model<Api> {
	const model = createCatalogRegistry()
		.getAll()
		.find((m) => m.provider === provider && m.api === api);
	if (!model) throw new Error(`no ${provider} ${api} model in the catalog`);
	return model;
}

const ask = (model: Model<Api>, apiKey: string) =>
	streamSimple(
		model,
		{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
		{ apiKey, maxRetries: 0 },
	).result();

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("OMK fetch observer, flag off: never installed", () => {
	it.each(FLAG_OFF_VARIANTS)("OMK_PROVIDER_OMK=%j: globalThis.fetch stays the original function", async (value) => {
		const registry = createCatalogRegistry();
		const env: NodeJS.ProcessEnv = { OMK_GATEWAY_BASE_URL: GATEWAY_URL };
		if (value !== undefined) env.OMK_PROVIDER_OMK = value;
		expect(registerOmkProviderIfEnabled(registry, env), variantLabel(value)).toEqual([]);
		expect(registry.find("OMK", "coder")).toBeUndefined();
		const stub = stubFetch(sseOk);
		await ask(firstModel("deepseek", "openai-completions"), "fixture-openai-key");
		expect(stub).toHaveBeenCalled();
		expect(globalThis.fetch).toBe(stub);
	});
});

describe("OMK fetch observer, installed: non-OMK calls pass through unchanged", () => {
	it("is installed by an OMK request (flag on)", async () => {
		const stub = stubFetch(sseOk);
		const model = registryWithOmk().find("OMK", "coder");
		if (!model) throw new Error("OMK model missing");
		await ask(model, FIXTURE_TOKEN);
		expect(globalThis.fetch).not.toBe(stub);
	});

	it.each([
		["200", () => new Response("ok", { status: 200 })],
		[
			"429 with a gateway envelope and x-omk-retryable: false",
			() =>
				new Response(JSON.stringify({ error: { code: "quota_exceeded", message: "x" } }), {
					status: 429,
					headers: { "x-omk-retryable": "false" },
				}),
		],
	])("%s: same arguments in, same response object out", async (_label, make) => {
		const replies: Response[] = [];
		const stub = stubFetch(() => {
			const response = make();
			replies.push(response);
			return response;
		});
		const model = registryWithOmk().find("OMK", "coder");
		if (!model) throw new Error("OMK model missing");
		stub.mockImplementationOnce(async () => sseOk());
		await ask(model, FIXTURE_TOKEN);
		const wrapped = globalThis.fetch;
		expect(wrapped).not.toBe(stub);

		const input = "https://example.invalid/other";
		const init: RequestInit = { method: "POST", headers: { "x-fixture": "1" }, body: "payload" };
		const response = await wrapped(input, init);
		const call = stub.mock.calls.at(-1);
		expect(call?.[0]).toBe(input);
		expect(call?.[1]).toBe(init);
		expect(response).toBe(replies.at(-1));
		expect(response.headers.get("x-should-retry")).toBeNull();
	});
});
