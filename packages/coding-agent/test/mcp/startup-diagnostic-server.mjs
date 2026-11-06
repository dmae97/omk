// Offline MCP startup fixture: no browser, network or credentials.
import { createInterface } from "node:readline";

const mode = process.argv[2];
if (mode === "crash") {
	process.stderr.write("fixture-secret: launcher prerequisite unavailable\n");
	process.exit(7);
}
const lines = createInterface({ input: process.stdin, terminal: false });
lines.on("line", (line) => {
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		return;
	}
	const { id, method } = request;
	if (id === undefined) return;
	if (method === "initialize" && mode === "silent-init") return;
	if (method === "tools/list" && mode === "silent-list") return;
	if (mode === "protocol-error") {
		process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "fixture-secret: timed out ENOENT" } })}\n`);
		return;
	}
	const result = method === "initialize"
		? mode === "invalid" ? {} : {
			protocolVersion: mode === "unsupported" ? "fixture-secret" : "2025-06-18",
			capabilities: { tools: {} },
			serverInfo: { name: "fixture", version: "1.0.0" },
		}
		: method === "tools/list" ? { tools: [] } : {};
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
});
lines.on("close", () => process.exit(0));
