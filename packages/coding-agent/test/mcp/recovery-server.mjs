// Native stdio fixture: the first process fails health; the next owns a changed catalog.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const counter = process.argv[2];
const generation = (existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0) + 1;
writeFileSync(counter, String(generation));
const tools = ["echo", generation === 1 ? "before" : "after"].map((name) => ({
	name,
	description: `Fixture generation ${generation}`,
	inputSchema: { type: "object", properties: { message: { type: "string" } } },
}));
const lines = createInterface({ input: process.stdin, terminal: false });
lines.on("line", (line) => {
	const { id, method, params } = JSON.parse(line);
	if (id === undefined) return;
	let result = {};
	if (method === "initialize") {
		result = {
			protocolVersion: "2025-06-18",
			capabilities: { tools: {} },
			serverInfo: { name: "recovery-fixture", version: `${generation}.0.0` },
		};
	} else if (method === "tools/list") result = { tools };
	else if (method === "tools/call") {
		result = { content: [{ type: "text", text: `${generation}: ${params.arguments.message}` }], isError: false };
	} else if (method === "ping" && generation === 1) {
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "retire fixture" } })}\n`);
		return;
	}
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
});
