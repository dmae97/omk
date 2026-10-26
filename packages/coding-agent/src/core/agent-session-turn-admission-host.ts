/**
 * Turn-admission host for `AgentSession`, moved verbatim out of the constructor
 * (specs/agent-session-split, PR 1). Spec 104 phase 2 attaches the
 * `requiredTools` callback here.
 */
import type { Agent, AgentMessage } from "omk-agent-core";
import { type Api, type Model, registerSessionResourceCleanup } from "omk-ai";
import { getCompactionUsageBoundary } from "./compaction-entry-time.ts";
import type { EventBus } from "./event-bus.ts";
import type { ExtensionRunner } from "./extensions/runner.ts";
import { isRequiredToolsEnabled, type RequiredToolContract } from "./required-tools.ts";
import { onRequiredToolContract, reportRequiredCapability } from "./required-tools-channel.ts";
import type { SessionManager } from "./session-manager.ts";
import { getLatestCompactionEntry } from "./session-manager.ts";
import type { SessionRunBudget } from "./session-run-budget.ts";
import { SessionTurnAdmission } from "./session-turn-admission.ts";
import type { SettingsManager } from "./settings-manager.ts";
import { mcpToolGroup } from "./tool-schema-budget.ts";

/** The `AgentSession` members the admission host reads, all read lazily at call time. */
export interface TurnAdmissionSession {
	readonly sessionId: string;
	readonly model: Model<Api> | undefined;
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;
	readonly _mcpToolNames: ReadonlySet<string>;
	readonly _runBudget: SessionRunBudget;
	readonly _extensionRunner: ExtensionRunner;
	readonly _resourceLoader: { getEventBus?(): EventBus };
	_effectiveTurnContextWindow(pendingMessages: AgentMessage[], sessionWindow: number): number;
	_runThresholdCompaction(emergency: boolean): Promise<boolean>;
}

/** Supplies the current task segment's required-tool contract (spec 104 v1: the approved acceptance contract). */
export type RequiredToolSource = () => RequiredToolContract | undefined;

/**
 * Spec 104 phase 2: trusted host-side sources, keyed by session. Kept off `AgentSession`'s public
 * surface and out of extension reach; consulted only with `OMK_REQUIRED_TOOLS` on. A WeakMap, so a
 * disposed and unreferenced session never retains its source (AgentSession has no dispose hook
 * this module can join without growing agent-session.ts; the producer clears with `undefined`).
 * Keyed by `object`, not `AgentSession`: even a type import of agent-session.ts is an import cycle.
 */
const requiredToolSources = new WeakMap<object, RequiredToolSource>();
/** Spec 104: the contract-listener release of each installed session (one listener per session). */
const contractListeners = new WeakMap<object, () => void>();

/** Set (or clear with `undefined`) the required-tool source of `session`; read at every fit. */
export function setRequiredToolSource(session: object, source: RequiredToolSource | undefined): void {
	if (source) requiredToolSources.set(session, source);
	else requiredToolSources.delete(session);
}

export function installTurnAdmission(session: TurnAdmissionSession): SessionTurnAdmission {
	// One tool selection serves admission and the admitted run: MCP servers the model's input
	// budget cannot carry are withheld per request, never removed from the active tool set.
	// Spec 104 phase 3: with the flag off no bus listener exists and requests are unchanged.
	const bus = isRequiredToolsEnabled() ? session._resourceLoader.getEventBus?.() : undefined;
	contractListeners.get(session)?.();
	const turnAdmission = new SessionTurnAdmission({
		model: () => session.model,
		state: () => session.agent.state,
		contextWindow: (pending, window) => session._effectiveTurnContextWindow([...pending], window),
		compactionSettings: () => session.settingsManager.getCompactionSettings(),
		latestCompactionTimestamp: () => getLatestCompactionEntry(session.sessionManager.getBranch())?.timestamp,
		compactionUsageBoundary: () => getCompactionUsageBoundary(session.sessionManager.getBranch()),
		toolGroup: (name) => (session._mcpToolNames.has(name) ? mcpToolGroup(name) : undefined),
		compact: async () => {
			await session._runThresholdCompaction(true);
			session._runBudget.assertActive();
		},
		notify: (message) => session._extensionRunner.getUIContext().notify(message, "warning"),
		// Spec 104: ignored unless OMK_REQUIRED_TOOLS is on (SessionTurnAdmission checks the flag first).
		requiredTools: () => requiredToolSources.get(session)?.(),
		onRequiredCapabilityUnavailable: (error) =>
			bus &&
			reportRequiredCapability(bus, {
				state: "missing",
				taskSegmentId: error.taskSegmentId,
				missing: error.missing,
				kind: error.kind,
			}),
	});
	if (!bus) {
		session.agent.prepareTools = (tools, pending) => turnAdmission.fitTools(tools, pending);
		return turnAdmission;
	}
	// The bus may outlive the session; a WeakRef keeps the listener from retaining it.
	const ref = new WeakRef(session);
	const unsubscribe = onRequiredToolContract(bus, (contract) => {
		const target = ref.deref();
		if (target) setRequiredToolSource(target, contract && (() => contract));
		else release();
	});
	// Released on session dispose (`cleanupSessionResources` runs after the run budget closes)
	// and on re-install, so a long-lived bus never accumulates dead listeners.
	const unregister = registerSessionResourceCleanup((sessionId) => {
		const target = ref.deref();
		if (!target || (target._runBudget.closed && sessionId === target.sessionId)) release();
	});
	// Reads the session only through `ref`: the global cleanup set must not retain it.
	function release(): void {
		unsubscribe();
		unregister();
		const target = ref.deref();
		if (target && contractListeners.get(target) === release) contractListeners.delete(target);
	}
	contractListeners.set(session, release);
	session.agent.prepareTools = (tools, pending) => {
		const fitted = turnAdmission.fitTools(tools, pending);
		const contract = requiredToolSources.get(session)?.();
		if (contract && contract.tools.size > 0 && isRequiredToolsEnabled()) {
			reportRequiredCapability(bus, {
				state: "present",
				taskSegmentId: contract.taskSegmentId,
				requiredCount: contract.tools.size,
			});
		}
		return fitted;
	};
	return turnAdmission;
}
