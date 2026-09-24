import type { McpClient } from "./client.ts";

/** Error messages, stacks and stringification may contain server-echoed secrets. */
export function mcpPublicDiagnostic(error: unknown, phase: "connect" | "health"): string {
	let category = "Error";
	try {
		if (error instanceof Error) {
			const name: unknown = error.name;
			if (typeof name === "string" && ["TypeError", "RangeError", "TimeoutError", "AbortError"].includes(name)) {
				category = name;
			}
		}
	} catch {
		// Proxies and hostile getters are not a diagnostic authority.
	}
	return `mcp.${phase}_failed (${category})`;
}

// Only a bounded numeric version core is fit for a public status field. Drop
// free-form prerelease/build metadata rather than trying to redact arbitrary text.
const VERSION = /^v?([0-9]{1,6}(?:\.[0-9]{1,6}){1,3})(?:-[0-9A-Za-z.-]{1,32})?(?:\+[0-9A-Za-z.-]{1,32})?$/u;

export function publicMcpServerVersion(client: McpClient | undefined): string | undefined {
	if (!client) return undefined;
	try {
		const raw: unknown = client.serverInfo.version;
		if (typeof raw !== "string" || raw.length > 96) return undefined;
		const match = VERSION.exec(raw);
		return match?.[0] === raw ? match[1] : undefined;
	} catch {
		return undefined;
	}
}
