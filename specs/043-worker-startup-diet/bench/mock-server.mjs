// Mock OpenAI-completions SSE server. Logs every request arrival to JSONL.
// usage: node mock-server.mjs <port> <delayMs> <logFile>
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const [port, delayMs, logFile] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const server = createServer(async (req, res) => {
	const arrive = performance.timeOrigin + performance.now();
	let body = "";
	for await (const c of req) body += c;
	const bodyDone = performance.timeOrigin + performance.now();
	const m = body.match(/Task: (bench-[A-Za-z0-9_-]+)/);
	const tag = m ? m[1] : null;
	setTimeout(() => {
		res.writeHead(200, { "content-type": "text/event-stream" });
		const chunk = {
			id: "chatcmpl-mock",
			model: "mock-model",
			choices: [{ index: 0, delta: { content: "mock ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
		};
		res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
		const respond = performance.timeOrigin + performance.now();
		appendFileSync(logFile, `${JSON.stringify({ tag, url: req.url, arrive, bodyDone, respond, bodyBytes: body.length })}\n`);
	}, delayMs);
});
server.listen(port, "127.0.0.1", () => console.log(`mock listening ${port} delay=${delayMs}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
