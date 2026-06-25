/**
 * OMK Jailbreak v6.2 — Type Definitions
 * =====================================
 * Extracted from Python models.py and v6_2_unified.py data models.
 * Pure local types — zero API calls.
 */

export type AgentStatus = "pending" | "running" | "success" | "failed" | "timeout";

export interface AgentResult {
	agentId: string;
	status: AgentStatus;
	output?: string;
	error?: string;
	latencyMs: number;
	asrEstimate: number;
	techniqueUsed: string;
	metadata: Record<string, unknown>;
}

export interface ExecutionResult {
	success: boolean;
	query: string;
	model: string;
	bestAgent: string;
	results: AgentResult[];
	finalOutput?: string;
	totalLatencyMs: number;
	totalCost: number;
	timestamp: string;
}

export interface ModelStrategy {
	agents: string[];
	timeout: number;
	costFactor: number;
	notes: string;
}

export interface TurnEntry {
	index: number;
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	timestamp: number;
	metadata: Record<string, unknown>;
	tokenCount: number;
	isKeyTurn: boolean;
	relevanceScore: number;
	accessCount: number;
	lastAccessed: number;
	importanceScore?: number;
	semanticHash?: string;
	isProtected?: boolean;
}

export interface CompressedContext {
	turns: TurnEntry[];
	summary: string;
	originalTokens: number;
	compressedTokens: number;
	compressionRatio: number;
	techniqueUsed: string;
	keyTurnsPreserved: number;
	evictedCount: number;
	metadata: Record<string, unknown>;
}

export interface BudgetStatus {
	usedTokens: number;
	totalTokens: number;
	ratio: number;
	level: "green" | "yellow" | "orange" | "red" | "exceeded";
	remaining: number;
	canAddAgents: boolean;
}

export type HeadroomState = "idle" | "active" | "stressed" | "critical" | "blocked";

export interface HeadroomSnapshot {
	timestamp: number;
	promptTokens: number;
	contextUsed: number;
	contextLimit: number;
	headroomRatio: number;
	state: HeadroomState;
	estimatedRemaining: number;
	metadata: Record<string, unknown>;
}

export interface HeadroomPrediction {
	timestamp: number;
	predictedRatio: number;
	predictedState: HeadroomState;
	confidence: number;
	method: "linear_regression" | "moving_average" | "exponential_smoothing" | "ensemble";
	horizonSeconds: number;
}

export type AlertSeverity = "info" | "warning" | "critical" | "emergency";

export interface HeadroomAlert {
	timestamp: number;
	severity: AlertSeverity;
	message: string;
	currentRatio: number;
	currentState: HeadroomState;
	actionTaken: string;
	resolved: boolean;
	resolvedAt?: number;
}

export interface CompactionResult {
	turns: TurnEntry[];
	summary: string;
	originalTokens: number;
	compressedTokens: number;
	compressionRatio: number;
	level: CompactionLevel;
	techniqueUsed: string;
	protectedTurns: number;
	dedupedCount: number;
	evictedCount: number;
	processingTimeMs: number;
	metadata: Record<string, unknown>;
}

export type CompactionLevel = "none" | "light" | "moderate" | "aggressive" | "emergency";

export interface CompactionStats {
	totalCompactions: number;
	totalTurnsProcessed: number;
	totalTurnsEvicted: number;
	totalDeduped: number;
	avgCompressionRatio: number;
	avgProcessingTimeMs: number;
	levelCounts: Record<string, number>;
	lastCompactionTime?: number;
}

export interface CompressionResult {
	originalTokens: number;
	compressedTokens: number;
	technique: string;
	cacheHit: boolean;
	savedPercent: number;
}

export interface LazyResult {
	executed: boolean;
	cacheHit: boolean;
	promiseResolved: boolean;
	shortCircuited: boolean;
	savedTokens: number;
}

export interface BudgetDecision {
	allocatedBudget: number;
	riskLevel: "low" | "medium" | "high" | "critical";
	confidence: number;
	predictedAsr: number;
}

export interface TokenUsageLog {
	timestamp: number;
	queryHash: string;
	originalTokens: number;
	compressedTokens: number;
	lazySaved: number;
	finalBudget: number;
	actualTokens: number;
	asr: number;
	latencyMs: number;
}

export interface BrowserTask {
	url: string;
	instruction: string;
	actions: Record<string, unknown>[];
	maxSteps: number;
	timeout: number;
	extractSelectors: string[];
	metadata: Record<string, unknown>;
}

export interface PageState {
	url: string;
	title: string;
	contentText: string;
	contentHtml: string;
	links: Array<{ url: string; text: string }>;
	forms: Array<Record<string, unknown>>;
	buttons: Array<{ text: string }>;
	images: Array<{ src: string; alt: string }>;
	metaTags: Record<string, string>;
	headers: Record<string, string>;
	statusCode: number;
	timestamp: string;
}

export interface BrowserStep {
	stepNumber: number;
	action: BrowserAction;
	target: string;
	inputValue: string;
	success: boolean;
	output: string;
	error?: string;
	pageStateBefore?: PageState;
	pageStateAfter?: PageState;
	latencyMs: number;
	timestamp: string;
}

export type BrowserAction =
	| "navigate"
	| "click"
	| "type"
	| "scroll"
	| "extract"
	| "screenshot"
	| "wait"
	| "back"
	| "forward"
	| "refresh";

export interface BrowserSession {
	sessionId: string;
	task: BrowserTask;
	steps: BrowserStep[];
	currentPage?: PageState;
	history: PageState[];
	cookies: Record<string, string>;
	localStorage: Record<string, string>;
	createdAt: string;
	updatedAt: string;
	status: AgentStatus;
	finalResult?: string;
	evaluationScore: number;
}

export interface BrowserUseResult {
	success: boolean;
	sessionId: string;
	task: BrowserTask;
	steps: BrowserStep[];
	finalPage?: PageState;
	extractedData: Record<string, unknown>;
	totalLatencyMs: number;
	evaluation: Record<string, unknown>;
	timestamp: string;
}

export interface JailbreakDBEntry {
	taskId: string;
	queryHash: string;
	model: string;
	bestAgent: string;
	success: boolean;
	finalOutput?: string;
	totalLatencyMs: number;
	totalCost: number;
	timestamp: string;
	metadata: Record<string, unknown>;
}

export interface ModelWeightEntry {
	model: string;
	successCount: number;
	failCount: number;
	avgLatencyMs: number;
	avgAsr: number;
	avgCost: number;
	updatedAt: string;
}
