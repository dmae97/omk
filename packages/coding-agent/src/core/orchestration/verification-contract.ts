/**
 * Pure VerificationContract evaluation helpers.
 *
 * These functions evaluate a verification contract against already-captured
 * evidence (command receipts, passed gate ids, agent contexts). They perform NO
 * real command execution, NO filesystem access, and NO network calls — every
 * input is passed in by the caller. This keeps them deterministic, fast, and
 * safe to run inside any lane without write/execute scope.
 *
 * The shapes here are a focused, machine-verifiable subset of the orchestration
 * verification contract (see `.omk/runs/omk-orchestration-upgrade-plan/
 * verification-contract.md`). Downstream lanes add the executor (spawning,
 * hashing, globbing) on top of these pure evaluators.
 */

/** Where an {@link OutputMatcher} should look for its pattern. */
export type OutputSource = "stdout" | "stderr" | "combined";

/** Match predicates supported by {@link evaluateOutputMatchers}. */
export type OutputPredicate = "includes" | "regex" | "not-includes";

/**
 * A serializable matcher over a captured command stream.
 *
 * - `includes`     : the stream must contain `value` as a substring.
 * - `regex`        : the stream must match the RegExp built from `value`.
 * - `not-includes` : the stream must NOT contain `value` as a substring.
 */
export interface OutputMatcher {
	readonly source: OutputSource;
	readonly predicate: OutputPredicate;
	readonly value: string;
}

/** Optional exit-code constraint for a {@link CommandGate}. */
export type ExpectedExitCode = number | { readonly min: number; readonly max: number };

/**
 * A single executable gate inside a verification contract. The gate itself is
 * data only; {@link evaluateCommandGate} evaluates it against a receipt.
 */
export interface CommandGate {
	readonly id: string;
	readonly cmd: string;
	readonly args?: readonly string[];
	/** Exact code or inclusive range. Omit to skip the exit-code constraint. */
	readonly expectedExitCode?: ExpectedExitCode;
	readonly matchers?: readonly OutputMatcher[];
	readonly timeoutMs: number;
}

/**
 * Captured output of an already-executed command. `combined` defaults to
 * `stdout + stderr` when omitted so matchers that select `combined` still work.
 */
export interface CommandReceipt {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly combined?: string;
}

/**
 * An artifact existence/hash/size requirement. (Type shape only — artifact
 * verification touches the filesystem and is implemented by the executor lane.)
 */
export interface ArtifactRule {
	readonly id: string;
	readonly pathGlob: string;
	readonly mustExist: boolean;
	readonly expectedHash?: string;
	readonly sizeBytes?: { readonly min?: number; readonly max?: number };
	readonly containment?: "file" | "directory" | "any";
}

/** Supported test frameworks for a {@link TestSelector}. */
export type TestFramework = "vitest" | "jest" | "pytest" | "go";

/**
 * A test-suite selector. (Type shape only — running and parsing test output is
 * implemented by the executor lane.)
 */
export interface TestSelector {
	readonly id: string;
	readonly framework: TestFramework;
	readonly fileOrPattern: string;
	readonly expectedResult?: {
		readonly passed?: number;
		readonly failed?: number;
		readonly skipped?: number;
	};
	readonly timeoutMs: number;
}

/**
 * How gate results are aggregated into a single pass/fail.
 *
 * - `all`    : every gate must pass (and there must be at least one gate).
 * - `quorum` : at least `requiredPasses` gates must pass.
 */
export type EvidencePolicy = { readonly mode: "all" } | { readonly mode: "quorum"; readonly requiredPasses: number };

/** The kind of gate a {@link VerificationGateResult} summarizes. */
export type GateKind = "command" | "artifact" | "test";

/** Result of evaluating a single gate. */
export interface VerificationGateResult {
	readonly id: string;
	readonly kind: GateKind;
	readonly pass: boolean;
	readonly exitCode?: number;
	readonly matcherFailures?: readonly string[];
	readonly errors?: readonly string[];
}

/** Top-level verification outcome after aggregation and policy checks. */
export interface VerificationResult {
	readonly pass: boolean;
	readonly evidencePolicy: EvidencePolicy;
	readonly gates: readonly VerificationGateResult[];
	readonly traceabilityOk: boolean;
	readonly independenceOk: boolean;
	readonly errorSummary?: string;
}

/**
 * Maps a requirement to the gate ids that prove it. `minPassingGates` defaults
 * to 1 when omitted.
 */
export interface RequirementLink {
	readonly requirementId: string;
	readonly gateIds: readonly string[];
	readonly minPassingGates?: number;
}

/** Identity of an executor or reviewer agent for independence checks. */
export interface AgentContext {
	readonly modelId: string;
	readonly contextId: string;
	/** Reviewer-only: declares the reviewer ran in a freshly created context. */
	readonly freshContext?: boolean;
}

/** Streams available to matchers. */
export interface CommandOutputs {
	readonly stdout: string;
	readonly stderr: string;
	readonly combined?: string;
}

/** Outcome of {@link evaluateOutputMatchers}. */
export interface MatcherEvaluation {
	readonly pass: boolean;
	readonly failures: readonly string[];
}

/** Outcome of {@link aggregateGateResults}. */
export interface AggregationEvaluation {
	readonly pass: boolean;
	readonly passedCount: number;
}

