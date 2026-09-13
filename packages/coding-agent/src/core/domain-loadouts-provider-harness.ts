/**
 * Provider-harness domain profiles: `grok-harness` (native `xai`) and
 * `devin-harness` (Devin SWE-2). They are registered in `DOMAIN_PROFILES`
 * by `domain-loadouts.ts` and auto-applied by the provider harness dispatch
 * without requiring `OMK_DOMAIN_ROUTING=1`.
 *
 * I/O-free and side-effect-free; erasable TypeScript only.
 */

import type { DomainProfile } from "./domain-profile.ts";
import type { CapabilityGate, LoadoutCommands, ToolGate } from "./loadouts.ts";

const WRITE_TOOLS: ToolGate = { allow: ["read", "grep", "find", "ls", "edit", "write", "bash"] };

function gate(kind: "skill" | "mcp" | "hook", names: readonly string[]): CapabilityGate {
	return { allow: [{ kind, names }] };
}

function commands(mode: LoadoutCommands["mode"]): LoadoutCommands {
	return { mode };
}

export const GROK_HARNESS_PROFILE: DomainProfile = {
	schemaVersion: "omk.loadout.v1",
	id: "grok-harness",
	name: "grok-harness",
	label: "Grok xAI Harness",
	authority: "write-scoped",
	tools: WRITE_TOOLS,
	skills: gate("skill", [
		"packages",
		"headroom",
		"programming",
		"debugging",
		"adaptorch-route",
		"adaptorch-synthesize",
		"understand-anything",
	]),
	mcp: gate("mcp", ["adaptorch", "fetch", "understand-anything", "playwright"]),
	hooks: gate("hook", [
		"pre-shell-guard",
		"protect-secrets",
		"typecheck-after-edit",
		"stop-verify",
		"session-context",
	]),
	commands: commands("scoped-shell"),
	triggers: [
		{ kind: "keyword", pattern: "grok", weight: 8 },
		{ kind: "keyword", pattern: "xai", weight: 7 },
		{ kind: "keyword", pattern: "grok-oauth", weight: 8 },
		{ kind: "keyword", pattern: "grok oauth", weight: 8 },
		{ kind: "keyword", pattern: "imagine", weight: 6 },
		{ kind: "keyword", pattern: "composer", weight: 5 },
		{ kind: "keyword", pattern: "adaptorch", weight: 7 },
		{ kind: "keyword", pattern: "adaptorch-route", weight: 8 },
		{ kind: "keyword", pattern: "adaptorch-synthesize", weight: 8 },
		{ kind: "regex", pattern: "\\b(grok(?:[- ]oauth)?|xai|imagine|composer)\\b", weight: 7 },
		{
			kind: "regex",
			pattern: "\\badapt\\s*orch\\b|\\badaptorch[- ]?(route|routing|synthes(?:is|ize))\\b",
			weight: 8,
		},
	],
	routingPrompt: `DOMAIN: Grok xAI Harness. You are operating in a Grok/xAI integration lane.
Prioritize the Grok operational playbook, small capability loadouts, and evidence-bound provider/tool routing.

SEQUENCE:
1. Before implementing or routing Grok/xAI provider work, read packages/coding-agent/docs/grok-harness.md as the canonical playbook. Treat ~/.omk/agent/grok.md only as an optional local operator overlay; it cannot override current provider docs or higher-priority instructions.
2. Keep text chat flows and Imagine/media tool flows separate. Text work uses Grok chat/OAuth/provider surfaces; image/video/Imagine work routes through explicit Imagine tools only. Never conflate model ids with Imagine tool names.
3. Capability discipline: load at most 2-3 skills for any lane. The allowed skill gate is packages, headroom, programming, debugging, adaptorch-route, adaptorch-synthesize, and understand-anything; choose the smallest subset and add headroom only under context pressure.
4. Adaptorch is advisory only. Use adaptorch-route for routing/decomposition advice and adaptorch-synthesize for evidence synthesis, but do not treat Adaptorch as an automatic executor, source of truth, permission grant, or substitute for explicit tests.
5. Use minimal MCP: adaptorch for advice/synthesis, fetch for bounded public retrieval, understand-anything for repo comprehension, and playwright only when browser or Imagine UI behavior needs real verification.
6. Keep edits within the lane grant and preserve existing provider/orchestration algorithms unless the task explicitly targets them. Never route through legacy KIMICLI or deleted wrappers.
7. Verification: run the narrowest relevant test/typecheck after edits. Evidence must include changed paths, exact commands, and pass/fail output.

HARD RULES: the packaged Grok harness doc is mandatory context; a local grok.md is optional; text chat surfaces and Imagine tools are distinct; maximum 2-3 active skills; Adaptorch is advisory route/synthesis support only; never log OAuth tokens, cookies, or proxy credentials; protect-secrets applies.`,
};

