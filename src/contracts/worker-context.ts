export type OmkRuntimeScope = "all" | "project" | "none";

export interface GoalExecutionContext {
  readonly runId: string;
  readonly goalId?: string;
  readonly objective?: string;
  readonly root: string;
  readonly mcpScope: OmkRuntimeScope;
  readonly skillsScope: OmkRuntimeScope;
  readonly hooksScope: OmkRuntimeScope;
}

export interface WorkerProviderManifest {
  readonly preferred: readonly string[];
  readonly fallbackChain: readonly string[];
  readonly selectedRuntimeId?: string;
  readonly model?: string;
}

export interface WorkerToolPlaneManifest {
  readonly mcpServers: readonly string[];
  readonly mcpConfigFile?: string;
  readonly skills: readonly string[];
  readonly hooks: readonly string[];
  readonly tools: readonly string[];
  readonly requiresRuntimeMcp: boolean;
}

export interface WorkerCapabilityManifest {
  readonly read: boolean;
  readonly write: boolean;
  readonly shell: boolean;
  readonly mcp: boolean;
  readonly patch: boolean;
  readonly review: boolean;
  readonly merge: boolean;
  readonly vision: boolean;
  readonly toolCalling?: boolean;
  readonly maxTokens?: number;
}

export interface WorkerManifestArtifacts {
  readonly harnessPath?: string;
  readonly agentYamlPath?: string;
  readonly logPath?: string;
}

export interface WorkerManifest {
  readonly schemaVersion: 1;
  readonly owner: "omk";
  readonly runId: string;
  readonly nodeId: string;
  readonly role?: string;
  readonly provider: WorkerProviderManifest;
  readonly toolPlane: WorkerToolPlaneManifest;
  readonly capabilities: WorkerCapabilityManifest;
  readonly artifacts: WorkerManifestArtifacts;
  readonly createdAt: string;
}

export interface TaskRunContext {
  readonly goal: GoalExecutionContext;
  readonly worker: WorkerManifest;
}
