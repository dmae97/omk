// Generates the 20 fixed reconciliation fixtures R01-R20 (run: node test/fixtures/gen.mjs).
// Upstream bodies deliberately carry the upstream brand in `model`, `id` and `system_fingerprint`
// so the scrub test has something to catch. Answer text never contains it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const up = join(here, "upstream");
mkdirSync(up, { recursive: true });

const usage = (hit, miss, comp, reasoning) => {
	const u = {
		prompt_tokens: hit + miss,
		completion_tokens: comp,
		total_tokens: hit + miss + comp,
		prompt_tokens_details: { cached_tokens: hit },
		prompt_cache_hit_tokens: hit,
		prompt_cache_miss_tokens: miss,
	};
	if (reasoning !== undefined) u.completion_tokens_details = { reasoning_tokens: reasoning };
	return u;
};
const base = (id, model) => ({ id: `chatcmpl-${"deep"}${"seek"}-${id}`, object: "chat.completion", created: 1790000000, model, system_fingerprint: `fp_${"deep"}${"seek"}_x` });
const jsonBody = (id, model, msg, finish, u) => ({ ...base(id, model), choices: [{ index: 0, message: { role: "assistant", ...msg }, finish_reason: finish }], usage: u });
const chunk = (id, model, delta, finish, u) => {
	const o = { id: `chatcmpl-${"deep"}${"seek"}-${id}`, object: "chat.completion.chunk", created: 1790000000, model, system_fingerprint: `fp_${"deep"}${"seek"}_x`, choices: [{ index: 0, delta, finish_reason: finish ?? null }] };
	if (u) o.usage = u;
	return `data: ${JSON.stringify(o)}\n\n`;
};
const sse = (parts) => parts.join("") + "data: [DONE]\n\n";

const userMsg = (t) => [{ role: "user", content: t }];
const cases = [];
const add = (id, desc, c, upstream) => {
	const ext = upstream.kind === "sse" ? "sse" : "json";
	const file = `${id}.${ext}`;
	writeFileSync(join(up, file), upstream.kind === "sse" ? upstream.body : JSON.stringify(upstream.body, null, 2) + "\n");
	cases.push({ id, description: desc, upstreamFile: file, ...c });
};

// Mon 2026-11-09 .. Fri 2026-11-13, Sat 2026-11-14 (KST)
add("R01", "coder, non-stream, all miss", { clock: "2026-11-11T14:00:00+09:00", model: "OMK/coder", user: "plain", request: { messages: userMsg("hello") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false } },
	{ kind: "json", body: jsonBody("R01", "deepseek-flash", { content: "Hi there." }, "stop", usage(0, 120, 30)) });
add("R02", "coder, non-stream, full cache hit", { clock: "2026-11-11T14:05:00+09:00", model: "OMK/coder", user: "plain", request: { messages: userMsg("hello again") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false } },
	{ kind: "json", body: jsonBody("R02", "deepseek-flash", { content: "Hi again." }, "stop", usage(256, 0, 20)) });
add("R03", "coder, non-stream, partial hit", { clock: "2026-11-11T14:10:00+09:00", model: "OMK/coder", user: "plain", request: { messages: userMsg("partial") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false } },
	{ kind: "json", body: jsonBody("R03", "deepseek-flash", { content: "Partially cached." }, "stop", usage(192, 64, 40)) });
add("R04", "coder, stream, usage in last chunk", { clock: "2026-11-11T14:15:00+09:00", model: "OMK/coder", user: "plain", request: { stream: true, messages: userMsg("stream") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: true } },
	{ kind: "sse", body: sse([chunk("R04", "deepseek-flash", { role: "assistant", content: "" }), chunk("R04", "deepseek-flash", { content: "Hello" }), chunk("R04", "deepseek-flash", { content: " world" }), chunk("R04", "deepseek-flash", { content: "" }, "stop", usage(64, 36, 12))]) });
