/** Public distribution catalog. Entries are offers, not connection or capability attestations. */
export const NEO_SKILL_NAMES = [
	"omk-computeruse",
	"omk-browser",
	"omk-site",
	"omk-research",
	"omk-code-review",
	"omk-mcp-setup",
] as const;

export interface NeoMcpPreset {
	readonly id: string;
	readonly purpose: string;
	readonly packageSpec: string;
	readonly args: readonly string[];
	readonly notice: string;
}

export const NEO_MCP_PRESETS: readonly NeoMcpPreset[] = [
	{
		id: "playwright",
		purpose: "Browser navigation, accessibility snapshots, interaction and visual verification",
		packageSpec: "@playwright/mcp@0.0.81",
		args: ["--headless", "--isolated", "--sandbox", "--timeout-action", "10000", "--timeout-navigation", "30000"],
		notice:
			"Opt-in executable download and website access. A compatible browser is required. Profile isolation is not OS isolation. Sandbox failure must not trigger --no-sandbox fallback. No personal browser attachment.",
	},
	{
		id: "context7",
		purpose: "Current library documentation retrieval",
		packageSpec: "@upstash/context7-mcp@4.1.1",
		args: ["--transport", "stdio"],
		notice:
			"Opt-in executable download and external documentation queries. Do not send private code or secrets. Authentication and limits are user-specific; no credential is bundled.",
	},
];

export function selectNeoMcpPresets(ids: readonly string[]): readonly NeoMcpPreset[] {
	if (ids.length === 0) throw new Error("Select at least one MCP preset: playwright, context7");
	if (new Set(ids).size !== ids.length) throw new Error("Duplicate MCP preset");
	return ids.map((id) => {
		const preset = NEO_MCP_PRESETS.find((entry) => entry.id === id);
		if (!preset) throw new Error("Unknown MCP preset; supported: playwright, context7");
		return preset;
	});
}

export function neoMcpConfig(
	ids: readonly string[],
	enabled: boolean,
): {
	mcpServers: Record<string, { command: string; args: string[]; disabled: boolean; startup_timeout_sec: number }>;
} {
	const mcpServers: ReturnType<typeof neoMcpConfig>["mcpServers"] = {};
	for (const preset of selectNeoMcpPresets(ids)) {
		mcpServers[`neo-${preset.id}`] = {
			command: "npx",
			args: ["--yes", preset.packageSpec, ...preset.args],
			disabled: !enabled,
			startup_timeout_sec: 60,
		};
	}
	return { mcpServers };
}
