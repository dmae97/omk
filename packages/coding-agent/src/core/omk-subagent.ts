/**
 * Built-in OMK root-orchestrator subagent tool.
 *
 * OMK acts as the root coordinator: it decomposes a goal into a task DAG, fans
 * independent lanes out to specialized subagents in parallel, and assigns each
 * lane an explicit grant (skills, hooks, MCP servers, scope, acceptance,
 * evidence output, authority). Each subagent runs in an isolated `omk` process
 * with its own context window.
 *
 * Internal routing, goal lifecycle, and durable memory are powered by the OMK
 * adaptive runtime (topology routing, synthesis routing, durable memory). Those
 * engines are referenced only through generic, user-facing wording — never by
 * internal product names.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/omk-agent-core";
import type { Message } from "@earendil-works/omk-ai";
import { Type } from "typebox";
import { getAgentDir } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { type AdaptiveEdge, computeAdaptiveTopology } from "./adaptive-runtime.ts";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "./extensions/index.ts";

const MAX_PARALLEL_LANES = 8;
const MAX_CONCURRENCY = 4;
const PER_LANE_OUTPUT_CAP = 50 * 1024;

// ---------------------------------------------------------------------------
// Agent discovery
// ---------------------------------------------------------------------------

type AgentScope = "user" | "project" | "both";

interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!fs.existsSync(dir)) return agents;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
		if (!frontmatter.name || !frontmatter.description) continue;

		const tools = frontmatter.tools
			?.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".omk", "agents");
		if (isDirectory(candidate)) return candidate;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();
	if (scope === "both") {
		for (const a of userAgents) agentMap.set(a.name, a);
		for (const a of projectAgents) agentMap.set(a.name, a);
	} else if (scope === "user") {
		for (const a of userAgents) agentMap.set(a.name, a);
	} else {
		for (const a of projectAgents) agentMap.set(a.name, a);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

// ---------------------------------------------------------------------------
// Per-lane grant contract (skills / hooks / MCP / scope / acceptance / authority)
// ---------------------------------------------------------------------------

interface LaneGrant {
	skills?: string[];
	hooks?: string[];
	mcp?: string[];
	scope?: string;
	acceptance?: string;
	evidenceOutput?: string;
	authority?: string;
}

interface RoleDefaults {
	skills: string[];
	hooks: string[];
	mcp: string[];
	scope: string;
	authority: string;
}

const READ_ONLY_HOOKS = ["pre-shell-guard.sh", "protect-secrets.sh"];
const WRITE_HOOKS = ["pre-shell-guard.sh", "protect-secrets.sh", "post-format.sh", "stop-verify.sh"];

function roleDefaultsFor(agentName: string): RoleDefaults {
	const name = agentName.toLowerCase();

	if (name.includes("plan") || name.includes("coordinat") || name.includes("architect")) {
		return {
			skills: ["omk-plan-first", "omk-task-router", "omk-context-broker", "omk-industrial-control-loop"],
			hooks: ["session-context.sh", "precompact-checkpoint.sh", ...READ_ONLY_HOOKS],
			mcp: ["memory", "filesystem-readonly", "context7"],
			scope: "Read-only planning only; produce a DAG, batches, risks, and acceptance criteria. Do not edit files.",
			authority: "read-only / advisory",
		};
	}
	if (name.includes("explor") || name.includes("research") || name.includes("scanner") || name.includes("discover")) {
		return {
			skills: ["omk-repo-explorer", "omk-context-broker", "omk-research-verify", "agentmemory"],
			hooks: [...READ_ONLY_HOOKS, "session-context.sh"],
			mcp: ["filesystem-readonly", "context7", "fetch", "memory"],
			scope: "Read-only reconnaissance; map files, symbols, constraints, and verification commands. Do not edit files.",
			authority: "read-only / advisory",
		};
	}
	if (name.includes("review")) {
		return {
			skills: ["omk-code-review", "omk-quality-gate", "omk-evidence-contract"],
			hooks: ["stop-verify.sh", "subagent-stop-audit.sh"],
			mcp: ["github", "memory", "filesystem-readonly"],
			scope: "Adversarial review of the delegated diff; report findings by severity. Do not edit files.",
			authority: "read-only / advisory",
		};
	}
	if (name.includes("secur")) {
		return {
			skills: ["omk-secret-guard", "omk-security-review", "omk-evidence-contract"],
			hooks: ["protect-secrets.sh", "subagent-stop-audit.sh"],
			mcp: ["memory", "filesystem-readonly"],
			scope: "Security, secret, permission, and trust-boundary audit of the delegated change. Do not edit files.",
			authority: "read-only / advisory",
		};
	}
	if (name.includes("test") || name.includes("qa")) {
		return {
			skills: ["omk-test-debug-loop", "omk-quality-gate"],
			hooks: [...WRITE_HOOKS, "subagent-stop-audit.sh"],
			mcp: ["filesystem", "memory"],
			scope: "Run and harden tests for the delegated change; report pass/fail and coverage gaps.",
			authority: "test write + shell (test commands only)",
		};
	}
	if (name.includes("doc") || name.includes("release")) {
		return {
			skills: ["omk-docs-release", "omk-git-commit-pr", "omk-evidence-contract"],
			hooks: ["release-check-before-stop.sh", "stop-verify.sh"],
			mcp: ["github", "memory", "filesystem-readonly"],
			scope: "Documentation, changelog, and release notes for the delegated change only.",
			authority: "docs write",
		};
	}
	// Default: implementation lane (coder).
	return {
		skills: ["omk-typescript-strict", "omk-code-review", "omk-quality-gate", "omk-test-debug-loop"],
		hooks: WRITE_HOOKS,
		mcp: ["filesystem", "context7", "memory"],
		scope: "Implement only the delegated slice; preserve concurrent edits and unrelated user changes.",
		authority: "write + shell (delegated scope only)",
	};
}

function uniqueMerge(primary: string[], extra: string[] | undefined): string[] {
	const out = new Set<string>(primary);
	for (const item of extra ?? []) {
		const trimmed = item.trim();
		if (trimmed) out.add(trimmed);
	}
	return Array.from(out);
}

/**
 * Build the explicit lane grant that is injected into the subagent prompt.
 * Provided grant fields win; role defaults fill the rest.
 */
