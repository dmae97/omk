/**
 * Policy-gated computer-use controller (Algorithm 2).
 *
 * Loop, per step:
 *   1. observe the browser (result is UNTRUSTED web content)
 *   2. mark untrusted, extract read evidence
 *   3. if completion contract satisfied → COMPLETED
 *   4. ask the planner for the next action
 *   5. resolve target origin + classify risk + authorize (deny/approve/allow)
 *   6. if approve → ask the injected Approver; denied → BLOCKED
 *   7. acquire per-profile mutation lock; execute via the BrowserClient
 *   8. redact secrets, extract action evidence
 *   9. unknown external outcome → INSPECTION_REQUIRED (never auto-retry)
 *  10. transient failure + read-only/idempotent → backoff + retry (capped)
 *
 * The controller is I/O but fully mockable: it takes injected BrowserClient,
 * Approver, Planner, and Policy ports so the safety logic is unit-testable
 * without a real Aside binary or browser.
 */

import { selectActionCandidate } from "./action-scoring.ts";
import { parseCriterionToAssertion, verifyAssertions } from "./assertions.ts";
import { redactSecrets } from "./evidence.ts";
import { createObservationSnapshot } from "./observation-snapshot.ts";
import type { AuthorizerPolicy } from "./risk-authorize.ts";
import { authorize } from "./risk-authorize.ts";
import { classifyRisk } from "./risk-classifier.ts";
import type {
	Approver,
	BrowserAction,
	BrowserClient,
	Evidence,
	Observation,
	ObservationSnapshot,
	Planner,
	RiskLevel,
	SideEffect,
	SuccessAssertion,
	TaskResult,
} from "./types.ts";
import { resolveOrigin } from "./url-origin.ts";

export interface RunTaskOptions {
	goal: string;
	criteria: readonly { id: string; description: string }[];
	account?: string;
	browserProfileId?: string;
	originAllowlistOverride?: readonly string[];
	mode?: string;
	signal?: AbortSignal;
}

export interface ControllerPorts {
	client: BrowserClient;
	planner: Planner;
	approve: Approver;
	policy: AuthorizerPolicy;
	/** Where to store screenshot/file evidence. */
	evidenceDirectory: string;
	maxSteps: number;
	maxRetries: number;
}

interface VerifiedCriteria {
	readonly satisfied: Set<string>;
}

function describePlanFail(action: BrowserAction | undefined, note: string | undefined): string {
	if (!action) return note ?? "planner returned no action";
	return note ?? `planned action: ${action.kind}`;
}

export class AsideController {
	private readonly ports: ControllerPorts;

	constructor(ports: ControllerPorts) {
		this.ports = ports;
	}

