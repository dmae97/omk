import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export type RiskLevel = "R0" | "R1" | "R2" | "R3";

export type Capability =
	| "fs.read"
	| "fs.write"
	| "process.exec"
	| "network.read"
	| "network.write"
	| "browser.observe"
	| "browser.mutate"
	| "browser.credentialed"
	| "mcp.call"
	| "extension.run"
	| "api.call"
	| "secrets.resolve"
	| "subagent.spawn";

export type EnvMode = "secret-ref-only" | "passthrough-audited" | "passthrough-full";
export type Sensitivity = "public" | "internal" | "credential" | "payment" | "session" | "admin";
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AutonomyProfile {
	id: "autopilot-max" | "trusted-dev" | "ci-agent" | "public-safe";
	humanPromptBudget: { maxPromptsPerTask: number; maxPromptRate: number };
	capabilities: Capability[];
	env: {
		mode: EnvMode;
		allowPatterns: string[];
		denyPatterns: string[];
		redactPatterns: string[];
		exposeToModel: false;
	};
	api: {
		allowOrigins: string[];
		allowMethods: ApiMethod[];
		mutationDefault: "auto";
		requireIdempotencyForMethods: ApiMethod[];
	};
	browser: {
		persistentProfile: boolean;
		credentialedSessions: boolean;
		autoSubmit: boolean;
		autoDownload: boolean;
		maxUnknownOutcomeReconciliations: number;
	};
	verification: {
		minVerifiabilityByRisk: Record<RiskLevel, number>;
		requireEvidenceByRisk: Record<RiskLevel, boolean>;
		requirePostconditionsByRisk: Record<RiskLevel, boolean>;
	};
	recovery: {
		autoRetry: boolean;
		autoRollback: boolean;
		autoCompensate: boolean;
		duplicateMutationSuppression: boolean;
	};
	budgets: {
		maxWallClockMs: number;
		maxToolCalls: number;
		maxBrowserActions: number;
		maxNetworkCalls: number;
		maxCostUsd: number;
		riskBudget: Record<RiskLevel, number>;
	};
}

export const AUTOPILOT_MAX: AutonomyProfile = {
	id: "autopilot-max",
	humanPromptBudget: { maxPromptsPerTask: 0, maxPromptRate: 0 },
	capabilities: [
		"fs.read",
		"fs.write",
		"process.exec",
		"network.read",
		"network.write",
		"browser.observe",
		"browser.mutate",
		"browser.credentialed",
		"mcp.call",
		"extension.run",
		"api.call",
		"secrets.resolve",
		"subagent.spawn",
	],
	env: {
		mode: "passthrough-audited",
		allowPatterns: ["*"],
		denyPatterns: [],
		redactPatterns: [
			"*KEY*",
			"*TOKEN*",
			"*SECRET*",
			"*PASSWORD*",
			"AWS_*",
			"GCP_*",
			"AZURE_*",
			"OPENAI_*",
			"ANTHROPIC_*",
			"GITHUB_*",
			"NPM_*",
		],
		exposeToModel: false,
	},
	api: {
		allowOrigins: ["*"],
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
		mutationDefault: "auto",
		requireIdempotencyForMethods: ["POST", "PUT", "PATCH", "DELETE"],
	},
	browser: {
		persistentProfile: true,
		credentialedSessions: true,
		autoSubmit: true,
		autoDownload: true,
		maxUnknownOutcomeReconciliations: 5,
	},
	verification: {
		minVerifiabilityByRisk: { R0: 0.1, R1: 0.25, R2: 0.45, R3: 0.65 },
		requireEvidenceByRisk: { R0: false, R1: true, R2: true, R3: true },
		requirePostconditionsByRisk: { R0: false, R1: true, R2: true, R3: true },
	},
	recovery: {
		autoRetry: true,
		autoRollback: true,
		autoCompensate: true,
		duplicateMutationSuppression: true,
	},
	budgets: {
		maxWallClockMs: 30 * 60 * 1000,
		maxToolCalls: 500,
		maxBrowserActions: 250,
		maxNetworkCalls: 1000,
		maxCostUsd: 10,
		riskBudget: { R0: 10000, R1: 2000, R2: 500, R3: 100 },
	},
};

