// Mock OpenAI-completions SSE server for the one-tool-call scenario (spec 043).
// Turn 1 (no tool result in the request): one `read` tool call on small.txt.
// Turn 2 (request carries a role:"tool" message): final text "mock ok".
// Logs every request to JSONL with its turn. usage: node mock-server-tool.mjs <port> <logFile>
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const [port, logFile] = [Number(process.argv[2]), process.argv[3]];
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`;
const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model: "mock-model" };
const server = createServer(async (req, res) => {
	const arrive = performance.timeOrigin + performance.now();
	let body = "";
	for await (const c of req) body += c;
	let parsed = {};
	try { parsed = JSON.parse(body); } catch {}
	const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
	const turn = msgs.some((m) => m.role === "tool") ? 2 : 1;
	const tag = body.match(/Task: (bench-[A-Za-z0-9_-]+)/)?.[1] ?? null;
	const toolNames = Array.isArray(parsed.tools) ? parsed.tools.map((t) => t.function?.name) : [];
	res.writeHead(200, { "content-type": "text/event-stream" });
	if (turn === 1) {
		res.write(sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: "" } }] }, finish_reason: null }] }));
		res.write(sse({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: "small.txt" }) } }] }, finish_reason: null }] }));
		res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }));
	} else {
		const toolMsg = msgs.find((m) => m.role === "tool");
		const sawFile = JSON.stringify(toolMsg ?? "").includes("small file for the tool-call scenario");
		res.write(sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: sawFile ? "mock ok" : "mock missing-tool-result" }, finish_reason: null }] }));
		res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }));
	}
	res.end("data: [DONE]\n\n");
	const respond = performance.timeOrigin + performance.now();
	appendFileSync(logFile, `${JSON.stringify({ tag, turn, url: req.url, arrive, respond, bodyBytes: body.length, hasReadTool: toolNames.includes("read") })}\n`);
});
server.listen(port, "127.0.0.1", () => console.log(`tool mock listening ${port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
