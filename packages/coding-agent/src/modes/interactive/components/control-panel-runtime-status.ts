import { spawnSync } from "node:child_process";
import * as os from "node:os";
import type { AgentSession } from "../../../core/agent-session.ts";
import { getHeadroomRuntimeStatus } from "../../../core/context-budget-headroom.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { loadMcpInventory, type McpInventory, type McpServerEntry } from "../../../core/mcp-inventory.ts";
import type { SessionManager } from "../../../core/session-manager.ts";
import { getCurrentTodoState } from "../../../core/todo-runtime-state.ts";
import { readControlPlaneSignals } from "../control-plane-signals.ts";
import { buildControlPlaneViewModel } from "../control-plane-view-model.ts";
import type { ControlPanelContent, ControlPanelHeaderKey, ControlPanelStatusSnapshot } from "./control-panel-layout.ts";
import { formatCwdForFooter } from "./footer.ts";

const OMK_HUB_SKILL_NAMES = new Set([
	"omk-skills",
	"omk-engineering",
	"omk-backend-data",
	"omk-security",
	"omk-devops-release",
	"omk-research-docs",
	"omk-design-media",
	"omk-agent-ops",
	"omk-product-ops",
	"omk-workspace-ops",
	"omk-frontend",
	"omk-loop",
	"omk-plan",
]);

const INVALID_MCP_NETWORK_RULES = new Set(["mcp.network.invalid_mode", "mcp.network.empty_allowlist"]);
const PRIVILEGED_MCP_COMMANDS = new Set(["sudo", "su"]);
const VERSION_COMMAND_TIMEOUT_MS = 750;
const HEADROOM_PYTHON_DISTRIBUTIONS = ["headroom", "headroom-ai"] as const;

let cachedHeadroomVersion: string | null | undefined;

interface McpStabilityInput {
	readonly commandSummary: string;
	readonly overriddenBy?: string;
	readonly networkDecision: Pick<McpServerEntry["networkDecision"], "rule">;
	readonly capabilityDecision: Pick<McpServerEntry["capabilityDecision"], "malformed" | "unknownCapabilities">;
	readonly authDecision: Pick<McpServerEntry["authDecision"], "rule">;
}

export function formatHeadroomStatusLabel(): string {
	const version = getInstalledHeadroomVersion();
	return version ? `headroom:${version}` : getHeadroomRuntimeStatus().policyId;
}

export function countRoutableNonHubSkills(skills: readonly { readonly name: string }[]): number {
	return skills.filter((skill) => !OMK_HUB_SKILL_NAMES.has(skill.name)).length;
}

export function countStableMcpServers(entries: readonly McpStabilityInput[]): number {
	return entries.filter((entry) => classifyMcpStability(entry) === "stable").length;
}

/**
 * Classify a single MCP server entry for status display.
 *
 * - `stable`: configured, healthy, and safe to surface as an active server.
 * - `overridden`: a higher-precedence source replaced this entry.
 * - `unstable`: malformed, privileged, or blocked by an auth/network policy.
 */
export type McpStability = "stable" | "overridden" | "unstable";

export function classifyMcpStability(entry: McpStabilityInput): McpStability {
	if (entry.overriddenBy) return "overridden";
	if (entry.commandSummary === "<unknown>") return "unstable";
	if (entry.authDecision.rule === "mcp.auth.invalid") return "unstable";
	if (INVALID_MCP_NETWORK_RULES.has(entry.networkDecision.rule)) return "unstable";
	if (entry.capabilityDecision.malformed || entry.capabilityDecision.unknownCapabilities.length > 0) return "unstable";
	const command = entry.commandSummary.split(/\s+/, 1)[0] ?? "";
	if (PRIVILEGED_MCP_COMMANDS.has(command)) return "unstable";
	return "stable";
}

function getInstalledHeadroomVersion(): string | null {
	if (cachedHeadroomVersion !== undefined) return cachedHeadroomVersion;
	cachedHeadroomVersion = readVersionFromCommand("headroom", ["--version"]);
	if (cachedHeadroomVersion) return cachedHeadroomVersion;
	cachedHeadroomVersion = readVersionFromCommand("headroom", ["version"]);
	if (cachedHeadroomVersion) return cachedHeadroomVersion;
	for (const distribution of HEADROOM_PYTHON_DISTRIBUTIONS) {
		cachedHeadroomVersion = readPythonDistributionVersion(distribution);
		if (cachedHeadroomVersion) return cachedHeadroomVersion;
	}
	cachedHeadroomVersion = null;
	return cachedHeadroomVersion;
}