export interface EnvRecord {
	key: string;
	value: string;
	sensitivity: Sensitivity;
	source: "process" | "profile" | "workspace" | "task" | "tool";
	fingerprint: string;
}

export interface EnvUseEvent {
	actionId: string;
	toolId: string;
	key: string;
	sensitivity: Sensitivity;
	fingerprint: string;
	purpose: string;
	passedToProcess: boolean;
	exposedToModel: false;
	timestamp: string;
}

export interface EnvResolutionRequest {
	actionId: string;
	toolId: string;
	purpose: string;
	profile: AutonomyProfile;
	requestedKeys?: string[];
	requestedPatterns?: string[];
	extraEnv?: Record<string, string>;
}

export interface EnvBrokerLedger {
	append(event: EnvUseEvent): Promise<unknown>;
}

export class EnvBroker {
	private readonly processEnv: Record<string, string | undefined>;
	private readonly ledger: EnvBrokerLedger;

	constructor(args: { processEnv: Record<string, string | undefined>; ledger: EnvBrokerLedger }) {
		this.processEnv = args.processEnv;
		this.ledger = args.ledger;
	}

	async createChildEnv(req: EnvResolutionRequest): Promise<Record<string, string>> {
		const selected = this.collect(req).filter((record) => this.isAllowed(record, req));
		const childEnv: Record<string, string> = {};
		for (const record of selected) {
			childEnv[record.key] = record.value;
			await this.ledger.append({
				actionId: req.actionId,
				toolId: req.toolId,
				key: record.key,
				sensitivity: record.sensitivity,
				fingerprint: record.fingerprint,
				purpose: req.purpose,
				passedToProcess: true,
				exposedToModel: false,
				timestamp: new Date().toISOString(),
			});
		}
		return childEnv;
	}

	redactEnvForModel(env: Record<string, string>): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(env)) {
			const sensitivity = classifyEnvKey(key, value);
			out[key] = sensitivity === "public" ? value : `[REDACTED:${sha256(value).slice(0, 12)}]`;
		}
		return out;
	}

	private collect(req: EnvResolutionRequest): EnvRecord[] {
		const records: EnvRecord[] = [];
		for (const [key, value] of Object.entries(this.processEnv)) {
			if (typeof value !== "string") continue;
			records.push({
				key,
				value,
				sensitivity: classifyEnvKey(key, value),
				source: "process",
				fingerprint: sha256(value),
			});
		}
		for (const [key, value] of Object.entries(req.extraEnv ?? {})) {
			records.push({
				key,
				value,
				sensitivity: classifyEnvKey(key, value),
				source: "tool",
				fingerprint: sha256(value),
			});
		}
		return records;
	}

	private isAllowed(record: EnvRecord, req: EnvResolutionRequest): boolean {
		if (req.profile.env.mode === "passthrough-full") return true;
		if (req.profile.env.mode === "secret-ref-only" && record.sensitivity !== "public") return false;
		const allowedByPattern = matchesAny(record.key, req.profile.env.allowPatterns);
		const deniedByPattern = matchesAny(record.key, req.profile.env.denyPatterns);
		if (deniedByPattern || !allowedByPattern) return false;
		if (req.requestedKeys?.includes(record.key)) return true;
		if (req.requestedPatterns?.some((pattern) => globMatch(record.key, pattern))) return true;
		return req.profile.env.allowPatterns.includes("*");
	}
}

export type EvidenceActor = "agent" | "tool" | "browser" | "extension-host" | "mcp" | "api" | "verifier" | "recovery";
export type EvidenceOutcome =
	| "planned"
	| "executed"
	| "verified"
	| "failed_before_commit"
	| "unknown_after_dispatch"
	| "reconciled"
	| "compensated";

export interface EvidenceEvent {
	sequence: number;
	previousHash: string;
	eventHash: string;
	timestamp: string;
	sessionId: string;
	taskId: string;
	actionId?: string;
	actor: EvidenceActor;
	kind: string;
	inputHash?: string;
	outputHash?: string;
	redactedOutputHash?: string;
	envUseHash?: string;
	policyHash?: string;
	profileHash?: string;
	schemaHash?: string;
	outcome?: EvidenceOutcome;
}

