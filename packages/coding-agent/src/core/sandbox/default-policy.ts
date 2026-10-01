/**
 * Default bash sandbox policy wiring (default-on enforcement, explicit opt-out).
 *
 * Two live modes:
 * - `audit`   — preflight only, spawn stays unwrapped; every decision is eligible
 *   for replay-ledger recording by the session (tamper-evident audit trail).
 * - `enforce` — wraps the spawn with the real OS backend (macOS seatbelt /
 *   Linux bubblewrap) and fails closed when no backend is available.
 */
import { tmpdir } from "node:os";
import type { BashSandboxPreflight } from "../tools/bash.ts";
import type { SandboxBackendStatus, SandboxMode, SandboxPolicy } from "./policy.ts";

export type BashSandboxMode = SandboxMode;

const OFF_VALUES = new Set(["0", "off", "false", "disable", "disabled", "none"]);

/**
 * Resolve the bash sandbox mode. Enforcement is the fail-safe default, including
 * for unknown values. `audit` and `off` are explicit compatibility escape hatches.
 */
export function resolveBashSandboxMode(env?: Record<string, string | undefined>): SandboxMode {
	const source: Record<string, string | undefined> = env ?? process.env;
	const raw = (source.OMK_BASH_SANDBOX ?? "").trim().toLowerCase();
	if (OFF_VALUES.has(raw)) return "off";
	if (raw === "audit") return "audit";
	return "enforce";
}

/**
 * Workspace-write policy for the session bash runtime. Outbound network access
 * is disabled; writes are limited to the workspace and the OS temp directory.
 */
export function createWorkspaceSandboxPolicy(root: string, mode: Exclude<SandboxMode, "off">): SandboxPolicy {
	return {
		mode,
		profile: "workspace-write",
		filesystem: {
			root,
			readAllow: [root],
			readDeny: [],
			writeAllow: [root],
			denyWrite: [],
			tempWrite: [tmpdir()],
			followSymlinks: false,
		},
		network: {
			mode: "none",
			allowedDomains: [],
			deniedDomains: [],
			allowUnixSockets: [],
			allowBrowser: false,
		},
		process: {
			allowExec: true,
			allowShell: true,
			allowPrivilege: false,
		},
	};
}

/**
 * The preflight every default local shell spawn under `root` uses; `undefined`
 * when the mode is `off`. `enforce` keeps the detected backend, so a missing
 * one fails closed; `audit` reports none, so the spawn stays unwrapped.
 */
export function createDefaultBashSandboxPreflight(
	root: string,
	mode: SandboxMode,
	detected: SandboxBackendStatus,
): (BashSandboxPreflight & { readonly backend: SandboxBackendStatus }) | undefined {
	if (mode === "off") return undefined;
	const backend: SandboxBackendStatus =
		mode === "enforce"
			? detected
			: { platform: detected.platform, backendAvailable: false, domainAllowlistAvailable: false };
	return { policy: createWorkspaceSandboxPolicy(root, mode), backend };
}
