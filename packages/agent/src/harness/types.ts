import type { ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentMessage, AgentTool, ThinkingLevel } from "../index.js";
import type { Session } from "./session/session.js";

/** Model-visible skill loaded from a `SKILL.md` file or provided by an application. */
export interface Skill {
	/** Skill command name. */
	name: string;
	/** Short model-visible description of when to use the skill. */
	description: string;
	/** Full skill instructions. */
	content: string;
	/** Absolute path to the skill file. Used for model-visible location and resolving relative references. */
	filePath: string;
	/** Exclude this skill from model-visible skill lists while still allowing explicit application invocation. */
	disableModelInvocation?: boolean;
}

/** Prompt template that can expand slash-command text before a prompt is sent. */
export interface PromptTemplate {
	/** Slash-command name without the leading `/`. */
	name: string;
	/** Optional description for command lists or autocomplete. */
	description?: string;
	/** Template content. Argument placeholders are expanded by `formatPromptTemplateInvocation`. */
	content: string;
}

/** Resources made available to harness prompt expansion and system-prompt callbacks. */
export interface AgentHarnessResources {
	/** Prompt templates used to expand `/template args` input. */
	promptTemplates?: PromptTemplate[];
	/** Skills available to the model and explicit skill invocation. */
	skills?: Skill[];
}

/** Kind of filesystem object as addressed by an {@link ExecutionEnv}. Symlinks are not followed automatically. */
export type FileKind = "file" | "directory" | "symlink";

/** Stable, backend-independent file error codes thrown by {@link ExecutionEnv} file operations. */
export type FileErrorCode =
	| "not_found"
	| "permission_denied"
	| "not_directory"
	| "is_directory"
	| "invalid"
	| "not_supported"
	| "unknown";

/** Error thrown by {@link ExecutionEnv} file operations. */
export class FileError extends Error {
	constructor(
		/** Backend-independent error code. */
		public code: FileErrorCode,
		message: string,
		/** Absolute addressed path associated with the failure, when available. */
		public path?: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "FileError";
	}
}

/** Metadata for one filesystem object in an {@link ExecutionEnv}. */
export interface FileInfo {
	/** Basename of {@link path}. */
	name: string;
	/** Absolute, syntactically normalized addressed path in the execution environment. Symlinks are not followed. */
	path: string;
	/** Object kind. Symlink targets are not followed; use {@link ExecutionEnv.resolvePath} explicitly. */
	kind: FileKind;
	/** Size in bytes for the addressed filesystem object. */
	size: number;
	/** Modification time as milliseconds since Unix epoch. */
	mtimeMs: number;
}

/** Options for {@link ExecutionEnv.exec}. */
export interface ExecutionEnvExecOptions {
	/** Working directory for the command. Relative paths are resolved against {@link ExecutionEnv.cwd}. */
	cwd?: string;
	/** Additional environment variables for the command. Values override the environment defaults. */
	env?: Record<string, string>;
	/** Timeout in seconds. Implementations should reject when the command exceeds this duration. */
	timeout?: number;
	/** Abort signal used to terminate the command. */
	signal?: AbortSignal;
	/** Called with stdout chunks as they are produced. */
	onStdout?: (chunk: string) => void;
	/** Called with stderr chunks as they are produced. */
	onStderr?: (chunk: string) => void;
}

/**
 * Filesystem and process execution environment used by the harness.
 *
 * Paths passed to methods may be absolute or relative to {@link cwd}. Paths returned by this interface are absolute
 * addressed paths in the environment, but are not canonicalized through symlinks unless returned by {@link resolvePath}.
 *
 * File operations throw {@link FileError} for expected filesystem failures such as missing paths or permission errors.
 */
export interface ExecutionEnv {
	/** Current working directory for relative paths and command execution. */
	cwd: string;

	/** Execute a shell command in {@link cwd} unless `options.cwd` is provided. */
	exec(
		command: string,
		options?: ExecutionEnvExecOptions,
	): Promise<{ stdout: string; stderr: string; exitCode: number }>;

