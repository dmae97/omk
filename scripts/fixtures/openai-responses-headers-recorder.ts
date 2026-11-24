import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAIResponses } from "../../packages/ai/src/providers/openai-responses.ts";
import type { CacheRetention, Model, OpenAIResponsesCompat } from "../../packages/ai/src/types.ts";

type Scenario = {
	id: string; model?: Record<string, string>; options?: Record<string, string>;
	session?: string; retention?: CacheRetention; compat?: OpenAIResponsesCompat;
};
const baseUrl = "https://synthetic.invalid/v1";
const scenarios: Scenario[] = [
	{ id: "model-only", model: { "X-Model": "m", "x-shared": "model" } },
	{ id: "options-only", options: { "X-Option": "o" } },
	{ id: "options-override-model", model: { "X-Shared": "model", "x-keep": "k" }, options: { "X-Shared": "option" } },
	{ id: "options-override-other-case", model: { "X-Shared": "model" }, options: { "x-shared": "option" } },
	// Object.assign keeps the first key position, so a later-cased key in model headers still wins.
	{ id: "case-collision-position", model: { "X-A": "1", "x-a": "2" }, options: { "X-A": "3" } },
	{ id: "index-keys-first", model: { "x-b": "b", "10": "ten", "2": "two" }, options: { "02": "zero-two" } },
	{ id: "session-then-model", model: { session_id: "model-session", "x-client-request-id": "model-req" }, session: "sess-1" },
	// The session overwrites `session_id` in place, so a later-cased model key still wins.
	{ id: "session-in-place-before-cased-key", model: { session_id: "model-lower", SESSION_ID: "model-upper" }, session: "sess-1" },
	{ id: "options-override-session", session: "sess-1", options: { session_id: "opt-session", "X-Client-Request-Id": "opt-req" } },
	{ id: "session-header-disabled-model-kept", model: { session_id: "model-session" }, session: "sess-1", compat: { sendSessionIdHeader: false } },
	{ id: "retention-none-model-session", model: { session_id: "model-session" }, session: "sess-1", retention: "none" },
	{ id: "override-sdk-defaults", options: { Accept: "text/event-stream", Authorization: "Bearer synthetic-override" } },
	{ id: "content-type-is-sdk-owned", model: { "Content-Type": "text/plain" }, options: { "content-type": "application/x-ndjson" } },
	{ id: "empty-and-inner-space", model: { "x-empty": "", "x-inner": "a b\tc" } },
	{ id: "token-punctuation", options: { "X-!#$%&'*+-.^_`|~": "v", "x-value": "A-z_0.9~!#$%&'*+^`|\"()/:;<=>?@[\\]{}" } },
	{ id: "empty-objects", model: {}, options: {} },
];
const original = globalThis.fetch;
try {
	const cases = [];
	for (const s of scenarios) {
		const model: Model<"openai-responses"> = {
			id: "synthetic-responses", name: "Synthetic", api: "openai-responses", provider: "synthetic", baseUrl, reasoning: false, input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 64,
			...(s.model ? { headers: s.model } : {}), ...(s.compat ? { compat: s.compat } : {}),
		};
		let request: { url: string; headers: Record<string, string>; body: string } | undefined;
		globalThis.fetch = async (url, init) => {
			const headers = new Headers(init?.headers);
			const auth = headers.get("authorization");
			if (request || String(url) !== `${baseUrl}/responses` || (auth !== "Bearer faux-key" && auth !== "Bearer synthetic-override") || typeof init?.body !== "string") throw new Error("unexpected SDK request");
			request = { url: String(url), headers: Object.fromEntries([...headers].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent")), body: init.body };
			const done = { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [] } };
			return new Response(`event: response.completed\ndata: ${JSON.stringify(done)}\n\n`, { headers: { "content-type": "text/event-stream" } });
		};
		const options = {
			apiKey: "faux-key", maxRetries: 0, ...(s.options ? { headers: s.options } : {}),
			...(s.session === undefined ? {} : { sessionId: s.session }), ...(s.retention ? { cacheRetention: s.retention } : {}),
		};
		const out = await streamOpenAIResponses(model, { systemPrompt: "Synthetic system", messages: [{ role: "user", content: "Hello", timestamp: 0 }] }, options).result();
		if (out.stopReason !== "stop" || !request) throw new Error(`recording failed: ${s.id}: ${out.errorMessage}`);
		cases.push({
			id: s.id,
			input: {
				provider: model.provider, baseUrl, model: model.id, reasoning: false, ...(s.compat ? { compat: s.compat } : {}),
				system: "Synthetic system", messages: [{ role: "user", content: "Hello" }],
				...(s.model ? { modelHeaders: s.model } : {}), ...(s.options ? { headers: s.options } : {}),
				...(s.session === undefined ? {} : { sessionId: s.session }), ...(s.retention ? { cacheRetention: s.retention } : {}),
			},
			request,
		});
	}
	const paths = [
		"scripts/fixtures/openai-responses-headers-recorder.ts", "packages/ai/src/providers/openai-responses.ts",
		"node_modules/openai/internal/headers.js", "node_modules/openai/client.js", "node_modules/openai/package.json",
	];
	console.log(JSON.stringify({ schema: "omk.openai-responses-headers.v1", source: Object.fromEntries(paths.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])), cases }));
} finally {
	globalThis.fetch = original;
}
