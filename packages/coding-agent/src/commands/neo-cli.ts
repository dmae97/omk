import { existsSync } from "node:fs";
import { join } from "node:path";
import { NEO_MCP_PRESETS, NEO_SKILL_NAMES, neoMcpConfig, selectNeoMcpPresets } from "../core/neo/catalog.ts";
import { createNeoMcpConfig } from "../core/neo/setup.ts";

export interface NeoCliContext {
	readonly packageDir: string;
	readonly cwd: string;
	readonly home: string;
	readonly output: (text: string) => void;
}

/** Local, keyless distribution/setup commands. Never starts a server or a browser. */
export function runNeoCli(args: readonly string[], context: NeoCliContext): number {
	const [command = "list", ...rest] = args;
	try {
		if (command === "list" && rest.length === 0) {
			const skills = NEO_SKILL_NAMES.map((name) => ({
				name,
				packaged: existsSync(join(context.packageDir, "resources", "neo", "skills", name, "SKILL.md")),
			}));
			context.output(
				JSON.stringify(
					{
						bundle: "neo-v1",
						skills,
						mcp: { offered: NEO_MCP_PRESETS, connected: null, connectionStatus: "not_probed" },
						note: "Packaged does not mean selected. Offered does not mean installed, enabled, connected, or approved.",
					},
					null,
					2,
				),
			);
			return skills.every((skill) => skill.packaged) ? 0 : 1;
		}
		if (command === "mcp-config") {
			context.output(JSON.stringify(neoMcpConfig(rest, false), null, 2));
			return 0;
		}
		if (command === "setup") {
			if (
				rest.filter((arg) => arg === "--apply").length > 1 ||
				rest.filter((arg) => arg === "--global").length > 1
			) {
				throw new Error("Duplicate setup flag");
			}
			const apply = rest.includes("--apply");
			const root = rest.includes("--global") ? context.home : context.cwd;
			const ids = rest.filter((arg) => arg !== "--apply" && arg !== "--global");
			const presets = selectNeoMcpPresets(ids);
			if (!apply) {
				context.output(
					JSON.stringify(
						{
							status: "dry_run",
							target: join(root, ".omk", "mcp.json"),
							presets,
							config: neoMcpConfig(ids, false),
							approval:
								"--apply creates enabled entries. On the next OMK startup npx may download and execute the pinned servers, which can access the network. No server is started by this command.",
						},
						null,
						2,
					),
				);
				return 0;
			}
			const target = createNeoMcpConfig(root, ids);
			context.output(
				JSON.stringify(
					{
						status: "configured_not_connected",
						target,
						presets: ids,
						next: "Restart OMK, inspect the MCP connection/tool roster, and run a read-only health check before acting. Existing .omk/mcp.json in a project can override global entries.",
					},
					null,
					2,
				),
			);
			return 0;
		}
		throw new Error("Usage: omk neo [list | mcp-config <presets...> | setup <presets...> [--global] [--apply]]");
	} catch (error) {
		context.output(
			JSON.stringify({ status: "blocked", error: error instanceof Error ? error.message : "Neo command failed" }),
		);
		return 1;
	}
}