export type EvidenceEventInput = Omit<
	EvidenceEvent,
	"sequence" | "previousHash" | "eventHash" | "timestamp" | "sessionId" | "taskId"
>;

export class EvidenceLedger {
	private readonly sessionId: string;
	private readonly taskId: string;
	private readonly events: EvidenceEvent[] = [];
	private previousHash = "genesis";

	constructor(args: { sessionId: string; taskId: string }) {
		this.sessionId = args.sessionId;
		this.taskId = args.taskId;
	}

	async append(event: EvidenceEventInput): Promise<EvidenceEvent> {
		const fullWithoutHash = {
			...event,
			sequence: this.events.length + 1,
			previousHash: this.previousHash,
			timestamp: new Date().toISOString(),
			sessionId: this.sessionId,
			taskId: this.taskId,
		};
		const eventHash = canonicalHash(fullWithoutHash);
		const full: EvidenceEvent = { ...fullWithoutHash, eventHash };
		this.events.push(full);
		this.previousHash = eventHash;
		return full;
	}

	snapshot(): EvidenceEvent[] {
		return this.events.map((event) => ({ ...event }));
	}
}

export type Postcondition =
	| { kind: "url"; origin?: string; path?: string; pattern?: string }
	| { kind: "text"; exact?: string; pattern?: string }
	| { kind: "element-visible"; ref?: string; role?: string; name?: string }
	| { kind: "element-value"; ref: string; expected: string }
	| { kind: "api-status"; status: number }
	| { kind: "api-json"; jsonPath: string; expected: unknown }
	| { kind: "file-exists"; path: string; sha256?: string }
	| { kind: "download"; path: string; sha256?: string; mimeType?: string }
	| { kind: "receipt"; idPattern: string }
	| { kind: "database"; queryId: string; expectedHash: string };

export interface VerificationContext {
	currentUrl?: string;
	text?: string;
	elements?: Array<{ ref?: string; role?: string; name?: string; value?: string; visible?: boolean }>;
	apiStatus?: number;
	apiBody?: unknown;
	receiptId?: string;
	databaseHashes?: Record<string, string>;
}

export interface EvidencePointer {
	kind: string;
	description: string;
	sha256?: string;
}

export interface VerificationResult {
	pass: boolean;
	confidence: number;
	evidencePointers: EvidencePointer[];
	failures: string[];
	receiptId?: string;
}

export class PostconditionVerifier {
	async verify(conditions: Postcondition[], ctx: VerificationContext): Promise<VerificationResult> {
		if (conditions.length === 0) {
			return { pass: false, confidence: 0, evidencePointers: [], failures: ["no postconditions"] };
		}
		const results: VerificationResult[] = [];
		for (const condition of conditions) {
			results.push(await this.verifyOne(condition, ctx));
		}
		return {
			pass: results.every((result) => result.pass),
			confidence: Math.min(...results.map((result) => result.confidence)),
			evidencePointers: results.flatMap((result) => result.evidencePointers),
			failures: results.flatMap((result) => result.failures),
			receiptId: results.find((result) => result.receiptId)?.receiptId,
		};
	}