	/** Read a UTF-8 text file. Throws {@link FileError}. */
	readTextFile(path: string): Promise<string>;
	/** Read a binary file. Throws {@link FileError}. */
	readBinaryFile(path: string): Promise<Uint8Array>;
	/** Create or overwrite a file, creating parent directories when supported. Throws {@link FileError}. */
	writeFile(path: string, content: string | Uint8Array): Promise<void>;
	/** Return metadata for the addressed path without following symlinks. Throws {@link FileError}. */
	fileInfo(path: string): Promise<FileInfo>;
	/** List direct children of a directory without following symlinks. Throws {@link FileError}. */
	listDir(path: string): Promise<FileInfo[]>;
	/** Return the canonical path for a path, following symlinks. Throws {@link FileError}. */
	realPath(path: string): Promise<string>;
	/** Return false for missing paths. Other errors, such as permission failures, may throw {@link FileError}. */
	exists(path: string): Promise<boolean>;
	/** Create a directory. */
	createDir(path: string, options?: { recursive?: boolean }): Promise<void>;
	/** Remove a file or directory. */
	remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
	/** Create a temporary directory and return its absolute path. */
	createTempDir(prefix?: string): Promise<string>;
	/** Create a temporary file and return its absolute path. */
	createTempFile(options?: { prefix?: string; suffix?: string }): Promise<string>;

	/** Release resources owned by the environment. */
	cleanup(): Promise<void>;
}

export interface SessionTreeEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface MessageEntry extends SessionTreeEntryBase {
	type: "message";
	message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionTreeEntryBase {
	type: "thinking_level_change";
	thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionTreeEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface CompactionEntry<T = unknown> extends SessionTreeEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: T;
	fromHook?: boolean;
}

export interface BranchSummaryEntry<T = unknown> extends SessionTreeEntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
	details?: T;
	fromHook?: boolean;
}

export interface CustomEntry<T = unknown> extends SessionTreeEntryBase {
	type: "custom";
	customType: string;
	data?: T;
}

export interface CustomMessageEntry<T = unknown> extends SessionTreeEntryBase {
	type: "custom_message";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	details?: T;
	display: boolean;
}

export interface LabelEntry extends SessionTreeEntryBase {
	type: "label";
	targetId: string;
	label: string | undefined;
}

export interface SessionInfoEntry extends SessionTreeEntryBase {
	type: "session_info"; // legacy name, kept for backwards compatibility
	name?: string;
}

export type SessionTreeEntry =
	| MessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| CustomEntry
	| CustomMessageEntry
	| LabelEntry
	| SessionInfoEntry;

export interface SessionContext {
	messages: AgentMessage[];
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
}

export interface SessionMetadata {
	id: string;
	createdAt: string;
}

export interface JsonlSessionMetadata extends SessionMetadata {
	cwd: string;
	path: string;
	parentSessionPath?: string;
}

export interface SessionStorage<TMetadata extends SessionMetadata = SessionMetadata> {
	getMetadata(): Promise<TMetadata>;
	getLeafId(): Promise<string | null>;
	setLeafId(leafId: string | null): Promise<void>;
	createEntryId(): Promise<string>;
	appendEntry(entry: SessionTreeEntry): Promise<void>;
	getEntry(id: string): Promise<SessionTreeEntry | undefined>;
	findEntries<TType extends SessionTreeEntry["type"]>(
		type: TType,
	): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>>;
	getLabel(id: string): Promise<string | undefined>;
	getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
	getEntries(): Promise<SessionTreeEntry[]>;
}

export type { Session } from "./session/session.js";

export interface SessionCreateOptions {
	id?: string;
}

export interface SessionForkOptions {
	entryId?: string;
	position?: "before" | "at";
	id?: string;
}

export interface SessionRepo<
	TMetadata extends SessionMetadata = SessionMetadata,
	TCreateOptions extends SessionCreateOptions = SessionCreateOptions,
	TListOptions = void,