function resolveLaneGrant(
	_agent: AgentConfig | undefined,
	agentName: string,
	provided: LaneGrant | undefined,
): LaneGrant {
	const defaults = roleDefaultsFor(agentName);
	const evidenceOutput =
		provided?.evidenceOutput?.trim() || `.omk/runs/<run-id>/lanes/${agentName.replace(/[^\w.-]+/g, "_")}.md`;
	return {
		skills: uniqueMerge(defaults.skills, provided?.skills),
		hooks: uniqueMerge(defaults.hooks, provided?.hooks),
		mcp: uniqueMerge(defaults.mcp, provided?.mcp),
		scope: provided?.scope?.trim() || defaults.scope,
		acceptance: provided?.acceptance?.trim() || "Lane goal met with verifiable evidence; no out-of-scope edits.",
		evidenceOutput,
		authority: provided?.authority?.trim() || defaults.authority,
	};
}

function formatLaneGrantPrompt(agentName: string, goal: string | undefined, grant: LaneGrant): string {
	const lines: string[] = [];
	lines.push("## OMK lane grant (root orchestrator → subagent)");
	if (goal?.trim()) lines.push(`- Root goal: ${goal.trim()}`);
	lines.push(`- Lane: ${agentName}`);
	lines.push(`- Scope: ${grant.scope}`);
	lines.push(`- Authority: ${grant.authority}`);
	lines.push(`- Skills: ${grant.skills?.join(", ") || "(none)"}`);
	lines.push(`- Hooks: ${grant.hooks?.join(", ") || "(none)"}`);
	lines.push(`- MCP lanes: ${grant.mcp?.join(", ") || "(none)"}`);
	lines.push(`- Acceptance: ${grant.acceptance}`);
	lines.push(`- Evidence output: ${grant.evidenceOutput}`);
	lines.push(
		"- Runtime: rely on the OMK root orchestrator for goal lifecycle, topology routing, synthesis routing, and durable memory. Stay inside the granted scope/authority and preserve concurrent edits.",
	);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Topology hint (internal adaptive routing, generic wording only)
// ---------------------------------------------------------------------------

function topologyHint(laneCount: number, mode: "single" | "parallel" | "chain"): string {
	const nodes = Array.from({ length: laneCount }, (_, i) => `lane-${i + 1}`);
	let edges: AdaptiveEdge[] = [];
	if (mode === "chain") {
		edges = nodes.slice(1).map((to, i) => ({ from: nodes[i], to }));
	}
	const decision = computeAdaptiveTopology(nodes, edges);
	return `${decision.topology} (${decision.reason})`;
}

// ---------------------------------------------------------------------------
// Subagent execution (isolated omk child process)
// ---------------------------------------------------------------------------

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface LaneResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	topology: string;
	results: LaneResult[];
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

function isFailed(result: LaneResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function getResultOutput(result: LaneResult): string {
	if (isFailed(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

function truncateLaneOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_LANE_OUTPUT_CAP) return output;
	let truncated = output.slice(0, PER_LANE_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_LANE_OUTPUT_CAP) truncated = truncated.slice(0, -1);
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted.]`;
}

async function mapWithConcurrency<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

function getOmkInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}
	return { command: "omk", args };
}

type OnUpdate = (partial: AgentToolResult<SubagentDetails>) => void;

async function runLane(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	goal: string | undefined,
	grant: LaneGrant | undefined,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdate | undefined,
	makeDetails: (results: LaneResult[]) => SubagentDetails,
): Promise<LaneResult> {
	const agent = agents.find((a) => a.name === agentName);
	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
		};
	}

	const resolvedGrant = resolveLaneGrant(agent, agentName, grant);
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: LaneResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: agent.model,
		step,
	};

	const emitUpdate = () => {
		onUpdate?.({
			content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
			details: makeDetails([currentResult]),
		});
	};

	try {
		// Subagents inherit the granted skills/hooks/MCP via their own runtime; the
		// lane grant + agent system prompt are appended as the contract.
		const grantPrompt = formatLaneGrantPrompt(agentName, goal, resolvedGrant);
		const appendPrompt = agent.systemPrompt.trim() ? `${agent.systemPrompt.trim()}\n\n${grantPrompt}` : grantPrompt;
		const tmp = await writePromptToTempFile(agent.name, appendPrompt);
		tmpPromptDir = tmp.dir;
		tmpPromptPath = tmp.filePath;
		args.push("--append-system-prompt", tmpPromptPath);

		args.push(`Task: ${task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getOmkInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				// Mark child as a lane so it stays in worker mode, not root orchestrator.
				env: { ...process.env, OMK_SUBAGENT_LANE: "1" },
			});
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: { type?: string; message?: Message } | undefined;
				try {
					event = JSON.parse(line) as { type?: string; message?: Message };
				} catch {
					return;
				}
				if (!event) return;

				if (event.type === "message_end" && event.message) {
					const msg = event.message;
					currentResult.messages.push(msg);
					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = (
							msg as Message & {
								usage?: Record<string, number> & { cost?: { total?: number }; totalTokens?: number };
							}
						).usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						const assistantMsg = msg as Message & { model?: string; stopReason?: string; errorMessage?: string };
						if (!currentResult.model && assistantMsg.model) currentResult.model = assistantMsg.model;
						if (assistantMsg.stopReason) currentResult.stopReason = assistantMsg.stopReason;
						if (assistantMsg.errorMessage) currentResult.errorMessage = assistantMsg.errorMessage;
					}
					emitUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});
			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});
			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});
			proc.on("error", () => resolve(1));

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		if (wasAborted) throw new Error("Subagent lane was aborted");
		return currentResult;
	} finally {
		if (tmpPromptPath) {
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		}
		if (tmpPromptDir) {
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const LaneGrantSchema = Type.Object({
	skills: Type.Optional(Type.Array(Type.String(), { description: "Skill entrypoints granted to this lane" })),
	hooks: Type.Optional(Type.Array(Type.String(), { description: "Hooks this lane must respect" })),
	mcp: Type.Optional(Type.Array(Type.String(), { description: "MCP servers this lane may call" })),
	scope: Type.Optional(Type.String({ description: "Allowed files/directories or read-only scope" })),
	acceptance: Type.Optional(Type.String({ description: "Explicit pass criteria for the lane" })),
	evidenceOutput: Type.Optional(Type.String({ description: "Path under .omk/runs/<run-id>/ for lane evidence" })),
	authority: Type.Optional(Type.String({ description: "read-only/advisory, write+shell, etc." })),
});

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	grant: Type.Optional(LaneGrantSchema),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	grant: Type.Optional(LaneGrantSchema),
});

