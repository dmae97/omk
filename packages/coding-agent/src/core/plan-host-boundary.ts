import { isReadOnlyPlanCommand, isShellToolName, isWriteToolName } from "./pstack-plan-guards.ts";
import type { SandboxPolicy } from "./sandbox/policy.ts";

const activePlanReadOnlySessions = new Set<string>();

export function setPlanReadOnlyActive(sessionId: string | undefined, active: boolean): void {
	if (!sessionId) return;
	if (active) activePlanReadOnlySessions.add(sessionId);
	else activePlanReadOnlySessions.delete(sessionId);
}

export function isPlanReadOnlyActive(sessionId: string | undefined): boolean {
	return sessionId !== undefined && activePlanReadOnlySessions.has(sessionId);
}

export function toReadOnlySandboxPolicy(policy: SandboxPolicy): SandboxPolicy {
	const denyWrite = policy.filesystem.denyWrite.includes(policy.filesystem.root)
		? policy.filesystem.denyWrite
		: [policy.filesystem.root, ...policy.filesystem.denyWrite];
	return {
		...policy,
		filesystem: {
			...policy.filesystem,
			writeAllow: [],
			tempWrite: [],
			denyWrite,
		},
	};
}

export function assertPlanReadOnlyAllowsTool(sessionId: string | undefined, call: PlanHostBoundaryCall): void {
	if (!isPlanReadOnlyActive(sessionId)) return;
	const verdict = evaluatePlanHostBoundary(call);
	if (!verdict.allowed) {
		throw new Error(`[${verdict.boundary}] ${verdict.reason}`);
	}
}

export function evaluatePlanToolCallEvent(event: {
	readonly toolName: string;
	readonly input?: unknown;
}): { readonly block: true; readonly reason: string } | undefined {
	const source = isShellToolName(event.toolName) ? "shell" : event.toolName.includes("__") ? "mcp" : "builtin";
	const verdict = evaluatePlanHostBoundary({
		toolName: event.toolName,
		source,
		args: (event.input ?? {}) as Readonly<Record<string, unknown>>,
	});
	if (!verdict.allowed) {
		return {
			block: true,
			reason: `Pstack /plan mode is read-only ([${verdict.boundary}]): ${verdict.reason}. Use /plan run or /plan off first.`,
		};
	}
	return undefined;
}
const READ_ONLY_BUILTIN_TOOLS: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"ffgrep",
	"fffind",
	"find",
	"ls",
	"diagnostics",
	"lens_diagnostics",
	"project_report",
	"module_report",
	"read_symbol",
	"read_enclosing",
	"symbol_search",
	"lsp_navigation",
	"todo",
	"skill_plan",
	"ask_user_question",
]);

const EXTRA_SHELL_UNSAFE_PATTERN = /[\r\n(]/;

export interface PlanHostBoundaryCall {
	readonly toolName: string;
	readonly source: "builtin" | "shell" | "extension" | "mcp";
	readonly args?: Readonly<Record<string, unknown>>;
	readonly readOnlyHint?: boolean;
}

export type PlanHostBoundaryVerdict =
	| { readonly allowed: true }
	| { readonly allowed: false; readonly boundary: "plan.host_readonly"; readonly reason: string };

/**
 * Host-level /plan read-only enforcement across builtin, shell, extension, and MCP tools.
 * Default-deny for extension and MCP tools unless explicitly marked readOnlyHint=true.
 */
export function evaluatePlanHostBoundary(call: PlanHostBoundaryCall): PlanHostBoundaryVerdict {
	const name = call.toolName.trim().toLowerCase();
	if (isWriteToolName(name)) {
		return { allowed: false, boundary: "plan.host_readonly", reason: `tool "${call.toolName}" is mutating in /plan` };
	}
	if (call.source === "shell" || isShellToolName(name)) {
		const cmd = typeof call.args?.command === "string" ? call.args.command : "";
		if (!cmd.trim() || EXTRA_SHELL_UNSAFE_PATTERN.test(cmd) || !isReadOnlyPlanCommand(cmd)) {
			return {
				allowed: false,
				boundary: "plan.host_readonly",
				reason: `shell command is not read-only in /plan: ${cmd.slice(0, 80)}`,
			};
		}
		return { allowed: true };
	}
	if (call.source === "extension" || call.source === "mcp") {
		if (call.readOnlyHint === true) return { allowed: true };
		return {
			allowed: false,
			boundary: "plan.host_readonly",
			reason: `${call.source} tool "${call.toolName}" lacks explicit readOnlyHint in /plan`,
		};
	}
	if (READ_ONLY_BUILTIN_TOOLS.has(name)) return { allowed: true };
	return {
		allowed: false,
		boundary: "plan.host_readonly",
		reason: `builtin tool "${call.toolName}" is not in /plan read-only allowlist`,
	};
}
