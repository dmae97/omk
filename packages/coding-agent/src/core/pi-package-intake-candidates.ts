import type { CandidatePackageInput, SourceText } from "./package-procurement.ts";

export type PiPackageLane =
	| "mcp"
	| "lens"
	| "browser"
	| "subagent"
	| "footer"
	| "todo"
	| "memory"
	| "safety"
	| "context-opt"
	| "goal"
	| "code-search"
	| "observability"
	| "actor"
	| "interactive-ui"
	| "side-channel"
	| "review";

export type PiPackagePortMode = "omk-native" | "reference" | "measurement-gated";

export interface PiPackagePortCandidate {
	readonly id: string;
	readonly lane: PiPackageLane;
	readonly laneLabel: string;
	readonly portMode: PiPackagePortMode;
	readonly piOrigins: readonly string[];
	readonly candidate: CandidatePackageInput;
}

export interface PiPackageCandidateReviewInput {
	readonly candidateId: string;
	readonly declaredLicense?: string;
	readonly packageJsonScripts?: Record<string, string>;
	readonly reviewedScriptAllowlist?: string[];
	readonly sources?: SourceText[];
	readonly transitiveLicenses?: string[];
}

const P0_SYNTHETIC_PIN = "0.0.0-p0.0";
const P1_SYNTHETIC_PIN = "0.0.0-p1.0";

/**
 * P1 batch: sourced from a full crawl of pi.dev/packages (94 pages, 4653 unique
 * packages, crawled 2026-07-01), cross-referenced against the P0 lanes above to avoid
 * duplicates, then filtered to the highest-download, most clearly-scoped package per
 * new capability lane. None of these have had a source-level compatibility/capability
 * scan run yet (no `sources` supplied here) - that is why every one of them uses a
 * conservative `intendedUse` (`reference`, `measurement-gated`, or `report-only`, never
 * `native` or `permanent-adopt`) until a real review supplies `sources`/`declaredLicense`
 * for the actual npm package content. See
 * `.omk/runs/pi-package-catalog-20260701/` for the full crawled catalog and per-lane
 * shortlist this batch was drawn from.
 */
export const P1_PI_PACKAGE_PORT_CANDIDATES: readonly PiPackagePortCandidate[] = [
	{
		id: "pi-hermes-memory",
		lane: "memory",
		laneLabel: "memory",
		portMode: "reference",
		piOrigins: ["pi-hermes-memory"],
		candidate: {
			name: "pi-hermes-memory",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "reference",
			declaredUse: "memory",
			expectedResources: ["extension", "skill"],
			policyOverlay: { declaredUse: "memory", activateAlongsideScheduler: false },
		},
	},
	{
		id: "cc-safety-net",
		lane: "safety",
		laneLabel: "safety",
		portMode: "reference",
		piOrigins: ["cc-safety-net"],
		candidate: {
			name: "cc-safety-net",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "reference",
			declaredUse: "workflow-reference",
			expectedResources: ["extension"],
			policyOverlay: { declaredUse: "workflow-reference", activateAlongsideScheduler: false },
		},
	},
	{
		id: "pi-lean-ctx",
		lane: "context-opt",
		laneLabel: "context-opt",
		portMode: "measurement-gated",
		piOrigins: ["pi-lean-ctx"],
		candidate: {
			name: "pi-lean-ctx",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "measurement-gated",
			declaredUse: "cache-perf",
			expectedResources: ["extension", "tool"],
			// Same underlying lean-ctx engine as the currently-disabled `lean-ctx` OMK MCP
			// server (unstable stdio connection, see prior session diagnosis). Measurement
			// must directly compare this extension path's stability against that known
			// failure mode before any native/permanent adoption is considered.
			metrics: ["session-cache-hit-rate", "stdio-connection-stability", "token-cost-per-reread"],
		},
	},
	{
		id: "pi-codex-goal",
		lane: "goal",
		laneLabel: "goal",
		portMode: "reference",
		piOrigins: ["pi-codex-goal"],
		candidate: {
			name: "pi-codex-goal",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "reference",
			declaredUse: "workflow-reference",
			expectedResources: ["extension"],
			// OMK already has native goal tracking (omk_orchestrate_goal / Ouroboros);
			// reference-only to compare UX patterns, not a functional gap.
			policyOverlay: { declaredUse: "workflow-reference", activateAlongsideScheduler: false },
		},
	},
	{
		id: "pi-readseek",
		lane: "code-search",
		laneLabel: "code-search",
		portMode: "measurement-gated",
		piOrigins: ["pi-readseek"],
		candidate: {
			name: "pi-readseek",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "measurement-gated",
			declaredUse: "quality",
			expectedResources: ["extension", "tool"],
			metrics: ["hash-anchor-edit-success-rate", "structural-search-latency"],
		},
	},
	{
		id: "braintrust-pi-extension",
		lane: "observability",
		laneLabel: "observability",
		portMode: "reference",
		piOrigins: ["@braintrust/pi-extension"],
		candidate: {
			name: "@braintrust/pi-extension",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "advisory",
			declaredUse: "observability",
			expectedResources: ["extension"],
			// Third-party telemetry (matches package-procurement.ts's `telemetry` capability
			// rule verbatim - the pattern literally includes `@braintrust`). Must land as
			// report-only/advisory with a strict export policy, never a default-on data path.
			policyOverlay: {
				declaredUse: "observability",
				exportPolicy: { defaultOff: true, offlineDisables: true, denyRawPrompt: true, denyRawToolOutput: true },
			},
		},
	},
	{
		id: "llblab-pi-actors",
		lane: "actor",
		laneLabel: "actor",
		portMode: "reference",
		piOrigins: ["@llblab/pi-actors"],
		candidate: {
			name: "@llblab/pi-actors",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "reference",
			declaredUse: "workflow-reference",
			expectedResources: ["extension"],
			// OMK already has the subagent tool + AdaptOrch WPL for orchestration;
			// reference-only pattern comparison for a local actor-kernel model.
			policyOverlay: { declaredUse: "workflow-reference", activateAlongsideScheduler: false },
		},
	},
	{
		id: "pi-ask-user",
		lane: "interactive-ui",
		laneLabel: "interactive-ui",
		portMode: "measurement-gated",
		piOrigins: ["pi-ask-user"],
		candidate: {
			name: "pi-ask-user",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "measurement-gated",
			declaredUse: "quality",
			expectedResources: ["extension", "tool"],
			metrics: ["clarification-round-trip-count", "selection-ui-render-latency"],
		},
	},
	{
		id: "rpiv-btw",
		lane: "side-channel",
		laneLabel: "side-channel",
		portMode: "measurement-gated",
		piOrigins: ["@juicesharp/rpiv-btw"],
		candidate: {
			name: "@juicesharp/rpiv-btw",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "measurement-gated",
			declaredUse: "workflow-reference" as const,
			expectedResources: ["extension"],
			metrics: ["main-transcript-pollution-delta", "side-question-latency"],
		},
	},
	{
		id: "pi-simplify",
		lane: "review",
		laneLabel: "review",
		portMode: "reference",
		piOrigins: ["pi-simplify"],
		candidate: {
			name: "pi-simplify",
			exactVersion: P1_SYNTHETIC_PIN,
			intendedUse: "report-only",
			declaredUse: "quality",
			expectedResources: ["extension"],
			// Review/advisory tool - decision matrix routes declaredUse "quality" to
			// report-only and denies it if it also claims filesystem-write/child-process
			// capabilities, which is exactly the right default for an unreviewed
			// code-review extension.
		},
	},
];