	private async verifyOne(condition: Postcondition, ctx: VerificationContext): Promise<VerificationResult> {
		switch (condition.kind) {
			case "api-status":
				return booleanResult(ctx.apiStatus === condition.status, "api-status", `status ${condition.status}`);
			case "api-json": {
				const actual = readJsonPath(ctx.apiBody, condition.jsonPath);
				return booleanResult(deepEqual(actual, condition.expected), "api-json", condition.jsonPath);
			}
			case "text": {
				const text = ctx.text ?? "";
				const pass =
					condition.exact !== undefined
						? text.includes(condition.exact)
						: condition.pattern !== undefined && new RegExp(condition.pattern).test(text);
				return booleanResult(pass, "text", condition.exact ?? condition.pattern ?? "<missing>");
			}
			case "url": {
				const currentUrl = ctx.currentUrl;
				if (typeof currentUrl !== "string") {
					return booleanResult(false, "url", "<missing>");
				}
				const parsedUrl = new URL(currentUrl);
				let pass = true;
				if (condition.origin) pass = parsedUrl.origin === condition.origin;
				if (pass && condition.path) pass = parsedUrl.pathname === condition.path;
				if (pass && condition.pattern) pass = new RegExp(condition.pattern).test(currentUrl);
				return booleanResult(pass, "url", currentUrl ?? "<missing>");
			}
			case "file-exists":
				return verifyFile(condition.path, condition.sha256, "file-exists");
			case "download":
				return verifyFile(condition.path, condition.sha256, "download");
			case "receipt": {
				const receiptId = ctx.receiptId;
				const pass = typeof receiptId === "string" && new RegExp(condition.idPattern).test(receiptId);
				return { ...booleanResult(pass, "receipt", receiptId ?? "<missing>"), receiptId };
			}
			case "database": {
				const actualHash = ctx.databaseHashes?.[condition.queryId];
				return booleanResult(actualHash === condition.expectedHash, "database", condition.queryId);
			}
			case "element-visible": {
				const pass = (ctx.elements ?? []).some(
					(element) =>
						element.visible === true &&
						(condition.ref === undefined || element.ref === condition.ref) &&
						(condition.role === undefined || element.role === condition.role) &&
						(condition.name === undefined || element.name === condition.name),
				);
				return booleanResult(pass, "element-visible", condition.ref ?? condition.role ?? condition.name ?? "<any>");
			}
			case "element-value": {
				const pass = (ctx.elements ?? []).some(
					(element) => element.ref === condition.ref && element.value === condition.expected,
				);
				return booleanResult(pass, "element-value", condition.ref);
			}
		}
	}
}

export interface ApiAction {
	actionId: string;
	method: ApiMethod;
	url: string;
	headers: Record<string, string>;
	body?: unknown;
	credentialRefs: string[];
	expectedPostconditions: Postcondition[];
	idempotencyKey?: string;
}

export interface ApiOutcome {
	kind: "succeeded" | "failed_before_commit" | "succeeded_unverified" | "unknown_after_dispatch";
	status?: number;
	bodyHash?: string;
	receiptId?: string;
	redactedBody?: unknown;
}

export interface BrokerFetchRequest {
	method: ApiMethod;
	headers: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}

export interface BrokerFetchResponse {
	status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

export type BrokerFetcher = (url: string, init: BrokerFetchRequest) => Promise<BrokerFetchResponse>;

export class ApiBroker {
	private readonly ledger: EvidenceLedger;
	private readonly verifier: PostconditionVerifier;
	private readonly fetcher: BrokerFetcher;

	constructor(args: { ledger: EvidenceLedger; verifier: PostconditionVerifier; fetcher?: BrokerFetcher }) {
		this.ledger = args.ledger;
		this.verifier = args.verifier;
		this.fetcher = args.fetcher ?? defaultFetcher;
	}

	async execute(
		action: ApiAction,
		ctx: { signal?: AbortSignal; profile?: AutonomyProfile } = {},
	): Promise<ApiOutcome> {
		const idempotencyKey = action.idempotencyKey ?? deriveIdempotencyKey(action);
		const headers = { ...action.headers, "Idempotency-Key": idempotencyKey, "X-OMK-Action-Id": action.actionId };
		await this.ledger.append({
			actor: "api",
			kind: "api.dispatch.planned",
			actionId: action.actionId,
			inputHash: canonicalHash({ method: action.method, url: action.url, headers, body: action.body }),
			outcome: "planned",
		});

		let response: BrokerFetchResponse;
		try {
			response = await this.fetcher(action.url, {
				method: action.method,
				headers,
				body: action.body === undefined ? undefined : JSON.stringify(action.body),
				signal: ctx.signal,
			});
		} catch {
			return this.reconcileUnknown(action, idempotencyKey, ctx.profile ?? AUTOPILOT_MAX);
		}

		const rawBody = await safeReadJsonOrText(response);
		const redactedBody = redactForModel(rawBody);
		await this.ledger.append({
			actor: "api",
			kind: "api.response",
			actionId: action.actionId,
			outputHash: canonicalHash(rawBody),
			redactedOutputHash: canonicalHash(redactedBody),
			outcome: "executed",
		});
		const verification = await this.verifier.verify(action.expectedPostconditions, {
			apiStatus: response.status,
			apiBody: rawBody,
			receiptId: readReceiptId(rawBody),
		});
		if (!verification.pass) {
			return {
				kind: "succeeded_unverified",
				status: response.status,
				bodyHash: canonicalHash(rawBody),
				redactedBody,
			};
		}
		return {
			kind: "succeeded",
			status: response.status,
			bodyHash: canonicalHash(rawBody),
			receiptId: verification.receiptId,
			redactedBody,
		};
	}