/** Outcome of {@link verifyTraceability}. */
export interface TraceabilityEvaluation {
	readonly pass: boolean;
	readonly failures: readonly string[];
}

function selectStream(outputs: CommandOutputs, source: OutputSource): string {
	if (source === "stdout") return outputs.stdout;
	if (source === "stderr") return outputs.stderr;
	// `combined` defaults to stdout + stderr so callers can omit it.
	return outputs.combined ?? `${outputs.stdout}${outputs.stderr}`;
}

function describeMatcher(matcher: OutputMatcher): string {
	return `${matcher.source}/${matcher.predicate}=${JSON.stringify(matcher.value)}`;
}

/**
 * Evaluate a list of {@link OutputMatcher}s against captured command streams.
 * All matchers must pass. Invalid regex is treated as a failure (never thrown).
 */
export function evaluateOutputMatchers(outputs: CommandOutputs, matchers: readonly OutputMatcher[]): MatcherEvaluation {
	const failures: string[] = [];
	for (const matcher of matchers) {
		const stream = selectStream(outputs, matcher.source);
		let ok: boolean;
		if (matcher.predicate === "includes") {
			ok = stream.includes(matcher.value);
		} else if (matcher.predicate === "not-includes") {
			ok = !stream.includes(matcher.value);
		} else {
			// regex: a malformed pattern is a failed matcher, not a crash.
			try {
				ok = new RegExp(matcher.value).test(stream);
			} catch {
				failures.push(`invalid regex for ${describeMatcher(matcher)}`);
				continue;
			}
		}
		if (!ok) {
			failures.push(`matcher failed: ${describeMatcher(matcher)}`);
		}
	}
	return { pass: failures.length === 0, failures };
}

function evaluateExitCode(expected: ExpectedExitCode | undefined, exitCode: number): boolean {
	if (expected === undefined) return true;
	if (typeof expected === "number") return exitCode === expected;
	return exitCode >= expected.min && exitCode <= expected.max;
}

/**
 * Evaluate a {@link CommandGate} against an executed-command receipt. The gate
 * passes when the exit code satisfies `expectedExitCode` (if set) AND every
 * matcher passes. No execution happens here.
 */
export function evaluateCommandGate(gate: CommandGate, receipt: CommandReceipt): VerificationGateResult {
	const errors: string[] = [];
	const exitOk = evaluateExitCode(gate.expectedExitCode, receipt.exitCode);
	if (!exitOk) {
		errors.push(`exit code ${receipt.exitCode} did not satisfy ${JSON.stringify(gate.expectedExitCode)}`);
	}
	const matcherResult = evaluateOutputMatchers(receipt, gate.matchers ?? []);
	const pass = exitOk && matcherResult.pass;
	return {
		id: gate.id,
		kind: "command",
		pass,
		exitCode: receipt.exitCode,
		...(matcherResult.failures.length > 0 ? { matcherFailures: matcherResult.failures } : {}),
		...(errors.length > 0 ? { errors } : {}),
	};
}

/**
 * Aggregate gate results under an {@link EvidencePolicy}.
 *
 * - `all`    : passes only when there is at least one gate and every gate passes.
 * - `quorum` : passes when at least `requiredPasses` gates pass.
 */
export function aggregateGateResults(
	results: readonly VerificationGateResult[],
	policy: EvidencePolicy,
): AggregationEvaluation {
	const passedCount = results.filter((r) => r.pass).length;
	let pass: boolean;
	if (policy.mode === "all") {
		pass = results.length > 0 && passedCount === results.length;
	} else {
		pass = passedCount >= policy.requiredPasses;
	}
	return { pass, passedCount };
}

/**
 * Verify every requirement id is covered by enough passed gates.
 *
 * For each requirement id in `requirements`, its {@link RequirementLink} must
 * exist and at least `minPassingGates` (default 1) of its linked gate ids must
 * appear in `passedGateIds`. A missing link is a traceability gap.
 */
export function verifyTraceability(
	requirements: readonly string[],
	links: readonly RequirementLink[],
	passedGateIds: readonly string[],
): TraceabilityEvaluation {
	const failures: string[] = [];
	const passed = new Set(passedGateIds);
	const byId = new Map<string, RequirementLink>();
	for (const link of links) byId.set(link.requirementId, link);
	for (const requirementId of requirements) {
		const link = byId.get(requirementId);
		if (!link) {
			failures.push(`requirement ${requirementId} has no gate link (traceability gap)`);
			continue;
		}
		const minPassing = link.minPassingGates ?? 1;
		const passing = link.gateIds.filter((id) => passed.has(id)).length;
		if (passing < minPassing) {
			failures.push(`requirement ${requirementId} covered by ${passing}/${minPassing} passed gates`);
		}
	}
	return { pass: failures.length === 0, failures };
}

/**
 * Check reviewer/executor independence.
 *
 * Passes only when:
 *   - the reviewer's model differs from the executor's model, OR
 *   - the reviewer's context differs AND the reviewer declared `freshContext`.
 *
 * This is the fail-closed gate that prevents a node's executor from also being
 * its verifier.
 */
export function checkReviewerExecutorIndependence(executor: AgentContext, reviewer: AgentContext): boolean {
	const differentModel = reviewer.modelId !== executor.modelId;
	const freshDifferentContext = reviewer.contextId !== executor.contextId && reviewer.freshContext === true;
	return differentModel || freshDifferentContext;
}
