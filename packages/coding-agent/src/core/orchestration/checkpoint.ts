export const CHECKPOINT_SCHEMA_VERSION = "omk.checkpoint.v1";

export type CheckpointStatus = "intake" | "running" | "blocked" | "complete" | "failed";
export type BlockerSeverity = "low" | "medium" | "high";

export interface GoalState {
	summary: string;
	status: CheckpointStatus;
}

export interface DecisionRecord {
	id: string;
	summary: string;
	artifactHashes: readonly string[];
}

export interface OpenTaskRecord {
	id: string;
	summary: string;
	priority: number;
}

export interface BlockerRecord {
	id: string;
	summary: string;
	severity: BlockerSeverity;
}

export interface FileState {
	read: readonly string[];
	modified: readonly string[];
}

export interface CommandRecord {
	command: string;
	exitCode: number;
	outputHash: string;
}

export interface ArtifactRecord {
	path: string;
	sha256: string;
	kind: string;
}

export interface FailedApproachRecord {
	summary: string;
	reason: string;
}

export interface ResumeActionRecord {
	summary: string;
	targetTaskId?: string;
}

export interface Checkpoint {
	schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
	checkpointId: string;
	runId: string;
	timestamp: string;
	currentGoal: GoalState;
	constraints: readonly string[];
	decisions: readonly DecisionRecord[];
	openTasks: readonly OpenTaskRecord[];
	blockers: readonly BlockerRecord[];
	files: FileState;
	commands: readonly CommandRecord[];
	artifacts: readonly ArtifactRecord[];
	failedApproaches: readonly FailedApproachRecord[];
	resumeAction: ResumeActionRecord;
}

export interface AuthoritativeCheckpointSource {
	commands: readonly CommandRecord[];
	blockerIds: readonly string[];
	filePaths: readonly string[];
	artifacts: readonly { path: string; sha256: string }[];
}

export interface CheckpointValidationResult {
	valid: boolean;
	errors: string[];
}

export interface ResumePlan {
	kind: "blocker" | "task" | "resumeAction";
	summary: string;
	targetId?: string;
}

export function renderCheckpointMarkdown(checkpoint: Checkpoint): string {
	const lines: string[] = [
		`# OMK Checkpoint ${checkpoint.checkpointId}`,
		`Run: ${checkpoint.runId}`,
		`Timestamp: ${checkpoint.timestamp}`,
		`Goal: ${checkpoint.currentGoal.summary} (${checkpoint.currentGoal.status})`,
		"",
		"## Constraints",
		...formatBullets(checkpoint.constraints),
		"",
		"## Decisions",
		...checkpoint.decisions.map(
			(decision) => `- ${decision.id}: ${decision.summary} [hashes: ${decision.artifactHashes.join(",") || "none"}]`,
		),
		"",
		"## Open Tasks",
		...checkpoint.openTasks.map((task) => `- ${task.id} p${task.priority}: ${task.summary}`),
		"",
		"## Blockers",
		...checkpoint.blockers.map((blocker) => `- ${blocker.id} ${blocker.severity}: ${blocker.summary}`),
		"",
		"## Files",
		`- read: ${checkpoint.files.read.join(",") || "none"}`,
		`- modified: ${checkpoint.files.modified.join(",") || "none"}`,
		"",
		"## Commands",
		...checkpoint.commands.map(
			(command) => `- ${command.command} => exitCode=${command.exitCode}, outputHash=${command.outputHash}`,
		),
		"",
		"## Artifacts",
		...checkpoint.artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.path} sha256=${artifact.sha256}`),
		"",
		"## Failed Approaches",
		...checkpoint.failedApproaches.map((approach) => `- ${approach.summary}: ${approach.reason}`),
		"",
		`Resume: ${checkpoint.resumeAction.summary}${checkpoint.resumeAction.targetTaskId ? ` (${checkpoint.resumeAction.targetTaskId})` : ""}`,
	];
	return `${lines.join("\n")}\n`;
}

export function validateCheckpoint(
	checkpoint: Checkpoint,
	authoritative: AuthoritativeCheckpointSource,
): CheckpointValidationResult {
	const errors: string[] = [];
	validateCommands(checkpoint, authoritative, errors);
	validateBlockers(checkpoint, authoritative, errors);
	validateFiles(checkpoint, authoritative, errors);
	validateArtifacts(checkpoint, authoritative, errors);
	return { valid: errors.length === 0, errors };
}

export function deriveResumePlan(checkpoint: Checkpoint): ResumePlan {
	const blocker = [...checkpoint.blockers].sort(compareBlockerPriority)[0];
	if (blocker !== undefined) {
		return { kind: "blocker", summary: blocker.summary, targetId: blocker.id };
	}

	const task = [...checkpoint.openTasks].sort(compareTaskPriority)[0];
	if (task !== undefined) {
		return { kind: "task", summary: task.summary, targetId: task.id };
	}

	return {
		kind: "resumeAction",
		summary: checkpoint.resumeAction.summary,
		targetId: checkpoint.resumeAction.targetTaskId,
	};
}

export function enforceCheckpointBudget(markdown: string, maxChars: number): string {
	if (markdown.length <= maxChars) {
		return markdown;
	}

	const goal = findLine(markdown, "Goal:") ?? "Goal: unknown";
	const resume = findLine(markdown, "Resume:") ?? "Resume: unknown";
	const compact = [`# OMK Checkpoint`, goal, "Evidence hashes preserved.", resume].join("\n");
	if (compact.length <= maxChars) {
		return compact;
	}
	return compact.slice(0, Math.max(0, maxChars));
}