> {
	create(options: TCreateOptions): Promise<Session<TMetadata>>;
	open(metadata: TMetadata): Promise<Session<TMetadata>>;
	list(options?: TListOptions): Promise<TMetadata[]>;
	delete(metadata: TMetadata): Promise<void>;
	fork(source: TMetadata, options: SessionForkOptions & TCreateOptions): Promise<Session<TMetadata>>;
}

export interface JsonlSessionCreateOptions extends SessionCreateOptions {
	cwd: string;
	parentSessionPath?: string;
}

export interface JsonlSessionListOptions {
	cwd?: string;
}

export interface JsonlSessionRepoApi
	extends SessionRepo<JsonlSessionMetadata, JsonlSessionCreateOptions, JsonlSessionListOptions> {}

export interface AgentHarnessPendingMutations {
	appendMessages: AgentMessage[];
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
	activeToolNames?: string[];
}

export interface AgentHarnessConversationState {
	session: Session;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	activeToolNames: string[];
	nextTurnQueue: AgentMessage[];
}

export interface AgentHarnessOperationState {
	idle: boolean;
	liveOperationId?: string;
	abortRequested: boolean;
	steerQueue: AgentMessage[];
	followUpQueue: AgentMessage[];
	pendingMutations: AgentHarnessPendingMutations;
}

export interface SavePointSnapshot {
	messages: AgentMessage[];
	model: Model<any> | undefined;
	thinkingLevel: ThinkingLevel;
	activeToolNames: string[];
	systemPrompt: string;
}

export interface AgentHarnessContext {
	env: ExecutionEnv;
	conversation: AgentHarnessConversationState;
	operation: AgentHarnessOperationState;
	abortSignal?: AbortSignal;
}

export interface QueueUpdateEvent {
	type: "queue_update";
	steer: AgentMessage[];
	followUp: AgentMessage[];
	nextTurn: AgentMessage[];
}

export interface SavePointEvent {
	type: "save_point";
	liveOperationId: string;
	hadPendingMutations: boolean;
}

export interface AbortEvent {
	type: "abort";
	clearedSteer: AgentMessage[];
	clearedFollowUp: AgentMessage[];
}

export interface SettledEvent {
	type: "settled";
	nextTurnCount: number;
}

export interface BeforeAgentStartEvent {
	type: "before_agent_start";
	prompt: string;
	images?: ImageContent[];
	systemPrompt: string;
	resources: AgentHarnessResources;
}

export interface ContextEvent {
	type: "context";
	messages: AgentMessage[];
}

export interface BeforeProviderRequestEvent {
	type: "before_provider_request";
	payload: unknown;
}

export interface AfterProviderResponseEvent {
	type: "after_provider_response";
	status: number;
	headers: Record<string, string>;
}

export interface ToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
}

export interface ToolResultEvent {
	type: "tool_result";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	content: Array<TextContent | ImageContent>;
	details: unknown;
	isError: boolean;
}

export interface SessionBeforeCompactEvent {
	type: "session_before_compact";
	preparation: CompactionPreparation;
	branchEntries: SessionTreeEntry[];
	customInstructions?: string;
	signal: AbortSignal;
}

export interface SessionCompactEvent {
	type: "session_compact";
	compactionEntry: CompactionEntry;
	fromHook: boolean;
}

export interface SessionBeforeTreeEvent {
	type: "session_before_tree";
	preparation: TreePreparation;
	signal: AbortSignal;
}

export interface SessionTreeEvent {
	type: "session_tree";
	newLeafId: string | null;
	oldLeafId: string | null;
	summaryEntry?: BranchSummaryEntry;
	fromHook?: boolean;
}

export interface ModelSelectEvent {
	type: "model_select";
	model: Model<any>;
	previousModel: Model<any> | undefined;
	source: "set" | "restore";
}

export interface ThinkingLevelSelectEvent {
	type: "thinking_level_select";
	level: ThinkingLevel;
	previousLevel: ThinkingLevel;
}

