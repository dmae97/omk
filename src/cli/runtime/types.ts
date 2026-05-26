/**
 * Phase 1 — CLI Runtime Types
 * Normalized command envelope, output profile, execution result, and errors.
 * Based on the CLI architecture redesign spec (2026-05-25).
 */

export type CommandKind =
  | "run"
  | "task"
  | "plan"
  | "chat"
  | "provider"
  | "theme"
  | "doctor";

export type InputSource =
  | "argv"
  | "stdin"
  | "file"
  | "editor"
  | "interactive"
  | "nl-command";

export type OutputFormat =
  | "json"
  | "jsonl"
  | "markdown"
  | "nlp"
  | "silent"
  | "dashboard";

export interface NormalizedInput {
  readonly source: InputSource;
  readonly goal?: string;
  readonly goalFile?: string;
  readonly teamFile?: string;
  readonly taskFile?: string;
  readonly orchestratorFile?: string;
  readonly coordinatorFile?: string;
  readonly rawArgs: readonly string[];
  readonly metadata: {
    readonly cwd: string;
    readonly invokedAt: string;
    readonly isTty: boolean;
  };
}

export interface OutputProfile {
  readonly format: OutputFormat;
  readonly pretty: boolean;
  readonly includeMessages: boolean;
  readonly includeTrace: boolean;
  readonly stream: boolean;
  readonly destination: "stdout" | "file";
  readonly outputFile?: string;
}

export interface ResolvedTheme {
  readonly name: string;
  readonly mode: "dark" | "light" | "auto" | "mono";
}

export interface RuntimeOptions {
  readonly runId?: string;
  readonly workers?: string;
  readonly provider?: string;
  readonly sudo?: boolean;
}

export interface CliResolvedConfig {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly projectConfig?: Record<string, unknown>;
  readonly userConfig?: Record<string, unknown>;
}

export interface CommandEnvelope {
  readonly kind: CommandKind;
  readonly input: NormalizedInput;
  readonly config: CliResolvedConfig;
  readonly output: OutputProfile;
  readonly theme: ResolvedTheme;
  readonly runtime: RuntimeOptions;
}

export type CliErrorKind =
  | "usage"
  | "validation"
  | "io"
  | "provider"
  | "runtime"
  | "theme"
  | "internal";

export interface NormalizedCliError {
  readonly kind: CliErrorKind;
  readonly message: string;
  readonly cause?: unknown;
  readonly hint?: string;
  readonly docsUrl?: string;
}

export interface TokenUsageSummary {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly model?: string;
}

export type NormalizedRunEvent =
  | AgentStartedEvent
  | AgentCompletedEvent
  | ProviderRequestStartedEvent
  | ProviderRequestCompletedEvent
  | ProviderRequestFailedEvent
  | ProviderFallbackEvent
  | ProviderAssistEvent
  | ProviderSkipEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | ToolCalledEvent
  | TokenUsageEvent
  | TraceSpanEvent
  | ApprovalRequestedEvent;

export interface AgentStartedEvent {
  readonly type: "agent-started";
  readonly agentName: string;
  readonly timestamp: string;
}

export interface AgentCompletedEvent {
  readonly type: "agent-completed";
  readonly agentName: string;
  readonly success: boolean;
  readonly timestamp: string;
}

export interface ProviderRequestStartedEvent {
  readonly type: "provider-request-started";
  readonly provider: string;
  readonly taskId: string;
  readonly taskTitle?: string;
  readonly role?: string;
  readonly requestedProvider?: string;
  readonly authority?: string;
  readonly reason?: string;
  readonly timestamp: string;
}

export interface ProviderRequestCompletedEvent {
  readonly type: "provider-request-completed";
  readonly provider: string;
  readonly taskId: string;
  readonly taskTitle?: string;
  readonly role?: string;
  readonly requestedProvider?: string;
  readonly authority?: string;
  readonly durationMs?: number;
  readonly attempts?: number;
  readonly timestamp: string;
}

export interface ProviderRequestFailedEvent {
  readonly type: "provider-request-failed";
  readonly provider: string;
  readonly taskId: string;
  readonly taskTitle?: string;
  readonly role?: string;
  readonly requestedProvider?: string;
  readonly authority?: string;
  readonly durationMs?: number;
  readonly attempts?: number;
  readonly error: string;
  readonly timestamp: string;
}

export interface ProviderFallbackEvent {
  readonly type: "provider-fallback";
  readonly taskId: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly attempts?: number;
  readonly failureKind?: string;
  readonly timestamp: string;
}

export interface ProviderAssistEvent {
  readonly type: "provider-assist";
  readonly taskId: string;
  readonly provider: string;
  readonly participation: "advisory";
  readonly success: boolean;
  readonly model?: string;
  readonly modelTier?: string;
  readonly summary?: string;
  readonly failureReason?: string;
  readonly timestamp: string;
}

export interface ProviderSkipEvent {
  readonly type: "provider-skip";
  readonly taskId: string;
  readonly provider: string;
  readonly reason: string;
  readonly attempts?: number;
  readonly failureKind?: string;
  readonly timestamp: string;
}

export interface TaskStartedEvent {
  readonly type: "task-started";
  readonly taskId: string;
  readonly taskTitle: string;
  readonly timestamp: string;
}

export interface TaskCompletedEvent {
  readonly type: "task-completed";
  readonly taskId: string;
  readonly taskTitle: string;
  readonly timestamp: string;
}

export interface TaskFailedEvent {
  readonly type: "task-failed";
  readonly taskId: string;
  readonly taskTitle: string;
  readonly error: string;
  readonly timestamp: string;
}

export interface ToolCalledEvent {
  readonly type: "tool-called";
  readonly toolName: string;
  readonly args: unknown;
  readonly timestamp: string;
}

export interface TokenUsageEvent {
  readonly type: "token-usage";
  readonly usage: TokenUsageSummary;
  readonly timestamp: string;
}

export interface TraceSpanEvent {
  readonly type: "trace-span";
  readonly spanName: string;
  readonly durationMs: number;
  readonly timestamp: string;
}

export interface ApprovalRequestedEvent {
  readonly type: "approval-requested";
  readonly action: string;
  readonly timestamp: string;
}

export interface CliExecutionResult {
  readonly command: CommandKind;
  readonly success: boolean;
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly result?: unknown;
  readonly events: readonly NormalizedRunEvent[];
  readonly error?: NormalizedCliError;
  readonly tokenUsage?: TokenUsageSummary;
}

export type TaskStatus = "running" | "pending" | "completed" | "failed";

export interface NlpRenderInput {
  readonly command: "run" | "task" | "plan";
  readonly success: boolean;
  readonly goal?: string;
  readonly result: unknown;
  readonly events: readonly NormalizedRunEvent[];
  readonly tokenUsage?: TokenUsageSummary;
  readonly errors: readonly NormalizedCliError[];
}

export interface RenderedOutput {
  readonly format: OutputFormat;
  readonly content: string;
  readonly sourceResultHash: string;
  readonly generatedAt: string;
}
