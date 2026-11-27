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
