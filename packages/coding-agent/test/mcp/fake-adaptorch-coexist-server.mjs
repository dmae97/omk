#!/usr/bin/env node
// Offline MCP protocol fixture. It is not an AdaptOrch engine or correctness verifier.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	input += chunk;
	for (let end = input.indexOf("\n"); end !== -1; end = input.indexOf("\n")) {
		const line = input.slice(0, end);
		input = input.slice(end + 1);
		if (!line.trim()) continue;
		const request = JSON.parse(line);
		if (request.id === undefined) continue;
		let result;
		if (request.method === "initialize") {
			result = {
				protocolVersion: "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "adaptorch-fixture", version: "1.0.0" },
			};
		} else if (request.method === "tools/list") {
			result = {
				tools: [{ name: "adaptorch_capabilities", description: "Read fixture capabilities", inputSchema: { type: "object", properties: {} } }],
			};
		} else if (request.method === "tools/call" && request.params?.name === "adaptorch_capabilities") {
			result = { content: [{ type: "text", text: '{"fixture":true,"correctness_claim":false}' }] };
		} else if (request.method === "ping") {
			result = {};
		} else {
			process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "unsupported" } })}\n`);
			continue;
		}
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
	}
});
