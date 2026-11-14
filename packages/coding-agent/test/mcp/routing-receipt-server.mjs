// Offline protocol fixture only: this intentionally does not implement the AdaptOrch algorithm.
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
	const request = JSON.parse(line);
	if (request.id === undefined) return;
	let result;
	if (request.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "routing-fixture", version: "1.0.0" } };
	else if (request.method === "tools/list") result = { tools: [{ name: "adaptorch_route_topology", description: "Return a test routing proposal", inputSchema: { type: "object", properties: { subtasks: { type: "array", items: { type: "object" } } }, required: ["subtasks"] } }] };
	else if (request.method === "tools/call") {
		const structuredContent = { topology: "parallel", stages: [request.params.arguments.subtasks.map((node) => node.id).reverse()] };
		result = { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent, isError: false };
	} else if (request.method === "ping") result = {};
	else return;
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
});
