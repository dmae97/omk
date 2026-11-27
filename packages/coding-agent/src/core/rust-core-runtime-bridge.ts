import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const RUST_WIRE_PROTOCOL_VERSION = "omk.native-agent.v1" as const;

export interface RustWireCapabilities {
	readonly offlineOnly: boolean;
	readonly backend: boolean;
	readonly execute: boolean;
}

export type RustWireProbeResult =
	| {
			readonly reachable: true;
			readonly protocolVersion: typeof RUST_WIRE_PROTOCOL_VERSION;
			readonly capabilities: RustWireCapabilities;
	  }
	| {
			readonly reachable: false;
			readonly error: string;
	  };

export interface RustCoreParityChecklist {
	readonly provider: boolean;
	readonly tool: boolean;
	readonly session: boolean;
	readonly recovery: boolean;
}

export interface CoreRuntimeSelection {
	readonly requested: "node" | "rust";
	readonly active: "node" | "rust";
	readonly rolledBackToNode: boolean;
	readonly rollbackReason?: string;
	readonly rustProbe?: RustWireProbeResult;
}

/**
 * Probe the real compiled Rust `omk-native-wire` binary over newline-delimited JSON stdin/stdout.
 * Verifies live Node <-> Rust IPC without mocks.
 */
export function probeRustRuntimeWire(binaryPath: string, timeoutMs = 5_000): RustWireProbeResult {
	if (!binaryPath || !existsSync(binaryPath)) {
		return { reachable: false, error: "rust_binary_missing" };
	}
	const identity = {
		version: RUST_WIRE_PROTOCOL_VERSION,
		launchId: "probe-launch",
		sessionId: "probe-session",
		promptId: "probe-prompt",
		toolCallId: "probe-tool",
		scopeEpochId: "probe-epoch",
		generation: 1,
		attempt: 1,
		grantDigest: "a".repeat(64),
	};
	const helloFrame = JSON.stringify({ type: "hello", data: { identity, controlSeq: 1 } });
	const execFrame = JSON.stringify({ type: "execute", data: { identity, controlSeq: 2 } });
	const result = spawnSync(binaryPath, [], {
		input: `${helloFrame}\n${execFrame}\n`,
		encoding: "utf8",
		timeout: timeoutMs,
	});
	if (result.error) {
		return { reachable: false, error: `spawn_error:${result.error.message}` };
	}
	if (result.status !== 0) {
		return { reachable: false, error: `exit_${result.status}:${(result.stderr || "").trim()}` };
	}
	const firstLine = (result.stdout || "").split("\n").find((line) => line.trim().length > 0);
	if (!firstLine) {
		return { reachable: false, error: "empty_reply" };
	}
	try {
		const parsed = JSON.parse(firstLine) as {
			type?: string;
			data?: { identity?: { version?: string }; capabilities?: RustWireCapabilities };
		};
		if (
			parsed.type !== "ready" ||
			parsed.data?.identity?.version !== RUST_WIRE_PROTOCOL_VERSION ||
			!parsed.data.capabilities
		) {
			return { reachable: false, error: "unexpected_reply_schema" };
		}
		return {
			reachable: true,
			protocolVersion: RUST_WIRE_PROTOCOL_VERSION,
			capabilities: parsed.data.capabilities,
		};
	} catch {
		return { reachable: false, error: "invalid_json_reply" };
	}
}

/**
 * Select Node or Rust core runtime with mandatory four-domain parity gating and fail-safe Node rollback.
 */
export function resolveCoreRuntimeSelection(input: {
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly binaryPath?: string;
	readonly parity: RustCoreParityChecklist;
	readonly probe?: (binaryPath: string) => RustWireProbeResult;
}): CoreRuntimeSelection {
	const raw = (input.env?.OMK_CORE_RUNTIME ?? "node").trim().toLowerCase();
	if (raw !== "rust") {
		return {
			requested: "node",
			active: "node",
			rolledBackToNode: false,
			...(raw === "node" && input.env?.OMK_CORE_RUNTIME !== undefined
				? { rollbackReason: "operator_forced_node" }
				: {}),
		};
	}

	const missingParity = (Object.entries(input.parity) as [keyof RustCoreParityChecklist, boolean][])
		.filter(([, ok]) => !ok)
		.map(([domain]) => domain);
	if (missingParity.length > 0) {
		return {
			requested: "rust",
			active: "node",
			rolledBackToNode: true,
			rollbackReason: `parity_incomplete:${missingParity.join(",")}`,
		};
	}

	const probe = (input.probe ?? probeRustRuntimeWire)(input.binaryPath ?? "");
	if (!probe.reachable) {
		return {
			requested: "rust",
			active: "node",
			rolledBackToNode: true,
			rollbackReason: `rust_probe_failed:${probe.error}`,
			rustProbe: probe,
		};
	}

	return {
		requested: "rust",
		active: "rust",
		rolledBackToNode: false,
		rustProbe: probe,
	};
}