	private async reconcileUnknown(
		action: ApiAction,
		idempotencyKey: string,
		profile: AutonomyProfile,
	): Promise<ApiOutcome> {
		for (let attempt = 0; attempt < profile.browser.maxUnknownOutcomeReconciliations; attempt++) {
			const verification = await this.verifier.verify(action.expectedPostconditions, { receiptId: idempotencyKey });
			if (verification.pass) {
				await this.ledger.append({
					actor: "recovery",
					kind: "api.unknown.reconciled",
					actionId: action.actionId,
					outcome: "reconciled",
				});
				return { kind: "succeeded", receiptId: verification.receiptId };
			}
		}
		await this.ledger.append({
			actor: "recovery",
			kind: "api.unknown.unresolved",
			actionId: action.actionId,
			outcome: "unknown_after_dispatch",
		});
		return { kind: "unknown_after_dispatch" };
	}
}

export interface ExecutionStrategy {
	execute: boolean;
	requirePostcondition: boolean;
	requireIdempotency: boolean;
	recovery: "retry" | "repair" | "reconcile-and-compensate";
	evidenceDepth: "minimal" | "normal" | "deep" | "forensic";
}

export function strategyForRisk(risk: RiskLevel): ExecutionStrategy {
	if (risk === "R0") {
		return {
			execute: true,
			requirePostcondition: false,
			requireIdempotency: false,
			recovery: "retry",
			evidenceDepth: "minimal",
		};
	}
	if (risk === "R1") {
		return {
			execute: true,
			requirePostcondition: true,
			requireIdempotency: false,
			recovery: "retry",
			evidenceDepth: "normal",
		};
	}
	if (risk === "R2") {
		return {
			execute: true,
			requirePostcondition: true,
			requireIdempotency: true,
			recovery: "repair",
			evidenceDepth: "deep",
		};
	}
	return {
		execute: true,
		requirePostcondition: true,
		requireIdempotency: true,
		recovery: "reconcile-and-compensate",
		evidenceDepth: "forensic",
	};
}

export interface ToolExecutionNeed {
	actionId: string;
	requiredCapability: Capability;
	risk: RiskLevel;
	requiredPostconditions: Postcondition[];
	contextFingerprint?: string;
}

export interface ToolExecutionCandidate {
	toolId: string;
	capability: Capability;
	schemaHash: string;
	reliability: number;
	verificationStrength: number;
	avgLatencyMs: number;
	costUsd: number;
	supportsIdempotency: boolean;
	enabled: boolean;
	contextFingerprint?: string;
}

export interface ToolExecutionChoice {
	candidate: ToolExecutionCandidate;
	score: number;
	strategy: ExecutionStrategy;
	reasons: string[];
}

export class DynamicToolPortfolioOptimizer {
	rank(candidates: ToolExecutionCandidate[], need: ToolExecutionNeed): ToolExecutionChoice[] {
		return candidates
			.filter((candidate) => candidate.enabled && candidate.capability === need.requiredCapability)
			.map((candidate) => this.scoreCandidate(candidate, need))
			.sort((left, right) => right.score - left.score);
	}