add("R05", "coder, stream, tool call", { clock: "2026-11-11T14:20:00+09:00", model: "OMK/coder", user: "plain", request: { stream: true, messages: userMsg("weather?"), tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }] }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: true } },
	{ kind: "sse", body: sse([chunk("R05", "deepseek-flash", { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } }] }), chunk("R05", "deepseek-flash", { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }), chunk("R05", "deepseek-flash", { tool_calls: [{ index: 0, function: { arguments: '"Seoul"}' } }] }, "tool_calls", usage(80, 20, 18))]) });
add("R06", "coder, Fri 10:00:00 KST exactly (first peak second)", { clock: "2026-11-13T10:00:00+09:00", model: "OMK/coder", user: "plain", request: { messages: userMsg("edge") }, expect: { peak: true, upstreamModel: "deepseek-flash", stream: false } },
	{ kind: "json", body: jsonBody("R06", "deepseek-flash", { content: "Edge." }, "stop", usage(10, 90, 15)) });
add("R07", "reasoner, non-stream, reasoning_tokens > 0", { clock: "2026-11-11T20:00:00+09:00", model: "OMK/reasoner", user: "plain", request: { messages: userMsg("think") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false, effort: "low" } },
	{ kind: "json", body: jsonBody("R07", "deepseek-flash", { content: "Answer.", reasoning_content: "Let me think." }, "stop", usage(100, 200, 220, 150)) });
add("R08", "reasoner, stream, reasoning deltas", { clock: "2026-11-11T20:05:00+09:00", model: "OMK/reasoner", user: "plain", request: { stream: true, messages: userMsg("think stream") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: true, effort: "low" } },
	{ kind: "sse", body: sse([chunk("R08", "deepseek-flash", { role: "assistant", content: null, reasoning_content: "" }), chunk("R08", "deepseek-flash", { reasoning_content: "Step one. " }), chunk("R08", "deepseek-flash", { reasoning_content: "Step two." }), chunk("R08", "deepseek-flash", { content: "Done." }), chunk("R08", "deepseek-flash", { content: "" }, "stop", usage(50, 150, 90, 60))]) });
add("R09", "reasoner, stream, effort low", { clock: "2026-11-11T20:10:00+09:00", model: "OMK/reasoner", user: "plain", request: { stream: true, reasoning_effort: "low", messages: userMsg("low effort") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: true, effort: "low" } },
	{ kind: "sse", body: sse([chunk("R09", "deepseek-flash", { role: "assistant", content: null, reasoning_content: "" }), chunk("R09", "deepseek-flash", { reasoning_content: "Short." }), chunk("R09", "deepseek-flash", { content: "Ok." }), chunk("R09", "deepseek-flash", { content: "" }, "stop", usage(0, 70, 25, 10))]) });
add("R10", "reasoner, stream, effort max, allow-listed user", { clock: "2026-11-11T20:15:00+09:00", model: "OMK/reasoner", user: "maxeffort", request: { stream: true, reasoning_effort: "max", messages: userMsg("max effort") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: true, effort: "max" } },
	{ kind: "sse", body: sse([chunk("R10", "deepseek-flash", { role: "assistant", content: null, reasoning_content: "" }), chunk("R10", "deepseek-flash", { reasoning_content: "Long chain." }), chunk("R10", "deepseek-flash", { content: "Result." }), chunk("R10", "deepseek-flash", { content: "" }, "stop", usage(30, 70, 400, 350))]) });