/** Honest current runtime parity across the four core domains. */
export const DEFAULT_RUST_CORE_PARITY: RustCoreParityChecklist = Object.freeze({
	provider: true,
	tool: true,
	session: false,
	recovery: false,
});

export interface StandaloneBinaryCompletionCriteria {
	readonly metadataEmbedded: boolean;
	readonly themesBootstrapped: boolean;
	readonly zeroExternalJsRuntime: boolean;
	readonly cliSubcommandsVerified: readonly string[];
	readonly jsonModeVerified: boolean;
	readonly ptyInteractiveVerified: boolean;
}

export interface ReadinessEvaluation {
	readonly goal: "standalone_binary" | "rust_core_transition";
	readonly complete: boolean;
	readonly missing: readonly string[];
}

const REQUIRED_STANDALONE_SUBCOMMANDS = ["version", "help", "doctor", "stats", "list-models", "print"] as const;

/** Completion gate for Goal A: standalone single-file executable distribution (independent of Rust transition). */
export function evaluateStandaloneBinaryReadiness(criteria: StandaloneBinaryCompletionCriteria): ReadinessEvaluation {
	const missing: string[] = [];
	if (!criteria.metadataEmbedded) missing.push("metadataEmbedded");
	if (!criteria.themesBootstrapped) missing.push("themesBootstrapped");
	if (!criteria.zeroExternalJsRuntime) missing.push("zeroExternalJsRuntime");
	const verified = new Set(criteria.cliSubcommandsVerified);
	for (const cmd of REQUIRED_STANDALONE_SUBCOMMANDS) {
		if (!verified.has(cmd)) missing.push(`cliSubcommand:${cmd}`);
	}
	if (!criteria.jsonModeVerified) missing.push("jsonModeVerified");
	if (!criteria.ptyInteractiveVerified) missing.push("ptyInteractiveVerified");
	return { goal: "standalone_binary", complete: missing.length === 0, missing };
}

export interface RustCoreTransitionCriteria {
	readonly wireHandshakeReachable: boolean;
	readonly providerParity: boolean;
	readonly toolParity: boolean;
	readonly sessionParity: boolean;
	readonly recoveryParity: boolean;
	readonly entryPointWired: boolean;
	readonly failSafeNodeRollbackVerified: boolean;
}

/** Completion gate for Goal B: Rust core runtime transition (independent of standalone binary packaging). */
export function evaluateRustCoreTransitionReadiness(criteria: RustCoreTransitionCriteria): ReadinessEvaluation {
	const missing: string[] = [];
	for (const [key, ok] of Object.entries(criteria) as [keyof RustCoreTransitionCriteria, boolean][]) {
		if (!ok) missing.push(key);
	}
	return { goal: "rust_core_transition", complete: missing.length === 0, missing };
}

let activeCoreRuntimeSelection: CoreRuntimeSelection = Object.freeze({
	requested: "node",
	active: "node",
	rolledBackToNode: false,
});

/** Wired into main.ts startup so OMK_CORE_RUNTIME is evaluated at the real CLI entry point. */
export function selectCoreRuntimeAtStartup(
	env: Readonly<Record<string, string | undefined>> = process.env,
	options?: {
		readonly binaryPath?: string;
		readonly parity?: RustCoreParityChecklist;
		readonly onRollbackWarning?: (message: string) => void;
	},
): CoreRuntimeSelection {
	const selection = resolveCoreRuntimeSelection({
		env,
		binaryPath: options?.binaryPath ?? env.OMK_RUST_WIRE_BIN ?? "",
		parity: options?.parity ?? DEFAULT_RUST_CORE_PARITY,
	});
	activeCoreRuntimeSelection = Object.freeze(selection);
	if (selection.rolledBackToNode && options?.onRollbackWarning) {
		options.onRollbackWarning(
			`OMK_CORE_RUNTIME=rust rolled back to node runtime (${selection.rollbackReason ?? "unavailable"}).`,
		);
	}
	return activeCoreRuntimeSelection;
}

export function getActiveCoreRuntimeSelection(): CoreRuntimeSelection {
	return activeCoreRuntimeSelection;
}
