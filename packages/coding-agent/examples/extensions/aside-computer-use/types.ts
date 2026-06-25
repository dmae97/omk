/**
 * Shared types for the OMK ↔ Aside computer-use bridge.
 *
 * Aside is a Chromium-based browser agent that exposes a CLI, an MCP server
 * (`aside mcp`), and a deterministic REPL (`aside repl`). This extension does
 * NOT speak raw CDP; it talks to `aside mcp` over JSON-RPC stdio and gates every
 * browser action through an OMK-owned policy, risk classifier, and approval gate.
 *
 * Erasable TypeScript only (no enum / namespace / parameter properties).
 */

/** Risk band for a browser action. */
export type RiskLevel = "R0" | "R1" | "R2" | "R3";

/**
 * R0 — read-only observation (navigate, read text, screenshot, DOM inspection).
 * R1 — reversible local interaction (open tab, type a draft, change a filter).
 * R2 — external mutation (submit, send, publish, create issue, change permission).
 * R3 — critical mutation (payment, account deletion, security setting, credential linking).
 */

/** Aside permission mode (Aside's own model; OMK applies a parallel policy). */
export type AsideMode = "readonly" | "guard" | "full";

/** High-level browser action the controller reasons about. */
export interface BrowserAction {
	/** Facade verb, e.g. open_page, read_text, click_locator, fill_form, submit. */
	readonly kind: string;
	/** Target URL if known; may be empty for in-page actions. */
	readonly url?: string;
	/** Free-text description for audit/approval prompts. */
	readonly description: string;
	/** Underlying MCP tool name to delegate to (resolved by the adapter). */
	readonly asideTool?: string;
	/** Arguments to pass to the underlying MCP tool. */
	readonly asideArgs?: Readonly<Record<string, unknown>>;
}

/** Selection confidence emitted by deterministic action-candidate scoring. */
export type ActionScoringConfidence = "selected" | "inspection_required";

/** Planner-proposed browser action plus bounded evidence/risk scoring inputs. */
export interface PlannedActionCandidate {
	readonly action: BrowserAction;
	readonly risk: RiskLevel;
	readonly goalProgress: number;
	readonly observationSupport: number;
	readonly selectorCertainty: number;
	readonly policyFit: number;
	readonly reversibility: number;
	readonly toolReliability: number;
	readonly evidenceGain: number;
	readonly ambiguityPenalty?: number;
	readonly repeatPenalty?: number;
	readonly riskPenalty?: number;
}

/** An observation snapshot returned by Aside; ALWAYS untrusted web content. */
export interface Observation {
	readonly url: string;
	readonly title?: string;
	readonly text?: string;
	readonly dom?: ReadonlyArray<{ selector: string; value: string }>;
}

/** A single piece of verifiable evidence for completion. */
export interface Evidence {
	readonly type: "dom_text" | "screenshot" | "url" | "file" | "console" | "log";
	readonly value?: string;
	readonly path?: string;
	readonly sha256?: string;
	readonly source?: string;
}

/** A success predicate from the user goal; completion is evidence-gated. */
export interface SuccessCriterion {
	readonly id: string;
	readonly description: string;
}

/** Deterministic assertion categories derived from success criteria. */
export type AssertionKind =
	| "element_value"
	| "element_visible"
	| "url"
	| "title"
	| "text"
	| "negative_text_absent"
	| "token_overlap";

/** A typed, verifiable success assertion. */
export interface SuccessAssertion {
	readonly id: string;
	readonly kind: AssertionKind;
	readonly description: string;
	readonly required: boolean;
	readonly confidence: number;
	readonly target?: string;
	readonly expected?: string;
	readonly tokens?: readonly string[];
}

/** Verification status for assertions and assertion batches. */
export type AssertionVerificationStatus = "pass" | "fail" | "inconclusive";

/** Verification result for one assertion. */
export interface AssertionVerification {
	readonly assertion: SuccessAssertion;
	readonly status: AssertionVerificationStatus;
	readonly confidence: number;
	readonly reason: string;
	readonly matchedValue?: string;
}

/** Verification result for a batch of assertions. */
export interface AssertionVerificationSummary {
	readonly status: AssertionVerificationStatus;
	readonly confidence: number;
	readonly assertions: readonly AssertionVerification[];
}

/** Stable summary of an element observed in Aside output. */
export interface ElementSummary {
	readonly selector: string;
	readonly value: string;
	readonly fingerprint: string;
}

/** Deterministic quality signals for an observation snapshot. */
export interface ObservationSnapshotQuality {
	readonly parse: number;
	readonly freshness: number;
	readonly elementCoverage: number;
	readonly evidenceCoverage: number;
}

/** Deterministic snapshot of an Aside observation. */
export interface ObservationSnapshot {
	readonly id: string;
	readonly fingerprint: string;
	readonly url: string;
	readonly title?: string;
	readonly textDigest: string;
	readonly textLength: number;
	readonly elements: readonly ElementSummary[];
	readonly quality: ObservationSnapshotQuality;
}

/** External side effect an action may have produced. */
export interface SideEffect {
	readonly kind: string;
	readonly target: string;
	readonly description: string;
	readonly confirmed: boolean;
}

/** Authorization verdict for one action. */
export type AuthorizationDecision = "allow" | "approve" | "deny";

export interface Authorization {
	readonly decision: AuthorizationDecision;
	readonly reason: string;
	readonly risk: RiskLevel;
	readonly targetOrigin?: string;
}

/** Final task result. */
export type TaskStatus = "completed" | "blocked" | "failed" | "inspection_required" | "denied" | "max_steps_exceeded";

export interface TaskResult {
	readonly status: TaskStatus;
	readonly sessionId?: string;
	readonly finalUrl?: string;
	readonly summary: string;
	readonly evidence: readonly Evidence[];
	readonly sideEffects: readonly SideEffect[];
	readonly uncertainties: readonly string[];
	readonly stepsTaken: number;
}

/** MCP tool descriptor as returned by `tools/list`. */
export interface McpTool {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** MCP tool call result envelope. */
export interface McpCallResult {
	readonly content: ReadonlyArray<{ type: string; text?: string; data?: string; mimeType?: string }>;
	readonly isError?: boolean;
}

/** Observer port injected into the controller (mockable for tests). */
export interface BrowserClient {
	observe(): Promise<Observation>;
	execute(action: BrowserAction): Promise<{ ok: boolean; raw: McpCallResult; sideEffectKind?: string }>;
	listTools(): Promise<readonly McpTool[]>;
	close(): Promise<void>;
}

/** Approval port injected into the controller (UI in prod, stub in tests). */
export type Approver = (action: BrowserAction, risk: RiskLevel, origin?: string) => Promise<boolean>;

/** Planner port: given goal + latest observation, choose the next action or signal done. */
export interface Planner {
	nextAction(
		goal: string,
		observation: Observation,
		evidence: readonly Evidence[],
	): Promise<{
		readonly action?: BrowserAction;
		readonly candidates?: readonly PlannedActionCandidate[];
		readonly done?: boolean;
		readonly note?: string;
	}>;
}