export type AgentHarnessOwnEvent =
	| QueueUpdateEvent
	| SavePointEvent
	| AbortEvent
	| SettledEvent
	| BeforeAgentStartEvent
	| ContextEvent
	| BeforeProviderRequestEvent
	| AfterProviderResponseEvent
	| ToolCallEvent
	| ToolResultEvent
	| SessionBeforeCompactEvent
	| SessionCompactEvent
	| SessionBeforeTreeEvent
	| SessionTreeEvent
	| ModelSelectEvent
	| ThinkingLevelSelectEvent;

export type AgentHarnessEvent = AgentEvent | AgentHarnessOwnEvent;

export interface BeforeAgentStartResult {
	messages?: AgentMessage[];
	systemPrompt?: string;
}

export interface ContextResult {
	messages: AgentMessage[];
}

export interface BeforeProviderRequestResult {
	payload: unknown;
}

export interface ToolCallResult {
	block?: boolean;
	reason?: string;
}

export interface ToolResultPatch {
	content?: Array<TextContent | ImageContent>;
	details?: unknown;
	isError?: boolean;
	terminate?: boolean;
}

export interface SessionBeforeCompactResult {
	cancel?: boolean;
	compaction?: CompactResult;
}

export interface SessionBeforeTreeResult {
	cancel?: boolean;
	summary?: { summary: string; details?: unknown };
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export type AgentHarnessEventResultMap = {
	before_agent_start: BeforeAgentStartResult | undefined;
	context: ContextResult | undefined;
	before_provider_request: BeforeProviderRequestResult | undefined;
	after_provider_response: undefined;
	tool_call: ToolCallResult | undefined;
	tool_result: ToolResultPatch | undefined;
	session_before_compact: SessionBeforeCompactResult | undefined;
	session_compact: undefined;
	session_before_tree: SessionBeforeTreeResult | undefined;
	session_tree: undefined;
	model_select: undefined;
	thinking_level_select: undefined;
	queue_update: undefined;
	save_point: undefined;
	abort: undefined;
	settled: undefined;
};

export interface AgentHarnessPromptOptions {
	images?: ImageContent[];
}

export interface AbortResult {
	clearedSteer: AgentMessage[];
	clearedFollowUp: AgentMessage[];
}

export interface CompactResult {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: unknown;
}

export interface NavigateTreeResult {
	cancelled: boolean;
	editorText?: string;
	summaryEntry?: BranchSummaryEntry;
}

export interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export interface CompactionPreparation {
	firstKeptEntryId: string;
	messagesToSummarize: AgentMessage[];
	turnPrefixMessages: AgentMessage[];
	isSplitTurn: boolean;
	tokensBefore: number;
	previousSummary?: string;
	fileOps: FileOperations;
	settings: CompactionSettings;
}

export interface FileOperations {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

export interface TreePreparation {
	targetId: string;
	oldLeafId: string | null;
	commonAncestorId: string | null;
	entriesToSummarize: SessionTreeEntry[];
	userWantsSummary: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export interface GenerateBranchSummaryOptions {
	model: Model<any>;
	apiKey: string;
	headers?: Record<string, string>;
	signal: AbortSignal;
	customInstructions?: string;
	replaceInstructions?: boolean;
	reserveTokens?: number;
}

export interface BranchSummaryResult {
	summary?: string;
	readFiles?: string[];
	modifiedFiles?: string[];
	aborted?: boolean;
	error?: string;
}

export interface AgentHarnessOptions {
	env: ExecutionEnv;
	session: Session;
	tools?: AgentTool[];
	resources?:
		| AgentHarnessResources
		| ((context: AgentHarnessContext) => AgentHarnessResources | Promise<AgentHarnessResources>);
	systemPrompt?:
		| string
		| ((context: {
				env: ExecutionEnv;
				session: Session;
				model: Model<any>;
				thinkingLevel: ThinkingLevel;
				activeTools: AgentTool[];
				resources: AgentHarnessResources;
		  }) => string | Promise<string>);
	requestAuth?: (model: Model<any>) => Promise<{ apiKey: string; headers?: Record<string, string> } | undefined>;
	model: Model<any>;
	thinkingLevel?: ThinkingLevel;
	activeToolNames?: string[];
}

export type { AgentHarness } from "./agent-harness.js";
