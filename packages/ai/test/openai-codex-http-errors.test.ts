import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses.ts";
import { isRetryableAssistantError } from "../src/utils/retry.ts";

const model = getModel("openai-codex", "gpt-5.6-sol");
const context = { messages: [{ role: "user" as const, content: "test", timestamp: 0 }] };
const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString(
	"base64url",
);
const options = { apiKey: `test.${payload}.test`, transport: "sse" as const };
const html = `<!DOCTYPE html><html><body>
<div class="cf-error-details cf-error-520">Web server is returning an unknown error</div>
<p>private-response-marker <script>alert("untrusted")</script></p>
</body></html>`;

function htmlResponse(status = 520, headers: Record<string, string> = {}): Response {
	return new Response(html, { status, headers: { "content-type": "text/html", ...headers } });
}

function successResponse(): Response {
	return new Response(
		`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [] } })}\n\n`,
		{ headers: { "content-type": "text/event-stream" } },
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("Codex HTTP error boundary", () => {
	it("summarizes Cloudflare HTML with HTTP status and a validated Ray ID", async () => {
		const fetchMock = vi.fn(async () => htmlResponse(520, { "cf-ray": "a51f9ce6ddab15f0-ICN" }));
		vi.stubGlobal("fetch", fetchMock);
		const result = await streamOpenAICodexResponses(model, context, options).result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("HTTP 520");
		expect(result.errorMessage).toContain("HTML error page");
		expect(result.errorMessage).toContain("a51f9ce6ddab15f0-ICN");
		expect(result.errorMessage).not.toMatch(/<|private-response-marker|alert/);
		expect(result.errorMessage?.length).toBeLessThan(300);
		expect(isRetryableAssistantError(result)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each<{ body: string; headers: Record<string, string> }>([
		{ body: html, headers: {} },
		{ body: html, headers: { "content-type": "text/plain" } },
		{ body: "<div>private-response-marker</div>", headers: { "content-type": "text/html" } },
		{ body: "<div>private-response-marker</div>", headers: { "content-type": "application/xhtml+xml" } },
	])("does not expose HTML when content type or document markup identifies it: %j", async ({ body, headers }) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 502, headers })),
		);
		const result = await streamOpenAICodexResponses(model, context, options).result();
		expect(result.errorMessage).toContain("HTTP 502");
		expect(result.errorMessage).not.toMatch(/<|private-response-marker/);
	});

	it("does not reflect an invalid Ray header or HTML status text", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(html, {
						status: 520,
						statusText: "<script>private</script>",
						headers: {
							"content-type": "text/html",
							"cf-ray": "untrusted-header-marker",
						},
					}),
			),
		);
		const result = await streamOpenAICodexResponses(model, context, options).result();
		expect(result.errorMessage).toContain("HTTP 520");
		expect(result.errorMessage).not.toMatch(/<|private|untrusted-header-marker/);
	});

	it.each([520, 521, 522, 523, 524, 525, 526, 527])(
		"retries HTTP %i only within the configured budget",
		async (status) => {
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(htmlResponse(status, { "retry-after": "0" }))
				.mockResolvedValueOnce(successResponse());
			vi.stubGlobal("fetch", fetchMock);
			const result = await streamOpenAICodexResponses(model, context, { ...options, maxRetries: 1 }).result();
			expect(result.stopReason).toBe("stop");
			expect(fetchMock).toHaveBeenCalledTimes(2);
		},
	);

	it("stops after the retry budget is exhausted", async () => {
		const fetchMock = vi.fn(async () => htmlResponse(520, { "retry-after": "0" }));
		vi.stubGlobal("fetch", fetchMock);
		const result = await streamOpenAICodexResponses(model, context, { ...options, maxRetries: 1 }).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("HTTP 520");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("keeps the retry delay cap for a Cloudflare error", async () => {
		const fetchMock = vi.fn(async () => htmlResponse(520, { "retry-after": "120" }));
		vi.stubGlobal("fetch", fetchMock);
		const result = await streamOpenAICodexResponses(model, context, { ...options, maxRetries: 1 }).result();
		expect(result.errorMessage).toContain("Server requested 120s retry delay (max: 60s)");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("cancels backoff without sending another request", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const fetchMock = vi.fn(async () => htmlResponse(520, { "retry-after": "10" }));
		vi.stubGlobal("fetch", fetchMock);
		const pending = streamOpenAICodexResponses(model, context, {
			...options,
			maxRetries: 1,
			signal: controller.signal,
		}).result();
		await vi.advanceTimersByTimeAsync(0);
		controller.abort();
		expect((await pending).stopReason).toBe("aborted");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not retry a 403 HTML response", async () => {
		const fetchMock = vi.fn(async () => htmlResponse(403));
		vi.stubGlobal("fetch", fetchMock);
		const result = await streamOpenAICodexResponses(model, context, { ...options, maxRetries: 3 }).result();
		expect(result.errorMessage).toContain("HTTP 403");
		expect(isRetryableAssistantError(result)).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		{
			status: 400,
			body: JSON.stringify({ error: { message: "invalid reasoning effort" } }),
			expected: "invalid reasoning effort",
		},
		{
			status: 429,
			body: JSON.stringify({ error: { code: "usage_limit_reached", plan_type: "PLUS" } }),
			expected: "You have hit your ChatGPT usage limit (plus plan).",
		},
		{ status: 400, body: "plain provider failure", expected: "plain provider failure" },
	])("preserves existing JSON and plain text errors: %j", async ({ status, body, expected }) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status })),
		);
		const result = await streamOpenAICodexResponses(model, context, options).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe(expected);
	});
});
