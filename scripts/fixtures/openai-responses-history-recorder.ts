import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAIResponses } from "../../packages/ai/src/providers/openai-responses.ts";
import type { Api, AssistantMessage, Message, Model, StopReason, ToolResultMessage } from "../../packages/ai/src/types.ts";

type Source = { provider: string; api: Api; model: string };
type Block = AssistantMessage["content"][number];
type Item =
	| { role: "user"; content: string | { type: "text"; text: string }[] }
	| { role: "assistant"; source?: Source; content: Block[]; stopReason?: StopReason }
	| { role: "toolResult"; toolCallId: string; toolName: string; content: { type: "text"; text: string }[]; isError: boolean };
type Scenario = { id: string; provider?: string; reasoning?: boolean; messages: Item[] };

const baseUrl = "https://synthetic.invalid/v1";
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const text = (t: string, textSignature?: string): Block => ({ type: "text", text: t, ...(textSignature === undefined ? {} : { textSignature }) });
const call = (id: string, args: Record<string, unknown> = { z: 1, a: 2 }): Block => ({ type: "toolCall", id, name: "f", arguments: args });
const result = (toolCallId: string, ...parts: string[]): Item => ({ role: "toolResult", toolCallId, toolName: "f", content: parts.map((t) => ({ type: "text", text: t })), isError: false });
const assistant = (content: Block[], extra: Partial<Extract<Item, { role: "assistant" }>> = {}): Item => ({ role: "assistant", content, ...extra });
const reasoningItem = '{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"s"}],"encrypted_content":"enc","10":1.50,"2":-0}';
const v1 = (id: string, phase?: string) => JSON.stringify({ v: 1, id, ...(phase ? { phase } : {}) });

const scenarios: Scenario[] = [
	{ id: "same-tool-turn", messages: [{ role: "user", content: "Hi" }, assistant([text("Calling", v1("msg_1")), call("call_1|fc_1", { z: 1, a: { "2": true, b: [1.5, -0, 1e21] }, "10": "x", é: null })]), result("call_1|fc_1", "out"), assistant([text("Done")])] },
	{ id: "same-reasoning", reasoning: true, messages: [{ role: "user", content: "Hi" }, assistant([
		{ type: "thinking", thinking: "visible", thinkingSignature: reasoningItem },
		{ type: "thinking", thinking: " \t\u00a0", thinkingSignature: '{"type":"reasoning","id":"rs_blank"}' },
		{ type: "thinking", thinking: "unsigned" },
		{ type: "thinking", thinking: "opaque", thinkingSignature: '{"type":"reasoning","id":"rs_redacted"}', redacted: true },
		{ type: "thinking", thinking: "empty-sig", thinkingSignature: "" },
		text("answer", v1("msg_2", "final_answer")),
	])] },
	{ id: "text-signatures", messages: [{ role: "user", content: "Hi" }, assistant([
		text("a", v1("msg_c", "commentary")), text("b", v1("msg_bad_phase", "other")), text("c", v1("")), text("d", "legacy_plain_id"),
		text("e", v1("m".repeat(65))), text("f", v1("😀".repeat(33))), text("g", v1("😀".repeat(32))), text("h", '{"v":2,"id":"x"}'),
		text("i", '{"v":1,"id":7}'), text("j", '{"v":1.0,"id":"one-point-zero"}'), text("k", '{"v":1,"id":"dup","id":"last"}'), text("l"), text("m", ""),
	])] },
	{ id: "message-index", messages: [
		{ role: "user", content: [] }, { role: "user", content: "x" }, assistant([{ type: "thinking", thinking: "  " }]), assistant([text("first"), text("second")]),
		{ role: "user", content: [{ type: "text", text: "" }] }, assistant([text("third")]),
	] },
	{ id: "pairing", messages: [
		{ role: "user", content: "go" },
		assistant([call("dead|fc_dead")], { stopReason: "error" }), result("dead|fc_dead", "dropped"),
		assistant([call("gone|fc_gone")], { stopReason: "aborted" }),
		assistant([call("a|fc_a"), call("b|fc_b"), call("|fc_empty")], { stopReason: "toolUse" }),
		result(" a|fc_a\n", "padded"), result("unknown|fc_u", "orphan"), result("", "blank"),
		{ role: "user", content: "interrupt" },
		assistant([call("tail|fc_tail")]),
	] },
	{ id: "tool-results", messages: [{ role: "user", content: "go" }, assistant([call("r1|fc_1"), call("r2|fc_2"), call("r3|fc_3"), call("r4|fc_4")]),
		result("r1|fc_1", "line1", "line2"), result("r2|fc_2"), result("r3|fc_3", ""), { role: "toolResult", toolCallId: "r4|fc_4", toolName: "f", content: [{ type: "text", text: "😀 \"q\"" }], isError: true }] },
	{ id: "same-call-ids", messages: [{ role: "user", content: "go" }, assistant([call("plain"), call("raw|"), call("|"), call("a|b|c"), call("c|rs_1"), call("we+ird|it/😀")])] },
];
const ids = ["call+|it😀/1", `${"a".repeat(70)}|B+/=😀`, "plain-id", "raw|", "|", "a|b|c", "c|fc_x", "c|rs_1", "trail___|item___", "x".repeat(70)];
for (const provider of ["synthetic", "openai", "opencode"]) for (const change of ["none", "provider", "api", "model"] as const) {
	const source: Source = { provider: change === "provider" ? "foreign" : provider, api: change === "api" ? "openai-completions" : "openai-responses", model: change === "model" ? "other" : "synthetic-responses" };
	const content: Block[] = [
		text("start", v1("msg_src", "commentary")),
		{ type: "thinking", thinking: "visible", thinkingSignature: '{"type":"reasoning","id":"rs_src"}' },
		{ type: "thinking", thinking: "opaque", thinkingSignature: '{"type":"reasoning","id":"rs_red"}', redacted: true },
		{ type: "thinking", thinking: " \t" },
		...ids.map((id, i) => call(id, { z: i, a: 1 })),
	];
	scenarios.push({ id: `cross-${provider}-${change}`, provider, messages: [{ role: "user", content: "go" }, assistant(content, { source, stopReason: "toolUse" }), ...ids.toReversed().map((id) => result(id, `result-${ids.indexOf(id)}`))] });
}