const SubagentParams = Type.Object({
	goal: Type.Optional(Type.String({ description: "Root goal these lanes serve (recommended for orchestration)" })),
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (single mode)" })),
	grant: Type.Optional(LaneGrantSchema),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Independent lanes to run in parallel" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Dependent lanes to run sequentially" })),
	agentScope: Type.Optional(
		Type.String({
			description: 'Which agent directories to use: "user" (default), "project", or "both".',
		}),
	),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});

type SubagentParamsT = {
	goal?: string;
	agent?: string;
	task?: string;
	grant?: LaneGrant;
	tasks?: Array<{ agent: string; task: string; cwd?: string; grant?: LaneGrant }>;
	chain?: Array<{ agent: string; task: string; cwd?: string; grant?: LaneGrant }>;
	agentScope?: string;
	confirmProjectAgents?: boolean;
	cwd?: string;
};

const ORCHESTRATION_GUIDELINES = [
	"You are the OMK root orchestrator: decompose the user goal into a task DAG and own routing, lane grants, evidence, and final synthesis.",
	"Fan out independent work with the subagent tool in parallel lanes; sequence only dependent lanes. Never run two writer lanes on the same files.",
	"For every lane, pass an explicit grant: skills, hooks, MCP servers, scope, acceptance, evidence output, and authority. Read-only lanes (explorer/reviewer/security/qa) stay read-only.",
	"Search/recall durable memory first, route the DAG by topology, then synthesize lane evidence into one consistent result. Do not claim success without lane evidence.",
	"Keep internal routing/memory engine names out of user-facing copy; refer to them only as goal lifecycle, topology routing, synthesis routing, and durable memory.",
];

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export function createOmkSubagentExtension(): (omk: ExtensionAPI) => void {
	return (omk: ExtensionAPI) => {
		const definition: ToolDefinition<typeof SubagentParams, SubagentDetails> = {
			name: "subagent",
			label: "Subagent",
			description: [
				"Delegate tasks to specialized subagents with isolated context, as the OMK root orchestrator.",
				"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous}).",
				"Pass a per-lane grant (skills, hooks, mcp, scope, acceptance, evidenceOutput, authority) for each lane.",
				'Default agent scope is "user" (from ~/.omk/agent/agents). Use agentScope "both" for project-local .omk/agents.',
			].join(" "),
			promptSnippet:
				"Delegate goal work to parallel subagent lanes; assign each lane explicit skills, hooks, MCP, scope, acceptance, evidence, and authority.",
			promptGuidelines: ORCHESTRATION_GUIDELINES,
			parameters: SubagentParams,

			async execute(
				_toolCallId: string,
				rawParams: SubagentParamsT,
				signal: AbortSignal | undefined,
				onUpdate: ((partial: AgentToolResult<SubagentDetails>) => void) | undefined,
				ctx: ExtensionContext,
			): Promise<AgentToolResult<SubagentDetails>> {
				const params = rawParams;
				const agentScope: AgentScope =
					params.agentScope === "project" || params.agentScope === "both" ? params.agentScope : "user";
				const discovery = discoverAgents(ctx.cwd, agentScope);
				const agents = discovery.agents;
				const confirmProjectAgents = params.confirmProjectAgents ?? true;

				const hasChain = (params.chain?.length ?? 0) > 0;
				const hasTasks = (params.tasks?.length ?? 0) > 0;
				const hasSingle = Boolean(params.agent && params.task);
				const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

				const mode: "single" | "parallel" | "chain" = hasChain ? "chain" : hasTasks ? "parallel" : "single";
				const laneCount = hasChain ? params.chain!.length : hasTasks ? params.tasks!.length : 1;
				const topology = topologyHint(laneCount, mode);

				const makeDetails =
					(m: "single" | "parallel" | "chain") =>
					(results: LaneResult[]): SubagentDetails => ({
						mode: m,
						agentScope,
						projectAgentsDir: discovery.projectAgentsDir,
						topology,
						results,
					});

				if (modeCount !== 1) {
					const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
					return {
						content: [
							{
								type: "text",
								text: `Invalid parameters. Provide exactly one mode (single | parallel | chain).\nAvailable agents: ${available}`,
							},
						],
						details: makeDetails("single")([]),
					};
				}

				if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
					const requested = new Set<string>();
					if (params.chain) for (const s of params.chain) requested.add(s.agent);
					if (params.tasks) for (const t of params.tasks) requested.add(t.agent);
					if (params.agent) requested.add(params.agent);

					const projectRequested = Array.from(requested)
						.map((name) => agents.find((a) => a.name === name))
						.filter((a): a is AgentConfig => a?.source === "project");

					if (projectRequested.length > 0) {
						const names = projectRequested.map((a) => a.name).join(", ");
						const dir = discovery.projectAgentsDir ?? "(unknown)";
						const ok = await ctx.ui.confirm(
							"Run project-local agents?",
							`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
						);
						if (!ok) {
							return {
								content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
								details: makeDetails(mode)([]),
							};
						}
					}
				}

				// Chain mode (dependent lanes, sequential).
				if (hasChain) {
					const results: LaneResult[] = [];
					let previousOutput = "";
					for (let i = 0; i < params.chain!.length; i++) {
						const stepItem = params.chain![i];
						const taskWithContext = stepItem.task.replace(/\{previous\}/g, previousOutput);
						const chainUpdate: OnUpdate | undefined = onUpdate
							? (partial) => {
									const current = partial.details?.results[0];
									if (current) {
										onUpdate({
											content: partial.content,
											details: makeDetails("chain")([...results, current]),
										});
									}
								}
							: undefined;
						const result = await runLane(
							ctx.cwd,
							agents,
							stepItem.agent,
							taskWithContext,
							params.goal,
							stepItem.grant,
							stepItem.cwd,
							i + 1,
							signal,
							chainUpdate,
							makeDetails("chain"),
						);
						results.push(result);
						if (isFailed(result)) {
							return {
								content: [
									{
										type: "text",
										text: `Chain stopped at step ${i + 1} (${stepItem.agent}): ${getResultOutput(result)}`,
									},
								],
								details: makeDetails("chain")(results),
								terminate: false,
							};
						}
						previousOutput = getFinalOutput(result.messages);
					}
					return {
						content: [
							{
								type: "text",
								text: `Chain complete (${topology}).\n\n${getFinalOutput(results[results.length - 1].messages) || "(no output)"}`,
							},
						],
						details: makeDetails("chain")(results),
					};
				}

				// Parallel mode (independent lanes, fan-out).
				if (hasTasks) {
					if (params.tasks!.length > MAX_PARALLEL_LANES) {
						return {
							content: [
								{
									type: "text",
									text: `Too many parallel lanes (${params.tasks!.length}). Max is ${MAX_PARALLEL_LANES}.`,
								},
							],
							details: makeDetails("parallel")([]),
						};
					}

					const allResults: LaneResult[] = params.tasks!.map((t) => ({
						agent: t.agent,
						agentSource: "unknown",
						task: t.task,
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					}));

					const emitParallel = () => {
						if (!onUpdate) return;
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{
									type: "text",
									text: `Parallel [${topology}]: ${done}/${allResults.length} done, ${running} running...`,
								},
							],
							details: makeDetails("parallel")([...allResults]),
						});
					};

					const results = await mapWithConcurrency(params.tasks!, MAX_CONCURRENCY, async (t, index) => {
						const result = await runLane(
							ctx.cwd,
							agents,
							t.agent,
							t.task,
							params.goal,
							t.grant,
							t.cwd,
							undefined,
							signal,
							(partial) => {
								if (partial.details?.results[0]) {
									allResults[index] = partial.details.results[0];
									emitParallel();
								}
							},
							makeDetails("parallel"),
						);
						allResults[index] = result;
						emitParallel();
						return result;
					});

					const successCount = results.filter((r) => !isFailed(r)).length;
					const summaries = results.map((r) => {
						const output = truncateLaneOutput(getResultOutput(r));
						const status = isFailed(r)
							? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
							: "completed";
						return `### [${r.agent}] ${status}\n\n${output}`;
					});
					return {
						content: [
							{
								type: "text",
								text: `Parallel: ${successCount}/${results.length} lanes succeeded (${topology})\n\n${summaries.join("\n\n---\n\n")}`,
							},
						],
						details: makeDetails("parallel")(results),
					};
				}

				// Single mode.
				const result = await runLane(
					ctx.cwd,
					agents,
					params.agent!,
					params.task!,
					params.goal,
					params.grant,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
				);
				if (isFailed(result)) {
					return {
						content: [
							{ type: "text", text: `Lane ${result.stopReason || "failed"}: ${getResultOutput(result)}` },
						],
						details: makeDetails("single")([result]),
						terminate: false,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			},
		};

		omk.registerTool(definition as unknown as ToolDefinition);
	};
}