	async runTask(options: RunTaskOptions): Promise<TaskResult> {
		const { goal, criteria, client, planner, approve, policy, maxSteps, maxRetries } = {
			...this.ports,
			...options,
		};
		const evidence: Evidence[] = [];
		const sideEffects: SideEffect[] = [];
		const uncertainties: string[] = [];
		const assertions = criteria.map((criterion) => parseCriterionToAssertion(criterion));
		const verified: VerifiedCriteria = { satisfied: new Set() };
		const allowedOrigins = options.originAllowlistOverride ?? policy.allowedOrigins;
		const effectivePolicy: AuthorizerPolicy = { ...policy, allowedOrigins };

		let lastUrl: string | undefined;
		let previousSnapshot: ObservationSnapshot | undefined;
		let steps = 0;
		const start = Date.now();

		while (steps < maxSteps) {
			steps++;
			if (options.signal?.aborted)
				return this.blocked("aborted", evidence, sideEffects, uncertainties, steps, lastUrl);

			// 1-2. Observe (untrusted).
			let observation: Observation;
			try {
				observation = await client.observe();
			} catch (error) {
				return this.failed(
					`observe failed: ${(error as Error).message}`,
					evidence,
					sideEffects,
					uncertainties,
					steps,
					lastUrl,
				);
			}
			lastUrl = observation.url;
			const snapshot = createObservationSnapshot(observation, previousSnapshot);
			previousSnapshot = snapshot;
			this.collectObservationEvidence(observation, evidence);
			if (snapshot.quality.parse === 0 || snapshot.quality.evidenceCoverage === 0) {
				return this.inspectionRequired(
					"low-quality observation cannot support planning",
					evidence,
					sideEffects,
					uncertainties,
					steps,
					lastUrl,
				);
			}

			// 3. Completion check.
			this.verifyCriteria(assertions, observation, evidence, verified);
			if (this.allSatisfied(assertions, verified)) {
				return this.completed(goal, observation, evidence, sideEffects, uncertainties, steps);
			}

			// 4. Next action.
			const planned = await planner.nextAction(goal, observation, evidence);
			if (planned.done) {
				if (this.allSatisfied(assertions, verified))
					return this.completed(goal, observation, evidence, sideEffects, uncertainties, steps);
				return this.inspectionRequired(
					"planner declared done but criteria unmet",
					evidence,
					sideEffects,
					uncertainties,
					steps,
					lastUrl,
				);
			}
			let action = planned.action;
			if (planned.candidates && planned.candidates.length > 0) {
				const selection = selectActionCandidate(planned.candidates);
				if (selection.status !== "selected" || !selection.selected) {
					return this.inspectionRequired(selection.reason, evidence, sideEffects, uncertainties, steps, lastUrl);
				}
				action = selection.selected.candidate.action;
				evidence.push({
					type: "log",
					value: `selected action ${action.kind} score=${selection.selected.total.toFixed(3)}`,
					source: "score",
				});
			}
			if (!action) {
				return this.inspectionRequired(
					describePlanFail(undefined, planned.note),
					evidence,
					sideEffects,
					uncertainties,
					steps,
					lastUrl,
				);
			}

			// 5. Authorize.
			const targetOrigin = resolveOrigin(action.url ?? observation.url ?? "");
			const risk = classifyRisk(action);
			const decision = authorize({ ...action, url: action.url ?? observation.url }, risk, effectivePolicy);
			if (decision.decision === "deny") {
				sideEffects.push({
					kind: "denied",
					target: targetOrigin ?? "(unknown)",
					description: decision.reason,
					confirmed: false,
				});
				return this.blocked(decision.reason, evidence, sideEffects, uncertainties, steps, lastUrl);
			}

			// 6. Human approval.
			if (decision.decision === "approve") {
				const allowed = await approve(action, risk, targetOrigin);
				if (!allowed) {
					sideEffects.push({
						kind: "denied",
						target: targetOrigin ?? "(unknown)",
						description: "human approval denied",
						confirmed: false,
					});
					return this.denied("human approval denied", evidence, sideEffects, uncertainties, steps, lastUrl);
				}
			}

			// 7-8. Execute under profile lock, redact, record.
			let release: (() => void) | undefined;
			if (options.account && options.browserProfileId) {
				release = await this.lockProfile(options.account, options.browserProfileId);
			}
			let result: Awaited<ReturnType<BrowserClient["execute"]>>;
			try {
				result = await client.execute(action);
			} catch (error) {
				release?.();
				return this.failed(
					`execute failed: ${(error as Error).message}`,
					evidence,
					sideEffects,
					uncertainties,
					steps,
					lastUrl,
				);
			}
			release?.();

			const raw = redactSecrets(result.raw);
			if (result.sideEffectKind) {
				sideEffects.push({
					kind: result.sideEffectKind,
					target: targetOrigin ?? observation.url,
					description: action.description,
					confirmed: result.ok,
				});
			}

			// 9. Failure handling. Only non-mutating/idempotent actions are retryable.
			if (!result.ok) {
				const retried = await this.retryLoop(action, risk, raw, maxRetries, options.signal);
				if (!retried.ok) {
					return this.failed(
						`${action.kind} failed after retries`,
						evidence,
						sideEffects,
						uncertainties,
						steps,
						lastUrl,
					);
				}
			}

			// 10. Post-action observation gives the controller an independent chance
			// to verify expected UI state before declaring completion or requiring inspection.
			let postObservation: Observation | undefined;
			try {
				postObservation = await client.observe();
				lastUrl = postObservation.url;
				this.collectObservationEvidence(postObservation, evidence);
				this.verifyCriteria(assertions, postObservation, evidence, verified);
			} catch {
				// Keep original action result path; inability to observe after mutation is handled below.
			}

			if (postObservation && this.allSatisfied(assertions, verified)) {
				return this.completed(goal, postObservation, evidence, sideEffects, uncertainties, steps);
			}

			if (this.isMutation(action, risk) && !this.confirmable(criteria)) {
				uncertainties.push(`${action.kind} committed; result not independently verifiable`);
				return this.inspectionRequired(
					`${action.kind} side-effect outcome unknown`,
					evidence,
					sideEffects,
					uncertainties,
					steps,
					lastUrl,
				);
			}
			void raw;
		}

		return this.maxStepsExceeded(evidence, sideEffects, uncertainties, steps, lastUrl, Date.now() - start);
	}