	scoreCandidate(candidate: ToolExecutionCandidate, need: ToolExecutionNeed): ToolExecutionChoice {
		const strategy = strategyForRisk(need.risk);
		const contextMatch =
			need.contextFingerprint === undefined || candidate.contextFingerprint === need.contextFingerprint ? 1 : 0;
		const idempotency = !strategy.requireIdempotency || candidate.supportsIdempotency ? 1 : 0;
		const latency = Math.max(0, 1 - candidate.avgLatencyMs / 30000);
		const cost = Math.max(0, 1 - candidate.costUsd / Math.max(1, AUTOPILOT_MAX.budgets.maxCostUsd));
		const postconditionCoverage = need.requiredPostconditions.length > 0 ? candidate.verificationStrength : 1;
		const score =
			0.32 * candidate.reliability +
			0.26 * postconditionCoverage +
			0.16 * idempotency +
			0.12 * contextMatch +
			0.08 * latency +
			0.06 * cost;
		return {
			candidate,
			score: Number(score.toFixed(4)),
			strategy,
			reasons: [
				`reliability=${candidate.reliability}`,
				`verification=${postconditionCoverage}`,
				`idempotency=${idempotency}`,
				`context=${contextMatch}`,
			],
		};
	}
}

export class ToolExecutionBroker {
	private readonly ledger: EvidenceLedger;
	private readonly profile: AutonomyProfile;
	private readonly optimizer: DynamicToolPortfolioOptimizer;

	constructor(args: {
		ledger: EvidenceLedger;
		profile?: AutonomyProfile;
		optimizer?: DynamicToolPortfolioOptimizer;
	}) {
		this.ledger = args.ledger;
		this.profile = args.profile ?? AUTOPILOT_MAX;
		this.optimizer = args.optimizer ?? new DynamicToolPortfolioOptimizer();
	}

	async select(need: ToolExecutionNeed, candidates: ToolExecutionCandidate[]): Promise<ToolExecutionChoice> {
		const choices = this.optimizer.rank(candidates, need);
		const choice = choices[0];
		if (choice === undefined) {
			throw new Error(`No enabled tool candidate for ${need.requiredCapability}`);
		}
		await this.ledger.append({
			actor: "tool",
			kind: "tool.execution.planned",
			actionId: need.actionId,
			inputHash: canonicalHash(need),
			policyHash: canonicalHash(this.profile),
			schemaHash: choice.candidate.schemaHash,
			outcome: "planned",
		});
		return choice;
	}

	async recordResult(choice: ToolExecutionChoice, result: VerificationResult): Promise<EvidenceEvent> {
		return this.ledger.append({
			actor: "tool",
			kind: "tool.execution.result",
			actionId: choice.candidate.toolId,
			outputHash: canonicalHash(result),
			schemaHash: choice.candidate.schemaHash,
			outcome: result.pass ? "verified" : "unknown_after_dispatch",
		});
	}
}

export interface AutomationTraceAction {
	kind: "tool" | "browser" | "api" | "mcp" | "extension";
	verificationPass: boolean;
	schemaHashMatched?: boolean;
	envUseLedgered?: boolean;
	targetFingerprintMatched?: boolean;
	outcome?: "unknown_after_dispatch" | "succeeded" | "failed";
	reconciled?: boolean;
}

export interface AutomationTraceEnvApiUse {
	ledgered: boolean;
	exposedToModel: boolean;
	exposedToLogs: boolean;
}

export interface AutomationTraceContextPlan {
	renderedTokens: number;
	resourceBudget: number;
	planHash: string;
	renderedHashLinkedPlanHash: string;
	outputReserveCountedOnce: boolean;
}

export interface AutomationTrace {
	actions: AutomationTraceAction[];
	verifications: Array<{ conditionHash: string; pass: boolean }>;
	humanPrompts: number;
	envApiUses: AutomationTraceEnvApiUse[];
	failures: number;
	unknownOutcomes: number;
	recoveredFailures: number;
	reconciledUnknowns: number;
	secretLeaks: number;
	duplicateIrreversibleMutations: number;
	unledgeredEnvUses: number;
	replayMatches: boolean;
	contextPlans: AutomationTraceContextPlan[];
}

export interface AutomationHarnessScoreInput {
	requiredPostconditions: Postcondition[];
	trace: AutomationTrace;
}

export interface AutomationScoreBreakdown {
	score: number;
	verifiedSuccess: boolean;
	envApiUseCorrectness: number;
	duplicateMutations: number;
	secretLeaks: number;
	critical: boolean;
}

export class AutomationHarnessScorer {
	score(input: AutomationHarnessScoreInput): AutomationScoreBreakdown {
		const verifiedSuccess = this.verifiedSuccess(input);
		const autonomy = 1 - input.trace.humanPrompts / Math.max(1, input.trace.actions.length);
		const toolUse = this.toolUseScore(input.trace);
		const browserUse = this.browserUseScore(input.trace);
		const envApi = this.envApiScore(input.trace);
		const recovery = this.recoveryScore(input.trace);
		const determinism = input.trace.replayMatches ? 1 : 0;
		const context = this.contextScore(input.trace);
		const critical =
			input.trace.secretLeaks > 0 ||
			input.trace.duplicateIrreversibleMutations > 0 ||
			(input.requiredPostconditions.length > 0 && verifiedSuccess < 1) ||
			!input.trace.replayMatches ||
			input.trace.unledgeredEnvUses > 0 ||
			input.trace.envApiUses.some((use) => !use.ledgered) ||
			input.trace.actions.some(
				(action) =>
					action.schemaHashMatched === false ||
					(action.kind === "browser" && action.targetFingerprintMatched === false),
			);
		const raw =
			20 * verifiedSuccess +
			15 * autonomy +
			15 * toolUse +
			15 * browserUse +
			10 * envApi +
			10 * recovery +
			10 * determinism +
			5 * context;
		return {
			score: critical ? Math.min(79, raw) : raw,
			verifiedSuccess: verifiedSuccess >= 0.93,
			envApiUseCorrectness: envApi,
			duplicateMutations: input.trace.duplicateIrreversibleMutations,
			secretLeaks: input.trace.secretLeaks,
			critical,
		};
	}

