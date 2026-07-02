/**
 * Minimal hook inventory for the loadout runtime.
 *
 * The external harness resolves `scriptPath` to an actual shell script.
 * This module provides canonical names plus safe policy metadata so the
 * loadout layer can validate selectors without executing hooks.
 */

import fs from "node:fs";
import path from "node:path";
import type { HookPolicyMetadata } from "./hooks/index.ts";
import { DEFAULT_HOOK_POLICY, sanitizeHookPolicy } from "./hooks/index.ts";

export interface HookDescriptor {
	name: string;
	scriptPath?: string;
	builtin: boolean;
	policy: HookPolicyMetadata;
}

export interface HookInventory {
	hooks: readonly HookDescriptor[];
}

function builtinHook(name: string, policy: HookPolicyMetadata): HookDescriptor {
	return { name, builtin: true, policy: sanitizeHookPolicy(policy) };
}

export const BUILTIN_HOOKS: readonly HookDescriptor[] = [
	builtinHook("pre-shell-guard", {
		stages: ["tool_call"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 3_000,
	}),
	builtinHook("protect-secrets", {
		stages: ["tool_call", "tool_result"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 5_000,
	}),
	builtinHook("session-context", {
		stages: ["session_start"],
		effects: ["mutator"],
		failureMode: "fail-closed",
		timeoutMs: 5_000,
	}),
	builtinHook("precompact-checkpoint", {
		stages: ["pre_compact"],
		effects: ["observer"],
		failureMode: "fail-closed",
		timeoutMs: 5_000,
	}),
	builtinHook("typecheck-after-edit", {
		stages: ["tool_result"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 30_000,
	}),
	builtinHook("stop-verify", {
		stages: ["session_stop"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 30_000,
	}),
	builtinHook("subagent-stop-audit", {
		stages: ["session_stop"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 10_000,
	}),
	builtinHook("npm-audit-summary", {
		stages: ["session_stop"],
		effects: ["observer"],
		failureMode: "fail-closed",
		timeoutMs: 30_000,
	}),
	builtinHook("notify-sound-on-stop", {
		stages: ["session_stop"],
		effects: ["observer"],
		failureMode: "fail-closed",
		timeoutMs: 5_000,
	}),
	builtinHook("bounded-evidence", {
		stages: ["tool_result", "session_stop"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 10_000,
	}),
	builtinHook("document-artifact-guard", {
		stages: ["tool_result"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 5_000,
	}),
	builtinHook("component-spec-before-build", {
		stages: ["tool_call"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 5_000,
	}),
	builtinHook("visual-diff-after-edit", {
		stages: ["tool_result"],
		effects: ["validator"],
		failureMode: "fail-closed",
		timeoutMs: 10_000,
	}),
];

/**
 * Load the hook inventory. Builtin hooks are always present; if an agent
 * directory is provided and its `hooks` subdirectory exists, any shell scripts
 * discovered there are appended as non-builtin descriptors.
 */
export function loadHookInventory(agentDir?: string): HookInventory {
	const hooks: HookDescriptor[] = [...BUILTIN_HOOKS];
	if (agentDir) {
		try {
			const hooksDir = path.join(agentDir, "hooks");
			const entries = fs.readdirSync(hooksDir).sort();
			for (const entry of entries) {
				if (!entry.endsWith(".sh")) continue;
				const name = entry.slice(0, -3);
				if (hooks.some((h) => h.name === name)) continue;
				hooks.push({
					name,
					scriptPath: path.join(hooksDir, entry),
					builtin: false,
					policy: sanitizeHookPolicy(DEFAULT_HOOK_POLICY),
				});
			}
		} catch {
			// Hooks directory may be absent; builtin inventory is sufficient.
		}
	}
	return { hooks };
}
