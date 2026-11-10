import { type AssistantMessage, isRetryableAssistantError, streamSimple } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatNoApiKeyFoundMessage } from "../src/core/auth-guidance.ts";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { FIXTURE_TOKEN, ON_ENV, registryWithOmk } from "./omk-provider-flag-on-lib.ts";
import { createCatalogRegistry } from "./omk-provider-golden-lib.ts";

/** The gateway's error envelope and headers (gateway/src/errors.ts). */
function gatewayError(
	status: number,
	code: string,
	message: string,
	headers: Record<string, string> = {},
): () => Response {
	return () =>
		new Response(JSON.stringify({ error: { message, type: "x", code, param: null } }), {
			status,
			headers: { "content-type": "application/json", ...headers },
		});
}

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

function sseOk(): Response {
	return new Response(SSE_OK, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Answers the queued responses in order (the last one repeats) and counts the calls. */
function stubFetch(...replies: (() => Response)[]) {
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: unknown) => {
			calls.push(String(input instanceof Request ? input.url : input));
			return (replies[Math.min(calls.length, replies.length) - 1] ?? replies[0])();
		}),
	);
	return calls;
}

async function ask(
	apiKey: string | undefined,
	id: "coder" | "reasoner" = "coder",
	extra: Record<string, unknown> = {},
): Promise<AssistantMessage> {
	const model = registryWithOmk().find("OMK", id);
	if (!model) throw new Error("OMK model missing");
	return streamSimple(
		model,
		{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
		{ apiKey, reasoning: id === "reasoner" ? "low" : undefined, maxRetries: 3, ...extra },
	).result();
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("OMK gateway errors: quota and per-request limits are not retried", () => {
	it("monthly quota 429 (quota_exceeded + x-omk-retryable: false) is sent once, even with a short Retry-After", async () => {
		const calls = stubFetch(
			gatewayError(429, "quota_exceeded", "Monthly token budget used (5000000 of 5000000). Resets 2026-12-01.", {
				"retry-after": "1",
				"x-omk-retryable": "false",
			}),
		);
		const message = await ask(FIXTURE_TOKEN);
		expect(calls).toHaveLength(1);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("OMK monthly quota exceeded");
		expect(message.errorMessage).toContain("Resets 2026-12-01");
		// The turn-level retry (which reads the text) must agree with the gateway: do not retry.
		expect(isRetryableAssistantError(message)).toBe(false);
	});

	it("request_limit_exceeded with x-omk-retryable: false is sent once and not retried at turn level", async () => {
		const calls = stubFetch(
			gatewayError(429, "request_limit_exceeded", "max_tokens 999999 is above the per-request limit of 393216.", {
				"retry-after": "0",
				"x-omk-retryable": "false",
			}),
		);
		const message = await ask(FIXTURE_TOKEN);
		expect(calls).toHaveLength(1);
		expect(message.errorMessage).toContain("OMK per-request limit exceeded (request_limit_exceeded, not retried)");
		expect(isRetryableAssistantError(message)).toBe(false);
	});
});

describe("OMK gateway errors: 429 rate_limited is retried and honors Retry-After", () => {
	it("waits the Retry-After seconds, then succeeds on the second call", async () => {
		const calls = stubFetch(
			gatewayError(429, "rate_limited", "Too many concurrent requests for this token. Retry in 1 second.", {
				"retry-after": "1",
			}),
			sseOk,
		);
		const started = Date.now();
		const message = await ask(FIXTURE_TOKEN);
		expect(calls).toHaveLength(2);
		expect(Date.now() - started).toBeGreaterThanOrEqual(900);
		expect(message.stopReason).toBe("stop");
	});

	it("when it stays throttled the final text names rate_limited and is retryable at turn level", async () => {
		stubFetch(
			gatewayError(429, "rate_limited", "Too many concurrent requests for this token. Retry in 1 second.", {
				"retry-after": "0",
			}),
		);
		const message = await ask(FIXTURE_TOKEN);
		expect(message.errorMessage).toContain("OMK rate limited (429 rate_limited)");
		expect(isRetryableAssistantError(message)).toBe(true);
	});
});

describe("OMK gateway errors: token problems have distinct texts", () => {
	const cases: [string, number, string, string, string][] = [
		[
			"invalid",
			401,
			"token_invalid",
			"The token is not valid. Check OMK_ACCOUNT_TOKEN or ask for a new one.",
			"OMK token rejected (401 token_invalid)",
		],
		[
			"expired",
			401,
			"token_expired",
			"This token has expired. Ask the admin for a new token.",
			"OMK token expired (401 token_expired)",
		],
		[
			"revoked",
			403,
			"token_revoked",
			"This token was revoked. Ask the admin for a new token.",
			"OMK token revoked (403 token_revoked)",
		],
		[
			"model not allowed",
			403,
			"model_not_allowed",
			"This model is not available for this token.",
			"OMK model not allowed for this token (403 model_not_allowed)",
		],
	];

	it.each(cases)("%s: %s %s -> one request, own text", async (_name, status, code, gatewayText, expected) => {
		const calls = stubFetch(gatewayError(status, code, gatewayText));
		const message = await ask(FIXTURE_TOKEN);
		expect(calls).toHaveLength(1);
		expect(message.errorMessage).toContain(expected);
		expect(isRetryableAssistantError(message)).toBe(false);
	});

	it("missing, invalid (401), expired, forbidden (403) and rate-limited (429) produce five distinct messages", async () => {
		const texts: string[] = [];
		const noKey = stubFetch(sseOk);
		texts.push((await ask(undefined)).errorMessage ?? "");
		expect(noKey).toHaveLength(0); // no token: nothing is sent
		for (const [status, code, text, headers] of [
			[401, "token_invalid", "The token is not valid.", {}],
			[401, "token_expired", "This token has expired.", {}],
			[403, "token_revoked", "This token was revoked.", {}],
			[
				429,
				"rate_limited",
				"Too many concurrent requests for this token. Retry in 0 seconds.",
				{ "retry-after": "0" },
			],
		] as const) {
			stubFetch(gatewayError(status, code, text, { ...headers }));
			texts.push((await ask(FIXTURE_TOKEN)).errorMessage ?? "");
		}
		expect(texts[0]).toBe("OMK account token missing. Set OMK_ACCOUNT_TOKEN or run /login and choose OMK.");
		expect(new Set(texts).size).toBe(5);
	});

	it("a gateway token_missing (401) gets the same text as a missing token on the client", async () => {
		stubFetch(gatewayError(401, "token_missing", "No token provided."));
		expect((await ask(FIXTURE_TOKEN)).errorMessage).toBe(
			"OMK account token missing. Set OMK_ACCOUNT_TOKEN or run /login and choose OMK.",
		);
	});

	it("errors that are not account or limit errors keep the provider's own text", async () => {
		stubFetch(gatewayError(400, "invalid_request", "Check the request parameters.", {}));
		expect((await ask(FIXTURE_TOKEN)).errorMessage).toBe("400 Check the request parameters.");
		stubFetch(
			() => new Response("<html>bad gateway</html>", { status: 401, headers: { "content-type": "text/html" } }),
		);
		expect((await ask(FIXTURE_TOKEN)).errorMessage).toMatch(/^401/);
	});
});

describe("OMK base URL and credential prompts", () => {
	it("base URL missing: its own warning, no OMK models, and a text unlike the token texts", () => {
		const registry = createCatalogRegistry();
		const diagnostics = registerOmkProviderIfEnabled(registry, { OMK_PROVIDER_OMK: "1" });
		expect(diagnostics).toEqual([
			{
				type: "warning",
				message:
					"OMK gateway base URL missing. Set OMK_GATEWAY_BASE_URL (for example https://host/v1); the OMK models are unavailable until it is set.",
			},
		]);
		expect(registry.find("OMK", "coder")).toBeUndefined();
	});

	it("the no-credential prompt text names OMK_ACCOUNT_TOKEN and /login with the flag on, and is unchanged otherwise", () => {
		const generic = formatNoApiKeyFoundMessage("OMK");
		expect(generic).toMatch(/^No API key found for OMK\./);
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		expect(formatNoApiKeyFoundMessage("OMK")).toBe(
			"OMK account token missing. Set OMK_ACCOUNT_TOKEN or run /login and choose OMK.",
		);
		expect(formatNoApiKeyFoundMessage("openai")).toMatch(/^No API key found for openai\./);
	});

	it("flag on with a base URL registers cleanly (no diagnostics)", () => {
		expect(registerOmkProviderIfEnabled(createCatalogRegistry(), ON_ENV)).toEqual([]);
	});
});

describe("OMK token never appears in errors, diagnostics or logs", () => {
	const SECRET = "omk-test-token-not-a-secret";

	it("not even when the gateway echoes it back", async () => {
		const sinks: string[] = [];
		const capture = (...args: unknown[]) => sinks.push(args.map(String).join(" "));
		for (const level of ["log", "info", "warn", "error", "debug"] as const)
			vi.spyOn(console, level).mockImplementation(capture);
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			sinks.push(String(chunk));
			return true;
		});
		vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			sinks.push(String(chunk));
			return true;
		});

		const echoes: (() => Response)[] = [
			gatewayError(401, "token_invalid", `Token ${SECRET} is not valid`),
			gatewayError(403, "token_revoked", `revoked: ${SECRET}`),
			gatewayError(429, "quota_exceeded", `quota for ${SECRET}`, { "x-omk-retryable": "false" }),
			gatewayError(429, "rate_limited", `slow down ${SECRET}`, { "retry-after": "0" }),
			gatewayError(400, "invalid_request", `bad body from ${SECRET}`),
			gatewayError(500, "upstream_unavailable", `oops ${SECRET}`),
		];
		const messages: AssistantMessage[] = [];
		for (const echo of echoes) {
			stubFetch(echo);
			messages.push(await ask(SECRET, "coder", { maxRetries: 0 }));
		}
		messages.push(await ask(undefined));
		for (const message of messages) {
			expect(message.stopReason).toBe("error");
			expect(JSON.stringify(message)).not.toContain(SECRET);
		}
		expect(sinks.join("\n")).not.toContain(SECRET);
		expect(
			JSON.stringify(registerOmkProviderIfEnabled(createCatalogRegistry(), { OMK_PROVIDER_OMK: "1" })),
		).not.toContain(SECRET);
	});

	it("the request observer leaves other fetch callers alone", async () => {
		stubFetch(gatewayError(429, "quota_exceeded", "x", { "x-omk-retryable": "false" }));
		await ask(FIXTURE_TOKEN);
		const other = await fetch("https://example.invalid/");
		expect(other.headers.get("x-should-retry")).toBeNull();
		expect(((await other.json()) as { error: { code: string } }).error.code).toBe("quota_exceeded");
	});
});