function validateCommands(
	checkpoint: Checkpoint,
	authoritative: AuthoritativeCheckpointSource,
	errors: string[],
): void {
	const byCommand = new Map(authoritative.commands.map((command) => [command.command, command]));
	for (const command of checkpoint.commands) {
		const expected = byCommand.get(command.command);
		if (expected === undefined) {
			errors.push(`command missing from authoritative source: ${command.command}`);
			continue;
		}
		if (command.exitCode !== expected.exitCode) {
			errors.push(`command exitCode mismatch for ${command.command}: ${command.exitCode} != ${expected.exitCode}`);
		}
		if (command.outputHash !== expected.outputHash) {
			errors.push(
				`command outputHash mismatch for ${command.command}: ${command.outputHash} != ${expected.outputHash}`,
			);
		}
	}
}

function validateBlockers(
	checkpoint: Checkpoint,
	authoritative: AuthoritativeCheckpointSource,
	errors: string[],
): void {
	const authoritativeIds = new Set(authoritative.blockerIds);
	for (const blocker of checkpoint.blockers) {
		if (!authoritativeIds.has(blocker.id)) {
			errors.push(`blocker not present in authoritative source: ${blocker.id}`);
		}
	}
}

function validateFiles(checkpoint: Checkpoint, authoritative: AuthoritativeCheckpointSource, errors: string[]): void {
	const authoritativePaths = new Set(authoritative.filePaths);
	for (const filePath of [...checkpoint.files.read, ...checkpoint.files.modified]) {
		if (!authoritativePaths.has(filePath)) {
			errors.push(`file path not present in authoritative source: ${filePath}`);
		}
	}
}

function validateArtifacts(
	checkpoint: Checkpoint,
	authoritative: AuthoritativeCheckpointSource,
	errors: string[],
): void {
	const byPath = new Map(authoritative.artifacts.map((artifact) => [artifact.path, artifact]));
	for (const artifact of checkpoint.artifacts) {
		const expected = byPath.get(artifact.path);
		if (expected === undefined) {
			errors.push(`artifact missing from authoritative source: ${artifact.path}`);
			continue;
		}
		if (artifact.sha256 !== expected.sha256) {
			errors.push(`artifact sha256 mismatch for ${artifact.path}: ${artifact.sha256} != ${expected.sha256}`);
		}
	}
}

function formatBullets(values: readonly string[]): string[] {
	if (values.length === 0) {
		return ["- none"];
	}
	return values.map((value) => `- ${value}`);
}

function blockerRank(severity: BlockerSeverity): number {
	if (severity === "high") return 0;
	if (severity === "medium") return 1;
	return 2;
}

function compareBlockerPriority(a: BlockerRecord, b: BlockerRecord): number {
	const rank = blockerRank(a.severity) - blockerRank(b.severity);
	if (rank !== 0) return rank;
	return compareString(a.id, b.id);
}

function compareTaskPriority(a: OpenTaskRecord, b: OpenTaskRecord): number {
	if (a.priority !== b.priority) return a.priority - b.priority;
	return compareString(a.id, b.id);
}

function compareString(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function findLine(markdown: string, prefix: string): string | undefined {
	return markdown.split("\n").find((line) => line.startsWith(prefix));
}