const original = globalThis.fetch;
try {
	const cases = [];
	for (const s of scenarios) {
		const provider = s.provider ?? "synthetic";
		const model: Model<"openai-responses"> = { id: "synthetic-responses", name: "Synthetic", api: "openai-responses", provider, baseUrl, reasoning: s.reasoning ?? false, input: ["text"], cost: usage.cost, contextWindow: 4096, maxTokens: 64 };
		const self: Source = { provider, api: "openai-responses", model: model.id };
		const items = s.messages.map((m) => (m.role === "assistant" ? { ...m, source: m.source ?? self } : m));
		const messages: Message[] = items.map((m): Message => {
			if (m.role === "assistant") {
				const { source, ...rest } = m;
				return { ...rest, ...source, usage, stopReason: m.stopReason ?? "stop", timestamp: 0 } as AssistantMessage;
			}
			if (m.role === "toolResult") return { ...m, timestamp: 0 } as ToolResultMessage;
			return { ...m, timestamp: 0 };
		});
		let request: { url: string; headers: Record<string, string>; body: string } | undefined;
		globalThis.fetch = async (url, init) => {
			const headers = new Headers(init?.headers);
			if (request || String(url) !== `${baseUrl}/responses` || headers.get("authorization") !== "Bearer faux-key" || typeof init?.body !== "string") throw new Error("unexpected SDK request");
			request = { url: String(url), headers: Object.fromEntries([...headers].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent")), body: init.body };
			const done = { type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [] } };
			return new Response(`event: response.completed\ndata: ${JSON.stringify(done)}\n\n`, { headers: { "content-type": "text/event-stream" } });
		};
		const out = await streamOpenAIResponses(model, { systemPrompt: "Synthetic system", messages }, { apiKey: "faux-key", maxRetries: 0 }).result();
		if (out.stopReason !== "stop" || !request) throw new Error(`recording failed: ${s.id}: ${out.errorMessage}`);
		cases.push({ id: s.id, input: { provider, baseUrl, model: model.id, reasoning: model.reasoning, system: "Synthetic system", messages: items }, request });
	}
	const paths = [
		"scripts/fixtures/openai-responses-history-recorder.ts", "packages/ai/src/providers/openai-responses.ts", "packages/ai/src/providers/openai-responses-shared.ts",
		"packages/ai/src/providers/transform-messages.ts", "packages/ai/src/utils/hash.ts", "packages/ai/src/utils/sanitize-unicode.ts", "node_modules/openai/package.json",
	];
	console.log(JSON.stringify({ schema: "omk.openai-responses-history.v1", source: Object.fromEntries(paths.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])), cases }));
} finally {
	globalThis.fetch = original;
}