function readPythonDistributionVersion(distribution: (typeof HEADROOM_PYTHON_DISTRIBUTIONS)[number]): string | null {
	return readVersionFromCommand("python3", [
		"-c",
		`import importlib.metadata as m; print(m.version('${distribution}'))`,
	]);
}

function readVersionFromCommand(command: string, args: readonly string[]): string | null {
	try {
		const result = spawnSync(command, [...args], {
			encoding: "utf8",
			timeout: VERSION_COMMAND_TIMEOUT_MS,
			shell: false,
			windowsHide: true,
			env: { PATH: process.env.PATH ?? "" },
		});
		if (result.error || result.status !== 0) return null;
		return parseHeadroomVersionOutput(`${result.stdout}\n${result.stderr}`);
	} catch {
		return null;
	}
}

export function parseHeadroomVersionOutput(output: string): string | null {
	const match = /\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(output);
	return match?.[1] ?? null;
}

/** The live control-pane overlay rebuilds its snapshot every frame; MCP inventory is read from disk. */
const MCP_INVENTORY_TTL_MS = 5000;
let mcpInventoryCache: { key: string; at: number; inventory: McpInventory } | undefined;

/** `loadMcpInventory` cached per cwd/home for {@link MCP_INVENTORY_TTL_MS} (as the status sidebar does). */
export function cachedMcpInventory(cwd: string, now: number = Date.now()): McpInventory {
	const home = os.homedir();
	const key = `${home}\0${cwd}`;
	const cached = mcpInventoryCache;
	if (cached && cached.key === key && now - cached.at < MCP_INVENTORY_TTL_MS) return cached.inventory;
	const inventory = loadMcpInventory(cwd, home);
	mcpInventoryCache = { key, at: now, inventory };
	return inventory;
}

export function createControlPanelStatusSnapshot(
	session: AgentSession,
	sessionManager: SessionManager,
	footerData?: ReadonlyFooterDataProvider,
): ControlPanelStatusSnapshot {
	// One read of the live signals per snapshot: context usage walks the session branch, so the
	// CTX fields and the view model share this read instead of calling getContextUsage() again.
	const signals = readControlPlaneSignals(session, footerData, session.state.model?.contextWindow ?? 0);
	const mcpInventory = cachedMcpInventory(sessionManager.getCwd());
	const loadedSkills = session.resourceLoader.getSkills().skills;
	const ansiColorState = process.env.NO_COLOR ? "off" : "on";
	const cwdLabel = formatCwdForFooter(sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
	return {
		modelId: session.state.model?.id,
		modelProvider: session.state.model?.provider,
		thinkingLevel: session.state.thinkingLevel ?? "off",
		contextPercent: signals.contextPercent ?? null,
		contextWindowTokens: signals.contextWindowTokens ?? 0,
		headroomStatus: formatHeadroomStatusLabel(),
		optimizerPolicy: getHeadroomRuntimeStatus().selector,
		mcpCount: countStableMcpServers(mcpInventory.entries),
		skillCount: countRoutableNonHubSkills(loadedSkills),
		cwdLabel,
		gitBranch: footerData?.getGitBranch(),
		todoState: getCurrentTodoState(),
		ansiColorState,
		// Authority state is read from the live session each render, never asserted here.
		controlPlane: buildControlPlaneViewModel(signals),
	};
}

/**
 * Identity of what the frozen startup header shows: model and thinking level, and the session.
 * Auto thinking resolves a level per turn, so it keys as "auto" and does not refresh the header.
 */
export function controlPanelHeaderKey(session: AgentSession): ControlPanelHeaderKey {
	const model = session.state.model;
	const thinking = session.thinkingMode === "auto" ? "auto" : (session.state.thinkingLevel ?? "off");
	return {
		model: `${model?.provider ?? ""}/${model?.id ?? ""}/${thinking}`,
		session: session.sessionManager.getSessionId(),
	};
}

/** The control panel's status readers for the current session (which /new and /resume replace). */
export function controlPanelStatusReaders(
	getSession: () => AgentSession,
	footerData?: ReadonlyFooterDataProvider,
): Pick<ControlPanelContent, "statusSnapshot" | "headerKey"> {
	return {
		statusSnapshot: () => {
			const session = getSession();
			return createControlPanelStatusSnapshot(session, session.sessionManager, footerData);
		},
		headerKey: () => controlPanelHeaderKey(getSession()),
	};
}
