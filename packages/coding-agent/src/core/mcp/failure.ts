import type { StdioTransportExit } from "./stdio-transport.ts";

const HINTS = {
	"mcp.spawn_not_found": "Check command, PATH and cwd in mcp.json; the executable or working directory was not found.",
	"mcp.spawn_permission_denied": "Check executable and working-directory permissions; do not disable the sandbox.",
	"mcp.spawn_failed": "Check the configured command and cwd in mcp.json.",
	"mcp.server_exited":
		"Check server launcher prerequisites and local stderr; increasing startup_timeout_sec cannot repair a process exit.",
	"mcp.request_timeout": "Check server responsiveness and tool_timeout_sec in mcp.json.",
	"mcp.invalid_initialize_result": "Check that the configured command starts an MCP stdio server.",
	"mcp.unsupported_protocol": "Use an MCP server version compatible with this client's supported protocol revisions.",
} as const;

type McpFailureCode = keyof typeof HINTS;

/** Only locally constructed failures carry public classifications; messages remain private. */
export class McpFailure extends Error {
	readonly code: McpFailureCode;
	readonly exitCode?: number;
	readonly method?: string;

	constructor(code: McpFailureCode, message: string, detail?: { exitCode?: number; method?: string }) {
		super(message);
		this.code = code;
		this.exitCode = detail?.exitCode;
		this.method = detail?.method;
	}
}

export function publicMcpFailure(error: unknown): string | undefined {
	if (!(error instanceof McpFailure)) return undefined;
	const { code, exitCode, method } = error;
	if (typeof code !== "string" || !Object.hasOwn(HINTS, code)) return undefined;
	const exit = Number.isSafeInteger(exitCode) ? `; exit=${exitCode}` : "";
	const hint =
		code === "mcp.request_timeout" && method === "initialize"
			? "Check launcher prerequisites and startup_timeout_sec in mcp.json."
			: HINTS[code];
	return `${code}${exit}; ${hint}`;
}

export function mcpTimeoutFailure(name: string, method: string, timeoutMs?: number): McpFailure {
	const message =
		timeoutMs === undefined
			? `MCP response arrived after deadline (${method})`
			: `MCP server "${name}" timed out after ${timeoutMs}ms on ${method}`;
	return new McpFailure("mcp.request_timeout", message, { method });
}

/** Exit metadata comes from Node, never from stderr or a server's JSON-RPC payload. */
export function mcpExitFailure(name: string, exit: StdioTransportExit, stderr: string): McpFailure {
	const { code, signal, spawnErrorCode } = exit;
	const kind =
		spawnErrorCode === "ENOENT"
			? "mcp.spawn_not_found"
			: spawnErrorCode === "EACCES" || spawnErrorCode === "EPERM"
				? "mcp.spawn_permission_denied"
				: spawnErrorCode !== undefined || (code === null && signal === null)
					? "mcp.spawn_failed"
					: "mcp.server_exited";
	const detail = signal ? `signal ${signal}` : code === null ? "spawn failure" : `exit code ${code}`;
	return new McpFailure(kind, `MCP server "${name}" stopped (${detail})${stderr ? `: ${stderr}` : ""}`, {
		exitCode: kind === "mcp.server_exited" ? (code ?? undefined) : undefined,
	});
}
