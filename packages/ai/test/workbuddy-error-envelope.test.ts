import { afterEach, describe, expect, it, vi } from "vitest";
import { getModels } from "../src/models.ts";
import { fetchWithProviderErrorEnvelope } from "../src/providers/openai-error-envelope.ts";
import { streamSimple } from "../src/stream.ts";
import type { Model } from "../src/types.ts";

/**
 * WorkBuddy answers errors with its own JSON envelope, not OpenAI's
 * `{ error: { message } }`. Observed live on 2026-10-20 for a request that
 * opened with a user message:
 *
 *   HTTP 400 {"code":11128,"msg":"first message is not system prompt","requestId":"…","displayMsg":{…},…}
 *
 * The OpenAI SDK reads only `body.error`, so that turn ended as
 * "400 status code (no body)" even though the body explained the refusal, and
 * every 429 the plan answered on 2026-10-19 ended as "429 status code (no body)".
 * The 429 fixture below reuses the 400 envelope shape from the same gateway;
 * its code and text are fixtures, not an observed WorkBuddy rate-limit body.
 */

afterEach(() => vi.unstubAllGlobals());

function workbuddy(id: string): Model<"openai-completions"> {
	const found = getModels("workbuddy").find((entry) => entry.id === id);
	if (!found) throw new Error(`Missing workbuddy/${id}`);
	return found;
}

async function errorFor(
	status: number,
	body: string,
	model = workbuddy("deepseek-v4.1-flash"),
): Promise<string | undefined> {
	const fetch = vi.fn(
		async () => new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8" } }),
	);
	vi.stubGlobal("fetch", fetch);
	const message = await streamSimple(
		model,
		{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
		{ apiKey: "fixture-key" },
	).result();
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(message.stopReason).toBe("error");
	return message.errorMessage;
}

describe("workbuddy error envelope", () => {
	it("keeps WorkBuddy's message, code and request id on a 400", async () => {
		const error = await errorFor(
			400,
			JSON.stringify({
				code: 11128,
				msg: "first message is not system prompt",
				requestId: "req-fixture-400",
				displayMsg: { en: "Request blocked. Please send it again" },
			}),
		);
		expect(error).toBe("400 first message is not system prompt (code 11128, request req-fixture-400)");
	});

	it("keeps the provider's reason on a 429 instead of reporting an empty body", async () => {
		const error = await errorFor(
			429,
			JSON.stringify({ code: 99999, msg: "fixture rate limit text", requestId: "req-fixture-429" }),
		);
		expect(error).toBe("429 fixture rate limit text (code 99999, request req-fixture-429)");
	});

	it("leaves an OpenAI-shaped error body to the SDK", async () => {
		const error = await errorFor(
			400,
			JSON.stringify({ error: { message: "fixture bad request", type: "invalid_request_error" } }),
		);
		expect(error).toBe("400 fixture bad request");
	});

	it("does not rewrite errors from other OpenAI-compatible providers", async () => {
		const error = await errorFor(400, JSON.stringify({ msg: "unrelated provider shape", code: 123 }), {
			...workbuddy("deepseek-v4.1-flash"),
			provider: "unrelated-fixture",
		});
		expect(error).toBe("400 status code (no body)");
	});

	it("still reports a genuinely empty error body as empty", async () => {
		const error = await errorFor(429, "");
		expect(error).toBe("429 status code (no body)");
	});
});

describe("provider error response transport", () => {
	it("preserves status, retry/request headers and fetch arguments", async () => {
		const body = JSON.stringify({ msg: "fixture quota", code: 0, requestId: "request-1" });
		const original = new Response(body, {
			status: 429,
			statusText: "Too Many Requests",
			headers: {
				"content-type": "application/json",
				"retry-after": "7",
				"x-should-retry": "false",
				"x-request-id": "header-request-1",
			},
		});
		const fetch = vi.fn(async () => original);
		vi.stubGlobal("fetch", fetch);
		const input = new URL("https://fixture.invalid/v1/chat/completions");
		const init = { method: "POST", signal: new AbortController().signal };
		const response = await fetchWithProviderErrorEnvelope(input, init);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(input, init);
		expect(response.status).toBe(original.status);
		expect(response.statusText).toBe(original.statusText);
		expect([...response.headers]).toEqual([...original.headers]);
		expect(await response.json()).toEqual({ error: { message: "fixture quota (code 0, request request-1)" } });
	});

	it.each([
		"",
		"not JSON",
		"null",
		"[]",
		'"text"',
		'{"msg":""}',
		'{"msg":"   "}',
		'{"msg":42}',
		'{"msg":"provider message","error":null}',
		'{"error":{"message":"standard OpenAI error"}}',
	])("returns an unrecognized error unchanged: %s", async (body) => {
		const original = new Response(body, { status: 400 });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => original),
		);
		const response = await fetchWithProviderErrorEnvelope("https://fixture.invalid");
		expect(response).toBe(original);
		expect(response.bodyUsed).toBe(false);
		expect(await response.text()).toBe(body);
	});

	it.each([
		[{ msg: "reason" }, "reason"],
		[{ msg: "reason", code: "fixture", requestId: "id" }, "reason (code fixture, request id)"],
		[{ msg: "reason", code: {}, requestId: 42 }, "reason"],
	])("only includes scalar diagnostic fields: %j", async (body, message) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify(body), { status: 400 })),
		);
		const response = await fetchWithProviderErrorEnvelope("https://fixture.invalid");
		expect(await response.json()).toEqual({ error: { message } });
	});

	it("does not inspect or consume a successful streaming response", async () => {
		const original = new Response("data: fixture\n\n", { status: 200 });
		const clone = vi.spyOn(original, "clone");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => original),
		);
		expect(await fetchWithProviderErrorEnvelope("https://fixture.invalid")).toBe(original);
		expect(clone).not.toHaveBeenCalled();
		expect(original.bodyUsed).toBe(false);
	});

	it("preserves fetch cancellation failures", async () => {
		const cause = new DOMException("fixture aborted", "AbortError");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw cause;
			}),
		);
		await expect(fetchWithProviderErrorEnvelope("https://fixture.invalid")).rejects.toBe(cause);
	});
});