	private verifiedSuccess(input: AutomationHarnessScoreInput): number {
		const passed = input.requiredPostconditions.filter((condition) =>
			input.trace.verifications.some(
				(verification) => verification.conditionHash === canonicalHash(condition) && verification.pass,
			),
		);
		return passed.length / Math.max(1, input.requiredPostconditions.length);
	}

	private toolUseScore(trace: AutomationTrace): number {
		const calls = trace.actions.filter((action) => action.kind === "tool");
		if (calls.length === 0) return 1;
		const verified = calls.filter((action) => action.verificationPass).length;
		const schemaStable = calls.filter((action) => action.schemaHashMatched === true).length;
		const envLedgered = calls.filter((action) => action.envUseLedgered === true).length;
		return (verified + schemaStable + envLedgered) / (3 * calls.length);
	}

	private browserUseScore(trace: AutomationTrace): number {
		const actions = trace.actions.filter((action) => action.kind === "browser");
		if (actions.length === 0) return 1;
		const verified = actions.filter((action) => action.verificationPass).length;
		const targetStable = actions.filter((action) => action.targetFingerprintMatched === true).length;
		const unknownResolved = actions.filter(
			(action) => action.outcome !== "unknown_after_dispatch" || action.reconciled === true,
		).length;
		return (verified + targetStable + unknownResolved) / (3 * actions.length);
	}

	private envApiScore(trace: AutomationTrace): number {
		if (trace.envApiUses.length === 0) return 1;
		const ledgered = trace.envApiUses.filter((use) => use.ledgered).length;
		const notLeaked = trace.envApiUses.filter((use) => !use.exposedToModel && !use.exposedToLogs).length;
		return (ledgered + notLeaked) / (2 * trace.envApiUses.length);
	}

	private recoveryScore(trace: AutomationTrace): number {
		const failures = trace.failures + trace.unknownOutcomes;
		if (failures === 0) return 1;
		return (trace.recoveredFailures + trace.reconciledUnknowns) / failures;
	}

