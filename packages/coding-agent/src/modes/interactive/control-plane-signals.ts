import type { ContextUsage } from "../../core/extensions/types.ts";
import type { ResourceGovernorSettings } from "../../core/resource-governor-settings.ts";
import { resolveResourceGovernorSettings } from "../../core/resource-governor-settings.ts";
import type { ControlPlaneSignals, TerminationSignal } from "./control-plane-view-model.ts";

/** Narrow structural port; `AgentSession` satisfies it without casts. */
export interface ControlPlaneSessionPort {
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	readonly isRetrying: boolean;
	readonly pendingMessageCount: number;
	readonly lastTermination: TerminationSignal | undefined;
	readonly autoCompactionEnabled: boolean;
	getContextUsage(): ContextUsage | undefined;
	readonly settingsManager: { getResourceGovernorSettings(): ResourceGovernorSettings };
}
export interface ControlPlaneMetricsPort {
	getSystemCpuPercent(): number | null;
	getMemoryRssBytes(): number | null;
}

/**
 * Single adapter from the live runtime to view-model signals. Reads each source once.
 * Governor mode and busy threshold come from the fail-closed resolver, so invalid settings
 * (and the operator env override) resolve exactly as the governor itself resolves them.
 */
export function readControlPlaneSignals(
	session: ControlPlaneSessionPort,
	metrics?: ControlPlaneMetricsPort,
	fallbackContextWindow?: number,
): ControlPlaneSignals {
	const usage = session.getContextUsage();
	const governor = resolveResourceGovernorSettings(session.settingsManager.getResourceGovernorSettings());
	return {
		isStreaming: session.isStreaming,
		isCompacting: session.isCompacting,
		isRetrying: session.isRetrying,
		pendingMessageCount: session.pendingMessageCount,
		lastTermination: session.lastTermination,
		// No interactive evidence source exists yet, so VERIFY stays "unverified".
		evidence: undefined,
		contextPercent: usage?.percent ?? null,
		contextWindowTokens: usage?.contextWindow ?? fallbackContextWindow ?? 0,
		autoCompactEnabled: session.autoCompactionEnabled,
		governorMode: governor.mode,
		busyCpuPercent: governor.admission.thresholds.busyCpuPercent,
		systemCpuPercent: metrics?.getSystemCpuPercent() ?? null,
		memoryRssBytes: metrics?.getMemoryRssBytes() ?? null,
	};
}