export const P0_PI_PACKAGE_PORT_CANDIDATES: readonly PiPackagePortCandidate[] = [
	{
		id: "pi-mcp-adapter",
		lane: "mcp",
		laneLabel: "MCP",
		portMode: "omk-native",
		piOrigins: ["pi-mcp-adapter"],
		candidate: {
			name: "pi-mcp-adapter",
			exactVersion: P0_SYNTHETIC_PIN,
			intendedUse: "native",
			declaredUse: "loadout",
			expectedResources: ["extension", "tool"],
			nativeSpec: {
				exists: true,
				trackId: "mcp-adapter",
				specPath: "packages/coding-agent/src/core/mcp-presets.ts",
			},
			metrics: ["mcp-server-discovery", "tool-registration-parity"],
		},
	},
	{
		id: "pi-lens",
		lane: "lens",
		laneLabel: "lens",
		portMode: "measurement-gated",
		piOrigins: ["pi-lens"],
		candidate: {
			name: "pi-lens",
			exactVersion: P0_SYNTHETIC_PIN,
			intendedUse: "measurement-gated",
			declaredUse: "observability",
			expectedResources: ["extension"],
			metrics: ["lens-render-latency", "context-signal-coverage"],
		},
	},
	{
		id: "pi-agent-browser-native",
		lane: "browser",
		laneLabel: "browser",
		portMode: "omk-native",
		piOrigins: ["pi-agent-browser-native", "pi-browse"],
		candidate: {
			name: "pi-agent-browser-native",
			exactVersion: P0_SYNTHETIC_PIN,
			intendedUse: "native",
			declaredUse: "loadout",
			expectedResources: ["tool"],
			nativeSpec: {
				exists: true,
				trackId: "agent-browser-native",
				specPath: "packages/coding-agent/src/core/browser-use.ts",
			},
			metrics: ["browser-action-success-rate", "browser-session-isolation"],
		},
	},
	{
		id: "pi-subagents",
		lane: "subagent",
		laneLabel: "subagent",
		portMode: "reference",
		piOrigins: ["pi-subagents"],
		candidate: {
			name: "pi-subagents",
			exactVersion: P0_SYNTHETIC_PIN,
			intendedUse: "reference",
			declaredUse: "workflow-reference",
			expectedResources: ["extension", "skill"],
			policyOverlay: { declaredUse: "workflow-reference", activateAlongsideScheduler: false },
		},
	},
	{
		id: "pi-powerline-footer",
		lane: "footer",
		laneLabel: "footer",
		portMode: "omk-native",
		piOrigins: ["pi-footer", "pi-powerline-footer"],
		candidate: {
			name: "pi-powerline-footer",
			exactVersion: P0_SYNTHETIC_PIN,
			intendedUse: "native",
			declaredUse: "observability",
			expectedResources: ["theme", "extension"],
			nativeSpec: {
				exists: true,
				trackId: "powerline-footer",
				specPath: "packages/coding-agent/src/core/footer-data-provider.ts",
			},
			metrics: ["footer-width-stability", "footer-render-latency"],
		},
	},
	{
		id: "pi-long-task",
		lane: "todo",
		laneLabel: "todo",
		portMode: "measurement-gated",
		piOrigins: ["pi-long-task"],
		candidate: {
			name: "pi-long-task",
			exactVersion: P0_SYNTHETIC_PIN,
			intendedUse: "measurement-gated",
			declaredUse: "checkpoint",
			expectedResources: ["extension"],
			metrics: ["long-task-resume-rate", "todo-state-parity"],
		},
	},
];