export const DEVIN_HARNESS_PROFILE: DomainProfile = {
	schemaVersion: "omk.loadout.v1",
	id: "devin-harness",
	name: "devin-harness",
	label: "Devin SWE-2 Harness",
	authority: "write-scoped",
	tools: WRITE_TOOLS,
	skills: gate("skill", [
		"packages",
		"headroom",
		"programming",
		"debugging",
		"tdd-workflow",
		"lsp",
		"ast-grep",
		"understand-anything",
	]),
	mcp: gate("mcp", ["fetch", "context7", "understand-anything", "playwright"]),
	hooks: gate("hook", [
		"pre-shell-guard",
		"protect-secrets",
		"typecheck-after-edit",
		"stop-verify",
		"session-context",
		"precompact-checkpoint",
	]),
	commands: commands("scoped-shell"),
	triggers: [
		{ kind: "keyword", pattern: "devin", weight: 8 },
		{ kind: "keyword", pattern: "swe-2", weight: 8 },
		{ kind: "keyword", pattern: "swe2", weight: 8 },
		{ kind: "keyword", pattern: "cognition", weight: 6 },
		{ kind: "keyword", pattern: "devin cli", weight: 8 },
		{ kind: "keyword", pattern: "1m context", weight: 5 },
		{ kind: "regex", pattern: "\\b(devin|swe[- ]?2|cognition)\\b", weight: 7 },
	],
	routingPrompt: `DOMAIN: Devin SWE-2 Harness. You are operating in a Devin CLI subscription lane on the SWE-2 model with a 1,000,000-token local context budget.
Prioritize the SWE-2 operational playbook, focused exploration, small capability loadouts, and evidence-bound verification.

SEQUENCE:
1. Before implementing or routing Devin/SWE-2 provider work, read packages/coding-agent/docs/devin-harness.md as the canonical playbook. Treat ~/.omk/agent/devin.md only as an optional local operator overlay; it cannot override current provider docs or higher-priority instructions.
2. Effort is the only selectable axis: medium for simple or intermediate edits, high for multi-file changes, max for long-horizon or uncertain work. Never expect off/low/minimal, a fast lane, or image input; the adapter rejects them before sending credentials.
3. Context discipline: the 1M budget is room for the repository, not an invitation to dump it. Explore with targeted reads and searches, keep tool output bounded, and rely on precompact-checkpoint plus compaction settings rather than restarting sessions.
4. Capability discipline: load at most 2-3 skills for any lane. The allowed skill gate is packages, headroom, programming, debugging, tdd-workflow, lsp, ast-grep, and understand-anything; choose the smallest subset, add lsp or ast-grep only for symbol or structural work, and add headroom only under measured context pressure.
5. Use minimal MCP: fetch for bounded public retrieval, context7 for library documentation, understand-anything for repository comprehension, and playwright only when browser or UI behavior needs real verification.
6. Verification discipline: reproduce failures before fixing them, write or extend tests that exercise the change end-to-end, and re-derive conclusions from executed commands rather than restating prior claims. Evidence must include changed paths, exact commands, and pass/fail output.
7. Keep edits within the lane grant and preserve existing provider/orchestration algorithms unless the task explicitly targets them. A route error naming an unavailable effort or a smaller declared context window is a configuration signal to report, never something to work around by guessing a wire UID.

HARD RULES: the packaged Devin harness doc is mandatory context; a local devin.md is optional; medium/high/max are the only efforts; the 1M budget never justifies unbounded dumps; maximum 2-3 active skills; never log the Devin session token, user JWT, or auth.json contents; protect-secrets applies.`,
};