add("R11", "reasoner, tool loop turn with reasoning_content replay", { clock: "2026-11-11T20:20:00+09:00", model: "OMK/reasoner", user: "plain", request: { messages: [{ role: "user", content: "weather in Seoul?" }, { role: "assistant", content: null, reasoning_content: "I should call the tool.", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Seoul"}' } }] }, { role: "tool", tool_call_id: "call_1", content: "18C clear" }], tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }] }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false, effort: "low", replay: true } },
	{ kind: "json", body: jsonBody("R11", "deepseek-flash", { content: "It is 18C and clear.", reasoning_content: "Tool said 18C." }, "stop", usage(180, 40, 60, 20)) });
add("R12", "reasoner, finish_reason length", { clock: "2026-11-11T20:25:00+09:00", model: "OMK/reasoner", user: "plain", request: { max_tokens: 64, messages: userMsg("long") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false, effort: "low" } },
	{ kind: "json", body: jsonBody("R12", "deepseek-flash", { content: "Cut off", reasoning_content: "Long thought" }, "length", usage(20, 40, 64, 64)) });
add("R13", "reasoner, reasoning_tokens = 0 in thinking mode", { clock: "2026-11-11T20:30:00+09:00", model: "OMK/reasoner", user: "plain", request: { messages: userMsg("trivial") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false, effort: "low" } },
	{ kind: "json", body: jsonBody("R13", "deepseek-flash", { content: "4", reasoning_content: "" }, "stop", usage(8, 12, 2, 0)) });
add("R14", "coder, peak timestamp (Wed 11:00 KST)", { clock: "2026-11-11T11:00:00+09:00", model: "OMK/coder", user: "plain", request: { messages: userMsg("peak") }, expect: { peak: true, upstreamModel: "deepseek-flash", stream: false } },
	{ kind: "json", body: jsonBody("R14", "deepseek-flash", { content: "Peak." }, "stop", usage(40, 60, 100)) });
add("R15", "coder, off-peak timestamp (Sat 11:00 KST)", { clock: "2026-11-14T11:00:00+09:00", model: "OMK/coder", user: "plain", request: { messages: userMsg("weekend") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false } },
	{ kind: "json", body: jsonBody("R15", "deepseek-flash", { content: "Weekend." }, "stop", usage(40, 60, 100)) });
add("R16", "coder, Fri 09:59:59 KST (last off-peak second)", { clock: "2026-11-13T09:59:59+09:00", model: "OMK/coder", user: "plain", request: { messages: userMsg("edge2") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false } },
	{ kind: "json", body: jsonBody("R16", "deepseek-flash", { content: "Edge two." }, "stop", usage(10, 90, 15)) });
add("R17", "reasoner mapped to the larger upstream model via config only", { clock: "2026-11-12T16:00:00+09:00", model: "OMK/reasoner", user: "plain", request: { messages: userMsg("pro") }, configSwap: { "OMK/reasoner": "deepseek-v4-pro" }, expect: { peak: true, upstreamModel: "deepseek-v4-pro", stream: false, effort: "low" } },
	{ kind: "json", body: jsonBody("R17", "deepseek-v4-pro", { content: "Pro answer.", reasoning_content: "Pro thought." }, "stop", usage(500, 700, 900, 600)) });
add("R18", "coder, stream with keep-alive comments", { clock: "2026-11-11T14:30:00+09:00", model: "OMK/coder", user: "plain", request: { stream: true, messages: userMsg("slow") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: true, keepAlive: 3 } },
	{ kind: "sse", body: sse([": keep-alive\n\n", ": keep-alive\n\n", chunk("R18", "deepseek-flash", { role: "assistant", content: "" }), ": keep-alive\n\n", chunk("R18", "deepseek-flash", { content: "Finally." }), chunk("R18", "deepseek-flash", { content: "" }, "stop", usage(20, 30, 8))]) });
add("R19", "coder, finish_reason content_filter", { clock: "2026-11-11T14:35:00+09:00", model: "OMK/coder", user: "plain", request: { messages: userMsg("filtered") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: false } },
	{ kind: "json", body: jsonBody("R19", "deepseek-flash", { content: "" }, "content_filter", usage(30, 10, 0)) });
add("R20", "coder, stream, insufficient_system_resource with usage", { clock: "2026-11-11T14:40:00+09:00", model: "OMK/coder", user: "plain", request: { stream: true, messages: userMsg("busy") }, expect: { peak: false, upstreamModel: "deepseek-flash", stream: true } },
	{ kind: "sse", body: sse([chunk("R20", "deepseek-flash", { role: "assistant", content: "Partial" }), chunk("R20", "deepseek-flash", { content: "" }, "insufficient_system_resource", usage(60, 20, 5))]) });

writeFileSync(join(here, "cases.json"), JSON.stringify(cases, null, 2) + "\n");
console.log(`wrote ${cases.length} cases`);