	private async retryLoop(
		action: BrowserAction,
		risk: RiskLevel,
		_raw: unknown,
		maxRetries: number,
		signal?: AbortSignal,
	): Promise<{ ok: boolean }> {
		// Only non-mutating actions are eligible for automatic retry. Mutations may
		// have reached the remote page even when the tool result is ambiguous.
		if (this.isMutation(action, risk)) return { ok: false };
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			if (signal?.aborted) return { ok: false };
			await this.backoff(attempt);
			try {
				const result = await this.ports.client.execute(action);
				if (result.ok) return { ok: true };
			} catch {
				// continue
			}
		}
		return { ok: false };
	}

	private backoff(attempt: number): Promise<void> {
		const ms = Math.min(25 * 2 ** attempt, 250);
		return new Promise((resolve) => setTimeout(resolve, ms).unref());
	}

	private async lockProfile(account: string, profile: string): Promise<() => void> {
		// Reuse a minimal inline lock identical to SessionBindingStore semantics.
		const key = `${account}:${profile}`;
		let store = this.lockStore;
		if (!store) {
			store = new Map();
			this.lockStore = store;
		}
		const prev = store.get(key) ?? Promise.resolve();
		let release = () => {};
		const next = new Promise<void>((resolve) => {
			release = () => resolve();
		});
		store.set(
			key,
			prev.then(() => next),
		);
		await prev;
		return release;
	}

	private lockStore: Map<string, Promise<void>> | undefined;

	// ---- evidence + completion helpers -------------------------------------

	private collectObservationEvidence(observation: Observation, evidence: Evidence[]): void {
		if (observation.url) evidence.push({ type: "url", value: observation.url, source: "observe" });
		if (observation.text)
			evidence.push({ type: "dom_text", value: observation.text.slice(0, 4000), source: "observe" });
	}

	private verifyCriteria(
		assertions: readonly SuccessAssertion[],
		observation: Observation,
		evidence: Evidence[],
		verified: VerifiedCriteria,
	): void {
		const verification = verifyAssertions(assertions, observation);
		for (const result of verification.assertions) {
			if (result.status !== "pass" || verified.satisfied.has(result.assertion.id)) continue;
			verified.satisfied.add(result.assertion.id);
			evidence.push({
				type: "log",
				value: `criterion met: ${result.assertion.id} confidence=${result.confidence.toFixed(2)} reason=${result.reason}`,
				source: "verify",
			});
		}
	}

	private allSatisfied(assertions: readonly SuccessAssertion[], verified: VerifiedCriteria): boolean {
		return assertions.every((assertion) => verified.satisfied.has(assertion.id));
	}

	private confirmable(_criteria: readonly { id: string }[]): boolean {
		// Placeholder: by default mutations on non-confirmed criteria are flagged
		// as inspection-required. Override in a subclass / config for known-safe
		// idempotent flows.
		return false;
	}

	private isMutation(_action: BrowserAction, risk: RiskLevel): boolean {
		return risk === "R2" || risk === "R3";
	}

	// ---- result builders ----------------------------------------------------

	private completed(
		goal: string,
		observation: Observation,
		evidence: Evidence[],
		sideEffects: SideEffect[],
		uncertainties: string[],
		steps: number,
	): TaskResult {
		return {
			status: "completed",
			finalUrl: observation.url,
			summary: `Goal satisfied: ${goal.slice(0, 200)}`,
			evidence,
			sideEffects,
			uncertainties,
			stepsTaken: steps,
		};
	}

	private blocked(
		reason: string,
		evidence: Evidence[],
		sideEffects: SideEffect[],
		uncertainties: string[],
		steps: number,
		url?: string,
	): TaskResult {
		return {
			status: "blocked",
			finalUrl: url,
			summary: reason,
			evidence,
			sideEffects,
			uncertainties,
			stepsTaken: steps,
		};
	}

	private denied(
		reason: string,
		evidence: Evidence[],
		sideEffects: SideEffect[],
		uncertainties: string[],
		steps: number,
		url?: string,
	): TaskResult {
		return {
			status: "denied",
			finalUrl: url,
			summary: reason,
			evidence,
			sideEffects,
			uncertainties,
			stepsTaken: steps,
		};
	}

	private failed(
		reason: string,
		evidence: Evidence[],
		sideEffects: SideEffect[],
		uncertainties: string[],
		steps: number,
		url?: string,
	): TaskResult {
		return {
			status: "failed",
			finalUrl: url,
			summary: reason,
			evidence,
			sideEffects,
			uncertainties,
			stepsTaken: steps,
		};
	}

	private inspectionRequired(
		reason: string,
		evidence: Evidence[],
		sideEffects: SideEffect[],
		uncertainties: string[],
		steps: number,
		url?: string,
	): TaskResult {
		uncertainties.push(reason);
		return {
			status: "inspection_required",
			finalUrl: url,
			summary: reason,
			evidence,
			sideEffects,
			uncertainties,
			stepsTaken: steps,
		};
	}

	private maxStepsExceeded(
		evidence: Evidence[],
		sideEffects: SideEffect[],
		uncertainties: string[],
		steps: number,
		url?: string,
		_elapsedMs?: number,
	): TaskResult {
		return {
			status: "max_steps_exceeded",
			finalUrl: url,
			summary: `maximum step count exceeded (${steps})`,
			evidence,
			sideEffects,
			uncertainties,
			stepsTaken: steps,
		};
	}
}