	private contextScore(trace: AutomationTrace): number {
		if (trace.contextPlans.length === 0) return 1;
		const valid = trace.contextPlans.filter(
			(plan) =>
				plan.renderedTokens <= plan.resourceBudget &&
				plan.planHash === plan.renderedHashLinkedPlanHash &&
				plan.outputReserveCountedOnce,
		).length;
		return valid / trace.contextPlans.length;
	}
}

export function classifyEnvKey(key: string, value: string): Sensitivity {
	const normalizedKey = key.toUpperCase();
	if (
		normalizedKey.includes("TOKEN") ||
		normalizedKey.includes("SECRET") ||
		normalizedKey.includes("PASSWORD") ||
		normalizedKey.includes("API_KEY") ||
		normalizedKey.endsWith("_KEY") ||
		normalizedKey.startsWith("AWS_") ||
		normalizedKey.startsWith("GCP_") ||
		normalizedKey.startsWith("AZURE_") ||
		normalizedKey.startsWith("OPENAI_") ||
		normalizedKey.startsWith("ANTHROPIC_") ||
		normalizedKey.startsWith("GITHUB_") ||
		normalizedKey.startsWith("NPM_")
	) {
		return "credential";
	}
	if (looksLikePaymentCredential(value)) return "payment";
	if (looksLikeSessionCookie(value)) return "session";
	return "public";
}

export function canonicalHash(value: unknown): string {
	return sha256(stableStringify(value));
}

export function redactForModel(value: unknown): unknown {
	if (typeof value === "string") return redactString(value);
	if (Array.isArray(value)) return value.map((item) => redactForModel(item));
	if (isRecord(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			out[key] =
				classifyEnvKey(key, typeof child === "string" ? child : "") === "public"
					? redactForModel(child)
					: "[REDACTED]";
		}
		return out;
	}
	return value;
}

function booleanResult(pass: boolean, kind: string, description: string): VerificationResult {
	return {
		pass,
		confidence: pass ? 1 : 0,
		evidencePointers: pass ? [{ kind, description }] : [],
		failures: pass ? [] : [`${kind} postcondition failed: ${description}`],
	};
}

async function verifyFile(path: string, expectedHash: string | undefined, kind: string): Promise<VerificationResult> {
	try {
		await stat(path);
		const content = await readFile(path);
		const actualHash = createHash("sha256").update(content).digest("hex");
		const pass = expectedHash === undefined || expectedHash === actualHash;
		return {
			pass,
			confidence: pass ? 1 : 0,
			evidencePointers: pass ? [{ kind, description: path, sha256: actualHash }] : [],
			failures: pass ? [] : [`${kind} hash mismatch for ${path}`],
		};
	} catch {
		return { pass: false, confidence: 0, evidencePointers: [], failures: [`${kind} missing: ${path}`] };
	}
}

function readJsonPath(value: unknown, path: string): unknown {
	if (path === "$") return value;
	if (!path.startsWith("$.")) return undefined;
	let current = value;
	for (const segment of path.slice(2).split(".")) {
		if (!isRecord(current)) return undefined;
		current = current[segment];
	}
	return current;
}

function readReceiptId(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	const receipt = value.receiptId ?? value.id;
	return typeof receipt === "string" ? receipt : undefined;
}

async function safeReadJsonOrText(response: BrokerFetchResponse): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return response.text();
	}
}

function deriveIdempotencyKey(action: ApiAction): string {
	return `omk-${canonicalHash({ method: action.method, url: action.url, body: action.body, actionId: action.actionId }).slice(0, 24)}`;
}

async function defaultFetcher(url: string, init: BrokerFetchRequest): Promise<BrokerFetchResponse> {
	const response = await fetch(url, init);
	return {
		status: response.status,
		json: () => response.json() as Promise<unknown>,
		text: () => response.text(),
	};
}

function redactString(value: string): string {
	return value
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]")
		.replace(/([?&]?(?:access_)?token=)[^&\s]+/gi, "$1[REDACTED]")
		.replace(/((?:api[_-]?key|password|secret)=)[^&\s]+/gi, "$1[REDACTED]");
}

function deepEqual(left: unknown, right: unknown): boolean {
	return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}

function matchesAny(value: string, patterns: string[]): boolean {
	return patterns.some((pattern) => pattern === "*" || globMatch(value, pattern));
}

function globMatch(value: string, pattern: string): boolean {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`, "i").test(value);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function looksLikePaymentCredential(value: string): boolean {
	return /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/.test(value);
}

function looksLikeSessionCookie(value: string): boolean {
	return value.length >= 32 && /[A-Za-z0-9+/=_-]{32,}/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
