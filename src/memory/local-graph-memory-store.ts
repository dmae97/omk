import { createHash } from "crypto";
import { statSync } from "fs";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import {
  loadMemorySettings,
  summarizeMemorySettings,
  usesLocalGraphBackend,
  type MemorySettings,
  type MemoryStatus,
} from "./memory-config.js";
import type { RunManifest } from "../contracts/run.js";
import {
  appendDelta,
  compactIfNeeded,
  computeDelta,
  deltaStatsMatch,
  loadStateViaDelta,
  readManifest,
  resolveCompactionThresholds,
  resolveDurabilityMode,
  setupDeltaMode,
  statDeltaFiles,
  withDeltaLock,
  type DeltaFileStats,
  type DeltaManifest,
  type DurabilityMode,
} from "./graph-delta-log.js";

export interface MemorySearchResult {
  path: string;
  content: string;
  sessionId: string;
  updatedAt: string;
  source: string;
}

export interface MemoryOntology {
  version: string;
  classes: string[];
  relationTypes: string[];
  description: string;
}

export interface MemoryMindmapNode {
  id: string;
  type: string;
  label: string;
  path?: string;
  summary?: string;
  children: MemoryMindmapNode[];
}

export interface MemoryMindmap {
  root: MemoryMindmapNode;
  nodes: Array<Omit<MemoryMindmapNode, "children">>;
  edges: Array<{ from: string; to: string; type: string; label?: string }>;
  ontology: MemoryOntology;
}

export interface GraphQueryResult {
  data: unknown;
  extensions: {
    dialect: "omk-graphql-lite-v1" | "cypher";
    backend: "local_graph" | "kuzu";
    statePath?: string;
    database?: string;
  };
}

export interface LocalGraphMemoryStoreOptions {
  projectRoot?: string;
  sessionId?: string;
  source?: string;
  env?: NodeJS.ProcessEnv;
}

type Primitive = string | number | boolean | null;
type Properties = Record<string, Primitive>;

export interface LocalGraphNode {
  id: string;
  type: string;
  labels: string[];
  label: string;
  path?: string;
  content?: string;
  summary?: string;
  tags: string[];
  properties: Properties;
  createdAt: string;
  updatedAt: string;
}

export interface LocalGraphEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  label?: string;
  weight?: number;
  properties: Properties;
  createdAt: string;
  updatedAt: string;
}

export interface LocalGraphState {
  version: 1;
  ontology: MemoryOntology;
  project: {
    key: string;
    name: string;
    root: string;
  };
  updatedAt: string;
  nodes: LocalGraphNode[];
  edges: LocalGraphEdge[];
}

export type GraphState = LocalGraphState;

export interface ExtractedConcept {
  type: string;
  label: string;
  summary: string;
  parentIndex?: number;
  relation: string;
  tags: string[];
  line: number;
  level?: number;
  filePaths: string[];
}

export const ONTOLOGY: MemoryOntology = {
  version: "omk-ontology-mindmap-v1",
  description:
    "Project-local ontology for Kimi/OMK memory. Memories are decomposed into mind-map nodes for goals, topics, decisions, tasks, risks, commands, files, evidence, provider routes, provider fallbacks, questions, answers, constraints, and concepts.",
  classes: [
    "Project",
    "Session",
    "Memory",
    "MemoryVersion",
    "Run",
    "Goal",
    "Topic",
    "Decision",
    "Task",
    "Risk",
    "Command",
    "File",
    "Evidence",
    "EvidenceRequirement",
    "EvidenceObservation",
    "Artifact",
    "HeadroomDecision",
    "Provider",
    "ProviderRoute",
    "ProviderFallback",
    "AuditLink",
    "Constraint",
    "Question",
    "Answer",
    "Concept",
  ],
  relationTypes: [
    "HAS_SESSION",
    "HAS_MEMORY",
    "HAS_RUN",
    "WROTE",
    "UPDATES",
    "HAS_GOAL",
    "HAS_TOPIC",
    "HAS_DECISION",
    "HAS_TASK",
    "HAS_TURN",
    "HAS_RISK",
    "HAS_COMMAND",
    "HAS_FILE",
    "HAS_EVIDENCE",
    "HAS_HEADROOM_DECISION",
    "USES_PROVIDER",
    "HAS_PROVIDER_ROUTE",
    "ROUTES_TO",
    "FALLS_BACK_TO",
    "HAS_PROVIDER_FALLBACK",
    "HAS_AUDIT_LINK",
    "LINKS_TO",
    "HAS_CONSTRAINT",
    "HAS_QUESTION",
    "HAS_ANSWER",
    "HAS_CONCEPT",
    "CHILD_OF",
    "PART_OF",
    "DEPENDS_ON",
    "BLOCKED_BY",
    "EVIDENCED_BY",
    "STORED_AT",
    "TOUCHES_FILE",
  ],
};

const GENERATED_TYPES = new Set([
  "Run",
  "Goal",
  "Topic",
  "Decision",
  "Task",
  "Risk",
  "Command",
  "File",
  "Evidence",
  "EvidenceRequirement",
  "EvidenceObservation",
  "Artifact",
  "HeadroomDecision",
  "Provider",
  "ProviderRoute",
  "ProviderFallback",
  "AuditLink",
  "Constraint",
  "Question",
  "Answer",
  "Concept",
]);

const CANONICAL_NODE_TYPES = new Set([
  "File",
  "Symbol",
  "Decision",
  "Risk",
  "Evidence",
  "EvidenceRequirement",
  "EvidenceObservation",
  "Artifact",
  "HeadroomDecision",
  "Goal",
  "Run",
  "Task",
  "MCPServer",
  "Skill",
  "Provider",
  "ProviderRoute",
  "ProviderFallback",
  "AuditLink",
]);

interface InvalidGraphStateRepair {
  backupPath: string;
  signalPath: string;
  reason: string;
}

const graphWriteQueues = new Map<string, Promise<void>>();

interface GraphStateCacheEntry {
  state: LocalGraphState;
  mtimeMs: number;
  size: number;
  ctimeMs: number;
  ino: number;
  /** Delta-mode stats for snapshot + delta file change detection */
  deltaStats?: DeltaFileStats | null;
  deltaEpoch?: number;
  deltaOpCount?: number;
  deltaLastSeq?: number;
}

/**
 * Process-local cache of the most-recently-persisted parsed graph state, keyed
 * by graph-state.json path. A cache hit is only honored when the on-disk file
 * is unchanged on ALL of mtimeMs + size + ctimeMs + inode since the cached
 * snapshot was written. ctimeMs catches a same-millisecond, same-size overwrite
 * that mtimeMs+size alone would miss, and inode catches an atomic-rename replace
 * (new file) — so any concurrent external writer forces a fresh disk re-read
 * (multi-writer safe). The entry is populated exclusively from a state we just
 * wrote via saveState, so it never masks loadState's ENOENT / empty / invalid /
 * strict-mode handling.
 */
const graphStateCache = new Map<string, GraphStateCacheEntry>();

function statSyncSafe(
  path: string,
): { mtimeMs: number; size: number; ctimeMs: number; ino: number } | undefined {
  try {
    const stat = statSync(path);
    return { mtimeMs: stat.mtimeMs, size: stat.size, ctimeMs: stat.ctimeMs, ino: stat.ino };
  } catch {
    return undefined;
  }
}

function enqueueGraphWrite<T>(graphPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = graphWriteQueues.get(graphPath) ?? Promise.resolve();
  const running = previous.catch(() => undefined).then(operation);
  const release = running.then(
    () => undefined,
    () => undefined
  );
  graphWriteQueues.set(graphPath, release);
  return running.finally(() => {
    if (graphWriteQueues.get(graphPath) === release) {
      graphWriteQueues.delete(graphPath);
    }
  });
}

function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function writeFileAtomic(path: string, payload: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.${hash(payload).slice(0, 8)}.tmp`;
  try {
    await writeFile(tempPath, payload, "utf-8");
    await rename(tempPath, path);
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw err;
  }
}

export class LocalGraphMemoryStore {
  private readonly durability: DurabilityMode;
  private deltaEpoch = 0;
  private deltaLastSeq = 0;
  private deltaOpCount = 0;
  private deltaManifest: DeltaManifest | null = null;

  constructor(
    private readonly settings: MemorySettings,
    private readonly source = "omk-local-graph-memory",
    private readonly env?: NodeJS.ProcessEnv
  ) {
    this.durability = resolveDurabilityMode(env);
  }

  static async create(options: LocalGraphMemoryStoreOptions = {}): Promise<LocalGraphMemoryStore | null> {
    const env = options.sessionId
      ? { ...(options.env ?? process.env), OMK_SESSION_ID: options.sessionId }
      : options.env ?? process.env;
    const settings = await loadMemorySettings(options.projectRoot, env);
    if (!usesLocalGraphBackend(settings.backend)) return null;
    return new LocalGraphMemoryStore(settings, options.source ?? "omk-local-graph-memory", env);
  }

  get status(): MemoryStatus {
    return summarizeMemorySettings(this.settings);
  }

  get strict(): boolean {
    return this.settings.strict;
  }

  get mirrorFiles(): boolean {
    return this.settings.mirrorFiles;
  }

  get migrateFiles(): boolean {
    return this.settings.migrateFiles;
  }

  async read(path: string): Promise<string> {
    const state = await this.loadState();
    return this.readFromState(state, path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.mutateState((state, now) => {
      this.applyMemoryWrite(state, path, content, now);
    });
  }

  private applyMemoryWrite(state: LocalGraphState, path: string, content: string, now: string): void {
    state.updatedAt = now;
    state.project = { ...this.settings.project };
    state.ontology = ONTOLOGY;

    const projectId = this.nodeId("Project", this.settings.project.key);
    const sessionId = this.nodeId("Session", this.settings.session.key);
    const memoryId = this.memoryNodeId(path);
    const versionId = this.nodeId("MemoryVersion", `${path}\n${now}\n${hash(content)}`);

    this.upsertNode(state, {
      id: projectId,
      type: "Project",
      labels: ["OmkProject", "Project"],
      label: this.settings.project.name,
      summary: this.settings.project.root,
      tags: ["project"],
      properties: {
        key: this.settings.project.key,
        root: this.settings.project.root,
      },
      createdAt: now,
      updatedAt: now,
    });

    this.upsertNode(state, {
      id: sessionId,
      type: "Session",
      labels: ["OmkSession", "Session"],
      label: this.settings.session.id,
      summary: `Session for ${this.settings.project.name}`,
      tags: ["session"],
      properties: {
        key: this.settings.session.key,
        sessionId: this.settings.session.id,
        projectKey: this.settings.project.key,
      },
      createdAt: now,
      updatedAt: now,
    });

    this.upsertNode(state, {
      id: memoryId,
      type: "Memory",
      labels: ["OmkMemory", "Memory"],
      label: path,
      path,
      content: truncate(content, 500),
      summary: summarize(content),
      tags: ["memory", ...pathTags(path)],
      properties: {
        key: this.memoryKey(path),
        path,
        projectKey: this.settings.project.key,
        sessionId: this.settings.session.id,
        source: this.source,
      },
      createdAt: now,
      updatedAt: now,
    });

    this.upsertNode(state, {
      id: versionId,
      type: "MemoryVersion",
      labels: ["OmkMemoryVersion", "MemoryVersion"],
      label: `${path}@${now}`,
      path,
      content,
      summary: summarize(content),
      tags: ["memory-version", ...pathTags(path)],
      properties: {
        key: `${this.settings.session.key}:${hash(`${path}\n${now}\n${content}`)}`,
        path,
        projectKey: this.settings.project.key,
        sessionId: this.settings.session.id,
        source: this.source,
      },
      createdAt: now,
      updatedAt: now,
    });

    this.upsertEdge(state, projectId, sessionId, "HAS_SESSION", now);
    this.upsertEdge(state, projectId, memoryId, "HAS_MEMORY", now);
    this.upsertEdge(state, sessionId, versionId, "WROTE", now);
    this.upsertEdge(state, versionId, memoryId, "UPDATES", now);

    this.replaceGeneratedMindmap(state, memoryId, content, path, now);
  }

  async writeMirrorFiles(state: LocalGraphState): Promise<void> {
    const mirrorDir = dirname(this.settings.localGraph.path);
    await mkdir(mirrorDir, { recursive: true });

    const projectNode = state.nodes.find((n) => n.type === "Project");
    const projectOverview = [
      `# ${projectNode?.label ?? state.project.name ?? "Project"}`,
      "",
      `**Key:** ${state.project.key}`,
      `**Root:** ${state.project.root}`,
      `**Updated:** ${state.updatedAt}`,
      "",
      `## Ontology`,
      `- Version: ${state.ontology.version}`,
      `- Classes: ${state.ontology.classes.join(", ")}`,
      `- Relations: ${state.ontology.relationTypes.join(", ")}`,
      "",
    ].join("\n");
    await writeFile(`${mirrorDir}/project.md`, projectOverview, "utf-8");

    const byType = (type: string) => state.nodes.filter((n) => n.type === type);
    const renderNodes = (nodes: LocalGraphNode[]) =>
      nodes
        .map((n) => `### ${n.label}\n${n.summary ?? ""}\n- Tags: ${n.tags.join(", ")}\n`)
        .join("\n");

    await writeFile(`${mirrorDir}/goals.md`, `# Goals\n\n${renderNodes(byType("Goal"))}`, "utf-8");
    await writeFile(`${mirrorDir}/decisions.md`, `# Decisions\n\n${renderNodes(byType("Decision"))}`, "utf-8");
    await writeFile(`${mirrorDir}/commands.md`, `# Commands\n\n${renderNodes(byType("Command"))}`, "utf-8");
    await writeFile(`${mirrorDir}/risks.md`, `# Risks\n\n${renderNodes(byType("Risk"))}`, "utf-8");
  }

  async materializeTurnAudit(input: {
    readonly runId: string;
    readonly nodeId: string;
    readonly provider?: string;
    readonly selectedRuntime?: string;
    readonly fallbackChain?: readonly string[];
    readonly evidenceKind?: string;
    readonly evidenceArtifactPath?: string;
    readonly evidenceHash?: string;
    readonly evidenceRequirements?: readonly { readonly gate: string; readonly ref?: string; readonly required?: boolean }[];
    readonly evidenceObservations?: readonly {
      readonly kind: string;
      readonly source: string;
      readonly ref?: string;
      readonly artifactPath?: string;
      readonly confidence?: number;
      readonly replayable?: boolean;
      readonly redacted?: boolean;
    }[];
  }): Promise<void> {
    await this.mutateState((state, now) => {
      state.updatedAt = now;
      state.project = { ...this.settings.project };
      state.ontology = ONTOLOGY;

      const runId = this.nodeId("Run", input.runId);
      const turnId = this.nodeId("Task", `${input.runId}:${input.nodeId}`);
      const providerName = input.provider ?? input.selectedRuntime?.split("-")[0] ?? "unknown";
      const routeId = this.nodeId("ProviderRoute", `${input.runId}:${input.nodeId}:${input.selectedRuntime ?? providerName}`);
      const evidenceId = this.nodeId("Evidence", `${input.runId}:${input.nodeId}:${input.evidenceArtifactPath ?? input.evidenceKind ?? "result"}`);
      const providerId = this.nodeId("Provider", providerName);
      const artifactId = input.evidenceArtifactPath
        ? this.nodeId("Artifact", `${input.runId}:${input.evidenceArtifactPath}`)
        : undefined;
      const requirementEntries = (input.evidenceRequirements ?? [])
        .filter((requirement) => requirement.required !== false)
        .map((requirement) => ({
          requirement,
          id: this.nodeId("EvidenceRequirement", `${input.runId}:${input.nodeId}:${requirement.gate}:${requirement.ref ?? ""}`),
        }));
      const observationEntries = (input.evidenceObservations ?? [])
        .map((observation, index) => ({
          observation,
          id: this.nodeId("Evidence", `${input.runId}:${input.nodeId}:observation:${index}:${observation.kind}:${observation.ref ?? observation.artifactPath ?? ""}`),
        }));

      const projectId = this.nodeId("Project", this.settings.project.key);
      this.upsertNode(state, {
        id: projectId,
        type: "Project",
        labels: ["OmkProject", "Project"],
        label: this.settings.project.name,
        summary: this.settings.project.root,
        tags: ["project"],
        properties: { key: this.settings.project.key, root: this.settings.project.root },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertNode(state, {
        id: runId,
        type: "Run",
        labels: ["OmkRun", "Run"],
        label: input.runId,
        summary: `Run ${input.runId}`,
        tags: ["run", "audit"],
        properties: { key: input.runId, runId: input.runId, projectKey: this.settings.project.key },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertNode(state, {
        id: turnId,
        type: "Task",
        labels: ["OmkTurn", "Task"],
        label: input.nodeId,
        summary: `Turn ${input.nodeId}`,
        tags: ["turn", "audit"],
        properties: { key: `${input.runId}:${input.nodeId}`, runId: input.runId, nodeId: input.nodeId },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertNode(state, {
        id: routeId,
        type: "ProviderRoute",
        labels: ["OmkProviderRoute", "ProviderRoute"],
        label: input.selectedRuntime ?? input.provider ?? "unknown-runtime",
        summary: `Selected runtime: ${input.selectedRuntime ?? input.provider ?? "unknown"}`,
        tags: ["provider-route", "audit"],
        properties: {
          key: `${input.runId}:${input.nodeId}:route`,
          runId: input.runId,
          nodeId: input.nodeId,
          provider: providerName,
          selectedRuntime: input.selectedRuntime ?? "unknown",
          fallbackChain: (input.fallbackChain ?? []).join(","),
        },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertNode(state, {
        id: providerId,
        type: "Provider",
        labels: ["OmkProvider", "Provider"],
        label: providerName,
        summary: `Provider ${providerName}`,
        tags: ["provider", "audit"],
        properties: { key: providerName, provider: providerName },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertNode(state, {
        id: evidenceId,
        type: "Evidence",
        labels: ["OmkEvidence", "Evidence", "EvidenceObservation"],
        label: input.evidenceKind ?? "turn-result",
        summary: input.evidenceArtifactPath ?? "turn result artifact",
        tags: ["evidence", "audit", "observation"],
        properties: {
          key: `${input.runId}:${input.nodeId}:evidence`,
          runId: input.runId,
          nodeId: input.nodeId,
          kind: input.evidenceKind ?? "turn-result",
          artifactRef: input.evidenceArtifactPath ?? "",
          sha256: input.evidenceHash ?? "",
        },
        createdAt: now,
        updatedAt: now,
      });
      if (artifactId && input.evidenceArtifactPath) {
        const artifactPath = input.evidenceArtifactPath;
        this.upsertNode(state, {
          id: artifactId,
          type: "Artifact",
          labels: ["OmkArtifact", "Artifact"],
          label: artifactPath,
          summary: artifactPath,
          tags: ["artifact", "audit"],
          properties: {
            key: `${input.runId}:${artifactPath}`,
            runId: input.runId,
            path: artifactPath,
            sha256: input.evidenceHash ?? "",
          },
          createdAt: now,
          updatedAt: now,
        });
      }
      for (const { requirement, id } of requirementEntries) {
        this.upsertNode(state, {
          id,
          type: "EvidenceRequirement",
          labels: ["OmkEvidenceRequirement", "EvidenceRequirement"],
          label: requirement.gate,
          summary: requirement.ref ?? requirement.gate,
          tags: ["evidence", "audit", "requirement"],
          properties: {
            key: `${input.runId}:${input.nodeId}:requirement:${requirement.gate}:${requirement.ref ?? ""}`,
            runId: input.runId,
            nodeId: input.nodeId,
            gate: requirement.gate,
            ref: requirement.ref ?? "",
            required: requirement.required !== false,
          },
          createdAt: now,
          updatedAt: now,
        });
      }
      for (const { observation, id } of observationEntries) {
        this.upsertNode(state, {
          id,
          type: "Evidence",
          labels: ["OmkEvidence", "Evidence", "EvidenceObservation"],
          label: observation.kind,
          summary: observation.ref ?? observation.artifactPath ?? observation.kind,
          tags: ["evidence", "audit", "observation"],
          properties: {
            key: `${input.runId}:${input.nodeId}:observation:${observation.kind}:${observation.ref ?? observation.artifactPath ?? ""}`,
            runId: input.runId,
            nodeId: input.nodeId,
            kind: observation.kind,
            source: observation.source,
            ref: observation.ref ?? "",
            artifactRef: observation.artifactPath ?? "",
            confidence: observation.confidence ?? 0,
            replayable: observation.replayable !== false,
            redacted: observation.redacted !== false,
          },
          createdAt: now,
          updatedAt: now,
        });
      }

      this.upsertEdge(state, projectId, runId, "HAS_RUN", now);
      this.upsertEdge(state, runId, turnId, "HAS_TASK", now);
      this.upsertEdge(state, runId, turnId, "HAS_TURN", now);
      this.upsertEdge(state, turnId, routeId, "HAS_PROVIDER_ROUTE", now);
      this.upsertEdge(state, routeId, providerId, "ROUTES_TO", now);
      this.upsertEdge(state, turnId, evidenceId, "OBSERVED_EVIDENCE", now);
      this.upsertEdge(state, routeId, evidenceId, "EVIDENCED_BY", now);
      if (artifactId) this.upsertEdge(state, evidenceId, artifactId, "STORED_AT", now);
      for (const { id } of requirementEntries) {
        this.upsertEdge(state, turnId, id, "DECLARES_EVIDENCE_REQUIREMENT", now);
      }
      for (const { id, observation } of observationEntries) {
        this.upsertEdge(state, turnId, id, "OBSERVED_EVIDENCE", now);
        if (observation.artifactPath && artifactId && observation.artifactPath === input.evidenceArtifactPath) {
          this.upsertEdge(state, id, artifactId, "STORED_AT", now);
        }
        for (const { id: requirementId, requirement } of requirementEntries) {
          if (evidenceObservationSatisfiesRequirement(requirement.gate, observation.kind)) {
            this.upsertEdge(state, requirementId, id, "SATISFIED_BY", now);
          }
        }
      }
    });
  }

  async materializeHeadroomDecision(input: {
    readonly runId: string;
    readonly nodeId: string;
    readonly metadata: {
      readonly attempted?: boolean;
      readonly backend?: string;
      readonly compacted?: boolean;
      readonly compactedTextProduced?: boolean;
      readonly validated?: boolean;
      readonly applied?: boolean;
      readonly beforeTokens?: number;
      readonly afterTokens?: number | null;
      readonly utilization?: number;
      readonly threshold?: number;
      readonly contract?: string;
      readonly reason?: string;
      readonly missingSections?: readonly string[];
      readonly qualityScore?: number;
      readonly compressionRatio?: number | null;
    };
    readonly artifactRef?: string;
  }): Promise<void> {
    await this.mutateState((state, now) => {
      state.updatedAt = now;
      state.project = { ...this.settings.project };
      state.ontology = ONTOLOGY;

      const projectId = this.nodeId("Project", this.settings.project.key);
      const runId = this.nodeId("Run", input.runId);
      const taskId = this.nodeId("Task", `${input.runId}:${input.nodeId}`);
      const decisionId = this.nodeId("HeadroomDecision", `${input.runId}:${input.nodeId}`);
      const artifactId = input.artifactRef
        ? this.nodeId("Artifact", `${input.runId}:${input.artifactRef}`)
        : undefined;
      const attempted = input.metadata.attempted === true;
      const applied = input.metadata.applied === true;
      const reason = input.metadata.reason ?? "headroom decision";

      this.upsertNode(state, {
        id: projectId,
        type: "Project",
        labels: ["OmkProject", "Project"],
        label: this.settings.project.name,
        summary: this.settings.project.root,
        tags: ["project"],
        properties: { key: this.settings.project.key, root: this.settings.project.root },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertNode(state, {
        id: runId,
        type: "Run",
        labels: ["OmkRun", "Run"],
        label: input.runId,
        summary: `Run ${input.runId}`,
        tags: ["run", "audit"],
        properties: { key: input.runId, runId: input.runId, projectKey: this.settings.project.key },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertNode(state, {
        id: taskId,
        type: "Task",
        labels: ["OmkTurn", "Task"],
        label: input.nodeId,
        summary: `Turn ${input.nodeId}`,
        tags: ["turn", "audit"],
        properties: { key: `${input.runId}:${input.nodeId}`, runId: input.runId, nodeId: input.nodeId },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertNode(state, {
        id: decisionId,
        type: "HeadroomDecision",
        labels: ["OmkHeadroomDecision", "HeadroomDecision"],
        label: `${input.nodeId}:headroom`,
        summary: reason,
        tags: ["headroom", "compaction", "audit"],
        properties: {
          key: `${input.runId}:${input.nodeId}:headroom`,
          runId: input.runId,
          nodeId: input.nodeId,
          attempted,
          backend: input.metadata.backend ?? "none",
          compacted: input.metadata.compacted === true,
          compactedTextProduced: input.metadata.compactedTextProduced === true,
          validated: input.metadata.validated === true,
          applied,
          beforeTokens: input.metadata.beforeTokens ?? 0,
          afterTokens: input.metadata.afterTokens ?? 0,
          utilization: input.metadata.utilization ?? 0,
          threshold: input.metadata.threshold ?? 0,
          contract: input.metadata.contract ?? "unknown",
          reason,
          missingSections: (input.metadata.missingSections ?? []).join(","),
          qualityScore: input.metadata.qualityScore ?? 0,
          compressionRatio: input.metadata.compressionRatio ?? 0,
        },
        createdAt: now,
        updatedAt: now,
      });
      if (artifactId && input.artifactRef) {
        this.upsertNode(state, {
          id: artifactId,
          type: "Artifact",
          labels: ["OmkArtifact", "Artifact"],
          label: input.artifactRef,
          summary: input.artifactRef,
          tags: ["artifact", "headroom", "audit"],
          properties: {
            key: `${input.runId}:${input.artifactRef}`,
            runId: input.runId,
            path: input.artifactRef,
            kind: "headroom-decision",
          },
          createdAt: now,
          updatedAt: now,
        });
      }

      this.upsertEdge(state, projectId, runId, "HAS_RUN", now);
      this.upsertEdge(state, runId, taskId, "HAS_TASK", now);
      this.upsertEdge(state, taskId, decisionId, "HAS_HEADROOM_DECISION", now);
      if (artifactId) this.upsertEdge(state, decisionId, artifactId, "STORED_AT", now);

      if (attempted && !applied) {
        const riskId = this.nodeId("Risk", `${input.runId}:${input.nodeId}:headroom`);
        this.upsertNode(state, {
          id: riskId,
          type: "Risk",
          labels: ["OmkRisk", "Risk"],
          label: "headroom-compaction-not-applied",
          summary: reason,
          tags: ["risk", "headroom", "compaction"],
          properties: {
            key: `${input.runId}:${input.nodeId}:headroom-risk`,
            runId: input.runId,
            nodeId: input.nodeId,
            kind: "headroom-compaction-not-applied",
            reason,
            missingSections: (input.metadata.missingSections ?? []).join(","),
          },
          createdAt: now,
          updatedAt: now,
        });
        this.upsertEdge(state, taskId, riskId, "HAS_RISK", now);
      }
    });
  }

  async append(path: string, content: string): Promise<void> {
    await this.mutateState((state, now) => {
      const existing = this.readFromState(state, path);
      this.applyMemoryWrite(state, path, existing ? `${existing}\n${content}` : content, now);
    });
  }

  async search(query: string, limit = 10): Promise<MemorySearchResult[]> {
    const state = await this.loadState();
    const normalizedQuery = query.trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)) || 10);
    // Build the per-path latest-content resolver ONCE in O(N + E) and reuse it
    // for every Memory node, instead of rescanning all nodes+edges per node via
    // readFromState() (which made search O(N^2)). Results are identical & same
    // order; resolver output is memoized so the filter+map phases stay O(1).
    const resolveContent = this.buildMemoryContentIndex(state);
    return state.nodes
      .filter((node) => node.type === "Memory")
      .filter((node) => {
        const content = resolveContent(node.path ?? node.label);
        if (!normalizedQuery) return true;
        return [node.path, node.label, node.summary, content]
          .filter((value): value is string => typeof value === "string")
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, safeLimit)
      .map((node) => ({
        path: node.path ?? node.label,
        content: resolveContent(node.path ?? node.label),
        sessionId: String(node.properties.sessionId ?? ""),
        updatedAt: node.updatedAt,
        source: String(node.properties.source ?? this.source),
      }));
  }

  /**
   * Build a reusable `path -> latest-content` resolver from a single pass over
   * nodes and edges. Mirrors readFromState()/findLatestMemoryVersionNode()
   * selection and ordering exactly (same memory-by-id lookup, same UPDATES-edge
   * filter, same descending updatedAt/createdAt/id tiebreak), but pays
   * O(N + E) once instead of O(N) per Memory node, removing the O(N^2) search
   * hot path. Resolved content is memoized per path for O(1) repeat lookups.
   */
  private buildMemoryContentIndex(state: LocalGraphState): (path: string) => string {
    const memoryById = new Map<string, LocalGraphNode>();
    const versionsByPath = new Map<string, LocalGraphNode[]>();
    for (const node of state.nodes) {
      if (node.type === "Memory") {
        if (!memoryById.has(node.id)) memoryById.set(node.id, node);
      } else if (node.type === "MemoryVersion" && node.path !== undefined) {
        const existing = versionsByPath.get(node.path);
        if (existing) existing.push(node);
        else versionsByPath.set(node.path, [node]);
      }
    }
    const updateFromByMemoryId = new Map<string, Set<string>>();
    for (const edge of state.edges) {
      if (edge.type !== "UPDATES") continue;
      const existing = updateFromByMemoryId.get(edge.to);
      if (existing) existing.add(edge.from);
      else updateFromByMemoryId.set(edge.to, new Set([edge.from]));
    }
    const contentCache = new Map<string, string>();
    return (path: string): string => {
      const cached = contentCache.get(path);
      if (cached !== undefined) return cached;
      const memory = memoryById.get(this.memoryNodeId(path));
      const updateIds = memory ? updateFromByMemoryId.get(memory.id) : undefined;
      const version = (versionsByPath.get(path) ?? [])
        .filter((node) => !updateIds || updateIds.size === 0 || updateIds.has(node.id))
        .sort(
          (a, b) =>
            b.updatedAt.localeCompare(a.updatedAt) ||
            b.createdAt.localeCompare(a.createdAt) ||
            b.id.localeCompare(a.id)
        )[0];
      const content = version?.content ?? memory?.content ?? "";
      contentCache.set(path, content);
      return content;
    };
  }

  async ontology(): Promise<MemoryOntology> {
    return ONTOLOGY;
  }

  async mindmap(query = "", limit = 80): Promise<MemoryMindmap> {
    const state = await this.loadState();
    const normalizedQuery = query.trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)) || 80);
    const rootId = this.nodeId("Project", this.settings.project.key);
    const rootNode = state.nodes.find((node) => node.id === rootId) ?? this.defaultRootNode(rootId);
    const nodeMatches = (node: LocalGraphNode): boolean => {
      if (!normalizedQuery) return true;
      return [node.label, node.path, node.summary, node.content, ...node.tags]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    };
    const seedIds = new Set<string>([rootId]);
    for (const node of state.nodes) {
      if (nodeMatches(node)) seedIds.add(node.id);
    }
    const includedIds = this.expandNeighborhood(state, seedIds, safeLimit);
    includedIds.add(rootId);

    const flatNodes = state.nodes
      .filter((node) => includedIds.has(node.id))
      .map((node) => this.toMindmapFlatNode(node));
    const edges = state.edges
      .filter((edge) => includedIds.has(edge.from) && includedIds.has(edge.to))
      .map((edge) => ({ from: edge.from, to: edge.to, type: edge.type, label: edge.label }));
    const root = this.buildMindmapTree(rootNode, state, includedIds, new Set<string>());
    return { root, nodes: flatNodes, edges, ontology: ONTOLOGY };
  }

  /**
   * Idempotent finalizer that links a finalized run manifest into the local
   * graph. Emits run -> providerRoute -> provider, run -> evidence,
   * run -> decision, and run -> artifact nodes/edges.
   *
   * Privacy: only ids, status, paths, sha256, and aggregate counts are stored.
   * Raw evidence/decision message bodies and secrets are never persisted.
   *
   * Idempotency: node/edge ids are deterministic and prior run-generated
   * nodes/edges (tagged `generatedFromRun`) are pruned before re-inserting, so
   * re-running with the same (or a changed) manifest never duplicates state.
   */
  async linkRun(runId: string, manifest: RunManifest): Promise<void> {
    const canonicalRunId = manifest.runId || runId;
    if (runId && manifest.runId && runId !== manifest.runId) {
      throw new Error(`linkRun: runId mismatch (param=${runId}, manifest=${manifest.runId})`);
    }
    await this.mutateState((state, now) => {
      this.applyRunManifest(state, canonicalRunId, manifest, now);
    });
  }

  private applyRunManifest(state: LocalGraphState, runId: string, manifest: RunManifest, now: string): void {
    state.updatedAt = now;
    state.project = { ...this.settings.project };
    state.ontology = ONTOLOGY;

    // Prune prior run-generated child nodes/edges for idempotent re-runs. The
    // Run node and shared Provider nodes are intentionally not pruned (the Run
    // node is re-upserted preserving createdAt; Providers are shared by runs).
    const staleNodeIds = new Set(
      state.nodes.filter((node) => node.properties.generatedFromRun === runId).map((node) => node.id)
    );
    state.nodes = state.nodes.filter((node) => !staleNodeIds.has(node.id));
    state.edges = state.edges.filter(
      (edge) =>
        edge.properties.generatedFromRun !== runId && !staleNodeIds.has(edge.from) && !staleNodeIds.has(edge.to)
    );

    const tag = { generatedFromRun: runId } satisfies Properties;

    const projectId = this.nodeId("Project", this.settings.project.key);
    this.upsertNode(state, {
      id: projectId,
      type: "Project",
      labels: ["OmkProject", "Project"],
      label: this.settings.project.name,
      summary: this.settings.project.root,
      tags: ["project"],
      properties: { key: this.settings.project.key, root: this.settings.project.root },
      createdAt: now,
      updatedAt: now,
    });

    const runNodeId = this.nodeId("Run", runId);
    this.upsertNode(state, {
      id: runNodeId,
      type: "Run",
      labels: ["OmkRun", "Run"],
      label: runId,
      summary: `Run ${runId} (${manifest.status})`,
      tags: ["run", manifest.status],
      properties: {
        runId,
        status: manifest.status,
        schemaVersion: manifest.schemaVersion,
        createdAt: manifest.createdAt,
        completedAt: manifest.completedAt ?? null,
        promptHash: manifest.promptHash ?? null,
        decisionTracePath: manifest.decisionTracePath ?? null,
        evidenceRequired: manifest.evidenceSummary.required,
        evidencePassed: manifest.evidenceSummary.passed,
        evidenceFailed: manifest.evidenceSummary.failed,
        evidenceMissing: manifest.evidenceSummary.missing,
        nodeCount: manifest.nodes.length,
        artifactCount: manifest.artifacts.length,
        projectKey: this.settings.project.key,
        source: this.source,
      },
      createdAt: now,
      updatedAt: now,
    });
    this.upsertEdge(state, projectId, runNodeId, "HAS_RUN", now, tag);

    // Provider route -> provider.
    const provider = manifest.providerPolicy.provider;
    const mode = manifest.providerPolicy.mode ?? "auto";
    const routeNodeId = this.nodeId("ProviderRoute", `${runId}:${provider}:${mode}`);
    this.upsertNode(state, {
      id: routeNodeId,
      type: "ProviderRoute",
      labels: ["OmkProviderRoute", "ProviderRoute"],
      label: `${provider} (${mode})`,
      summary: `Provider route for run ${runId}`,
      tags: ["provider-route", provider, mode],
      properties: { runId, provider, mode, projectKey: this.settings.project.key, generatedFromRun: runId },
      createdAt: now,
      updatedAt: now,
    });
    this.upsertEdge(state, runNodeId, routeNodeId, "HAS_PROVIDER_ROUTE", now, tag);

    const providerNodeId = this.nodeId("Provider", provider);
    this.upsertNode(state, {
      id: providerNodeId,
      type: "Provider",
      labels: ["OmkProvider", "Provider"],
      label: provider,
      summary: `Provider ${provider}`,
      tags: ["provider", provider],
      properties: { provider, projectKey: this.settings.project.key },
      createdAt: now,
      updatedAt: now,
    });
    this.upsertEdge(state, routeNodeId, providerNodeId, "ROUTES_TO", now, tag);

    // Evidence summary node (counts/paths/sha only — never raw bodies).
    const evidenceArtifact = manifest.artifacts.find(
      (artifact) => artifact.kind === "evidence" || /(^|\/)evidence\.jsonl$/i.test(artifact.path)
    );
    const evidenceNodeId = this.nodeId("Evidence", `${runId}:evidence`);
    this.upsertNode(state, {
      id: evidenceNodeId,
      type: "Evidence",
      labels: ["OmkEvidence", "Evidence"],
      label: `evidence:${runId}`,
      summary: `Evidence ${manifest.evidenceSummary.passed}/${manifest.evidenceSummary.required} passed`,
      tags: ["evidence", manifest.status],
      properties: {
        runId,
        required: manifest.evidenceSummary.required,
        passed: manifest.evidenceSummary.passed,
        failed: manifest.evidenceSummary.failed,
        missing: manifest.evidenceSummary.missing,
        path: evidenceArtifact?.path ?? null,
        sha256: evidenceArtifact?.sha256 ?? null,
        projectKey: this.settings.project.key,
        generatedFromRun: runId,
      },
      createdAt: now,
      updatedAt: now,
    });
    this.upsertEdge(state, runNodeId, evidenceNodeId, "HAS_EVIDENCE", now, tag);

    // Decision trace node (path/sha only — never raw bodies).
    const decisionArtifact = manifest.artifacts.find(
      (artifact) =>
        artifact.kind === "decision" ||
        artifact.kind === "decisions" ||
        /(^|\/)decisions\.jsonl$/i.test(artifact.path)
    );
    const decisionPath = manifest.decisionTracePath ?? decisionArtifact?.path ?? null;
    const decisionNodeId = this.nodeId("Decision", `${runId}:decision`);
    this.upsertNode(state, {
      id: decisionNodeId,
      type: "Decision",
      labels: ["OmkDecision", "Decision"],
      label: `decisions:${runId}`,
      summary: `Decision trace for run ${runId}`,
      tags: ["decision", manifest.status],
      properties: {
        runId,
        path: decisionPath,
        sha256: decisionArtifact?.sha256 ?? null,
        projectKey: this.settings.project.key,
        generatedFromRun: runId,
      },
      createdAt: now,
      updatedAt: now,
    });
    this.upsertEdge(state, runNodeId, decisionNodeId, "HAS_DECISION", now, tag);

    // Artifacts -> File/Artifact nodes (id/kind/path/sha only).
    for (const artifact of manifest.artifacts) {
      const artifactNodeId = this.nodeId("Artifact", `${runId}:${artifact.kind}:${artifact.path}`);
      this.upsertNode(state, {
        id: artifactNodeId,
        type: "Artifact",
        labels: ["OmkArtifact", "Artifact", "File"],
        label: artifact.path,
        path: artifact.path,
        summary: `${artifact.kind} artifact`,
        tags: ["artifact", artifact.kind, ...pathTags(artifact.path)],
        properties: {
          runId,
          kind: artifact.kind,
          path: artifact.path,
          sha256: artifact.sha256 ?? null,
          projectKey: this.settings.project.key,
          generatedFromRun: runId,
        },
        createdAt: now,
        updatedAt: now,
      });
      this.upsertEdge(state, runNodeId, artifactNodeId, "TOUCHES_FILE", now, tag);
    }
  }

  async graphQuery(query: string): Promise<GraphQueryResult> {
    const normalized = query.replace(/\s+/g, " ").trim();
    const data: Record<string, unknown> = {};

    if (/\bontology\b/i.test(normalized)) {
      data.ontology = await this.ontology();
    }

    if (/\bmemory\s*\(/i.test(normalized)) {
      const path = readStringArg(normalized, "path");
      if (!path) throw new Error('omk_graph_query: memory(path: "...") requires a path argument');
      data.memory = {
        path,
        content: await this.read(path),
      };
    }

    if (/\bmemories\s*\(/i.test(normalized) || /\bmemories\b/i.test(normalized)) {
      const searchQuery = readStringArg(normalized, "query") ?? "";
      const limit = readNumberArg(normalized, "limit") ?? 10;
      data.memories = await this.search(searchQuery, limit);
    }

    if (/\bmindmap\s*\(/i.test(normalized) || /\bmindmap\b/i.test(normalized)) {
      const searchQuery = readStringArg(normalized, "query") ?? "";
      const limit = readNumberArg(normalized, "limit") ?? 80;
      data.mindmap = await this.mindmap(searchQuery, limit);
    }

    if (/\bnodes\s*\(/i.test(normalized) || /\bnodes\b/i.test(normalized)) {
      const state = await this.loadState();
      const type = readStringArg(normalized, "type");
      const searchQuery = (readStringArg(normalized, "query") ?? "").toLowerCase();
      const limit = readNumberArg(normalized, "limit") ?? 50;
      data.nodes = state.nodes
        .filter((node) => !type || node.type === type)
        .filter((node) => {
          if (!searchQuery) return true;
          const content = node.type === "Memory" ? this.readFromState(state, node.path ?? node.label) : node.content;
          return [node.label, node.path, node.summary, content, ...node.tags]
            .filter((value): value is string => typeof value === "string")
            .some((value) => value.toLowerCase().includes(searchQuery));
        })
        .slice(0, Math.max(1, Math.min(250, Math.floor(limit))))
        .map((node) => this.toMindmapFlatNode(node));
    }

    if (Object.keys(data).length === 0) {
      throw new Error(
        'omk_graph_query supports GraphQL-lite fields: ontology, memory(path: "..."), memories(query: "...", limit: 10), mindmap(query: "...", limit: 80), nodes(type: "Task")'
      );
    }

    return {
      data,
      extensions: {
        dialect: "omk-graphql-lite-v1",
        backend: "local_graph",
        statePath: this.settings.localGraph.path,
      },
    };
  }

  private async loadState(): Promise<LocalGraphState> {
    if (this.durability === "delta") {
      return this.loadStateDelta();
    }
    return this.loadStateLegacy();
  }

  private async loadStateLegacy(): Promise<LocalGraphState> {
    let raw: string;
    try {
      raw = await readFile(this.settings.localGraph.path, "utf-8");
    } catch (err) {
      if (errorCode(err) === "ENOENT") return this.emptyState();
      if (this.settings.strict) throw err;
      return this.emptyState();
    }

    if (raw.trim().length === 0) {
      return this.handleInvalidState(raw, "state file is empty");
    }

    try {
      const parsed = JSON.parse(raw) as Partial<LocalGraphState>;
      if (parsed.version === 1 && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        return {
          version: 1,
          ontology: ONTOLOGY,
          project: parsed.project ?? { ...this.settings.project },
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
          nodes: parsed.nodes,
          edges: parsed.edges,
        };
      }
      return this.handleInvalidState(raw, "state JSON is missing version=1, nodes[], or edges[]");
    } catch (err) {
      return this.handleInvalidState(raw, `invalid JSON: ${errorMessage(err)}`);
    }
  }

  private async loadStateDelta(): Promise<LocalGraphState> {
    const graphPath = this.settings.localGraph.path;
    // Check if manifest exists; if not, try to load legacy file for migration
    const manifest = await readManifest(graphPath);
    if (!manifest) {
      // Load legacy file as base state for migration
      let legacyState: LocalGraphState;
      try {
        legacyState = await this.loadStateLegacy();
      } catch {
        legacyState = this.emptyState();
      }
      this.deltaManifest = await setupDeltaMode(graphPath, legacyState);
      this.deltaEpoch = this.deltaManifest.snapshotEpoch;
      this.deltaLastSeq = 0;
      this.deltaOpCount = this.deltaManifest.deltaOpCount;
      return legacyState;
    }

    this.deltaManifest = manifest;
    const result = await loadStateViaDelta(graphPath, this.settings.strict, this.emptyState());
    this.deltaEpoch = result.epoch;
    this.deltaLastSeq = result.lastSeq;
    this.deltaOpCount = result.deltaOpCount;
    return result.state;
  }

  private emptyState(): LocalGraphState {
    const now = new Date().toISOString();
    return {
      version: 1,
      ontology: ONTOLOGY,
      project: { ...this.settings.project },
      updatedAt: now,
      nodes: [],
      edges: [],
    };
  }

  private async saveState(state: LocalGraphState): Promise<void> {
    const payload = `${JSON.stringify(state, null, 2)}\n`;
    await writeFileAtomic(this.settings.localGraph.path, payload);

    // Hardcoded fallback: always persist to the canonical path as the source of truth
    const fallbackPath = resolve(this.settings.project.root, ".omk/memory/graph-state.json");
    if (fallbackPath !== this.settings.localGraph.path) {
      await writeFileAtomic(fallbackPath, payload);
    }
  }

  private async handleInvalidState(raw: string, reason: string): Promise<LocalGraphState> {
    const repair = await this.writeInvalidStateRepair(raw, reason).catch(() => undefined);
    if (this.settings.strict) {
      const repairText = repair
        ? ` Backup: ${repair.backupPath}; repair signal: ${repair.signalPath}.`
        : " Backup/repair signal could not be written.";
      throw new Error(
        `Local graph memory state is invalid; refusing to overwrite in strict mode.${repairText} Reason: ${reason}`
      );
    }
    return this.emptyState();
  }

  private async writeInvalidStateRepair(raw: string, reason: string): Promise<InvalidGraphStateRepair> {
    const statePath = this.settings.localGraph.path;
    const suffix = `${timestampForPath()}-${hash(raw).slice(0, 8)}`;
    const backupPath = `${statePath}.invalid-${suffix}.bak`;
    const signalPath = `${statePath}.repair.json`;
    const signal = {
      schemaVersion: 1,
      status: "repair-required",
      statePath,
      backupPath,
      reason,
      strict: this.settings.strict,
      createdAt: new Date().toISOString(),
    };
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(backupPath, raw, "utf-8");
    await writeFileAtomic(signalPath, `${JSON.stringify(signal, null, 2)}\n`);
    return { backupPath, signalPath, reason };
  }

  private async mutateState(mutator: (state: LocalGraphState, now: string) => void): Promise<void> {
    const graphPath = this.settings.localGraph.path;
    await enqueueGraphWrite(graphPath, async () => {
      if (this.durability === "delta") {
        await withDeltaLock(graphPath, async () => {
          const state = await this.loadStateForMutation(graphPath);

          // Capture pre-mutation id→object maps for diffing
          const preNodes = new Map(state.nodes.map((n) => [n.id, n]));
          const preEdges = new Map(state.edges.map((e) => [e.id, e]));

          const now = new Date().toISOString();
          mutator(state, now);

          // Compute delta (changed/added/deleted nodes and edges)
          const delta = computeDelta(preNodes, preEdges, state);

          // Ensure delta mode is set up (first write migrates if needed)
          if (!this.deltaManifest) {
            this.deltaManifest = await setupDeltaMode(graphPath, state);
            this.deltaEpoch = this.deltaManifest.snapshotEpoch;
            this.deltaLastSeq = 0;
            this.deltaOpCount = this.deltaManifest.deltaOpCount;
          }

          const seq = this.deltaLastSeq + 1;
          await appendDelta(
            graphPath,
            this.deltaEpoch,
            seq,
            now,
            {
              updatedAt: state.updatedAt,
              project: state.project,
              ontology: state.ontology.version,
            },
            delta.nodes,
            delta.edges
          );

          this.deltaLastSeq = seq;
          this.deltaOpCount += 1;

          // Check compaction thresholds
          const thresholds = resolveCompactionThresholds(this.env);
          const compactResult = await compactIfNeeded(
            graphPath,
            state,
            this.deltaEpoch,
            this.deltaOpCount,
            thresholds
          );
          if (compactResult.compacted) {
            this.deltaEpoch = compactResult.newEpoch;
            this.deltaOpCount = compactResult.newOpCount;
            this.deltaLastSeq = 0;
          }

          // Refresh the process-local cache from the file we just wrote so the next
          // mutation in this process can reuse the parsed object and skip the disk
          // read + JSON.parse entirely (on-disk format/durability are unchanged).
          this.refreshGraphStateCache(graphPath, state);
          if (this.settings.mirrorFiles) {
            await this.writeMirrorFiles(state);
          }
        }, this.env);
      } else {
        const state = await this.loadStateForMutation(graphPath);
        mutator(state, new Date().toISOString());
        await this.saveState(state);

        this.refreshGraphStateCache(graphPath, state);
        if (this.settings.mirrorFiles) {
          await this.writeMirrorFiles(state);
        }
      }
    });
  }

  /**
   * Load state for a write, reusing the process-local cache only when the file
   * is unchanged on mtimeMs + size + ctimeMs + inode since this process last
   * persisted it. In delta mode, also checks snapshot + delta file stats.
   * Any divergence (concurrent external writer) or a missing entry invalidates
   * the cache and falls back to a full loadState(), preserving multi-writer
   * correctness and loadState's ENOENT / empty / invalid / strict semantics.
   */
  private async loadStateForMutation(graphPath: string): Promise<LocalGraphState> {
    const cached = graphStateCache.get(graphPath);
    if (cached) {
      if (this.durability === "delta") {
        const currentDeltaStats = statDeltaFiles(graphPath);
        if (
          currentDeltaStats &&
          deltaStatsMatch(currentDeltaStats, cached.deltaStats ?? null)
        ) {
          // Restore delta tracking from cache
          if (cached.deltaEpoch !== undefined) this.deltaEpoch = cached.deltaEpoch;
          if (cached.deltaOpCount !== undefined) this.deltaOpCount = cached.deltaOpCount;
          if (cached.deltaLastSeq !== undefined) this.deltaLastSeq = cached.deltaLastSeq;
          return cached.state;
        }
      } else {
        const stat = statSyncSafe(graphPath);
        if (
          stat &&
          stat.mtimeMs === cached.mtimeMs &&
          stat.size === cached.size &&
          stat.ctimeMs === cached.ctimeMs &&
          stat.ino === cached.ino
        ) {
          return cached.state;
        }
      }
      graphStateCache.delete(graphPath);
    }
    return this.loadState();
  }

  /**
   * Record the just-written state plus its fresh on-disk stats so the next
   * cache hit can be validated. In delta mode, tracks snapshot + delta file
   * stats. If the files cannot be stat'd, drop the entry rather than risk
   * serving stale data on a later write.
   */
  private refreshGraphStateCache(graphPath: string, state: LocalGraphState): void {
    if (this.durability === "delta") {
      const deltaStats = statDeltaFiles(graphPath);
      if (deltaStats) {
        graphStateCache.set(graphPath, {
          state,
          mtimeMs: deltaStats.snapshotMtimeMs,
          size: deltaStats.snapshotSize,
          ctimeMs: deltaStats.snapshotCtimeMs,
          ino: deltaStats.snapshotIno,
          deltaStats,
          deltaEpoch: this.deltaEpoch,
          deltaOpCount: this.deltaOpCount,
          deltaLastSeq: this.deltaLastSeq,
        });
      } else {
        graphStateCache.delete(graphPath);
      }
      return;
    }

    const stat = statSyncSafe(graphPath);
    if (stat) {
      graphStateCache.set(graphPath, {
        state,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        ctimeMs: stat.ctimeMs,
        ino: stat.ino,
      });
    } else {
      graphStateCache.delete(graphPath);
    }
  }

  private readFromState(state: LocalGraphState, path: string): string {
    const memory = this.findMemoryNode(state, path);
    const version = this.findLatestMemoryVersionNode(state, path, memory?.id);
    return version?.content ?? memory?.content ?? "";
  }

  private findLatestMemoryVersionNode(
    state: LocalGraphState,
    path: string,
    memoryId: string | undefined
  ): LocalGraphNode | undefined {
    const updateIds = memoryId
      ? new Set(state.edges.filter((edge) => edge.type === "UPDATES" && edge.to === memoryId).map((edge) => edge.from))
      : undefined;
    return state.nodes
      .filter((node) => node.type === "MemoryVersion" && node.path === path)
      .filter((node) => !updateIds || updateIds.size === 0 || updateIds.has(node.id))
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id)
      )[0];
  }

  private findMemoryNode(state: LocalGraphState, path: string): LocalGraphNode | undefined {
    const memoryId = this.memoryNodeId(path);
    return state.nodes.find((node) => node.id === memoryId && node.type === "Memory");
  }

  private replaceGeneratedMindmap(state: LocalGraphState, memoryId: string, content: string, path: string, now: string): void {
    const generatedIds = new Set(
      state.nodes
        .filter((node) => GENERATED_TYPES.has(node.type) && node.properties.generatedFrom === memoryId)
        .map((node) => node.id)
    );
    state.nodes = state.nodes.filter((node) => !generatedIds.has(node.id));
    state.edges = state.edges.filter(
      (edge) => !generatedIds.has(edge.from) && !generatedIds.has(edge.to) && edge.properties.generatedFrom !== memoryId
    );

    let concepts = extractConcepts(content);
    const MAX_CONCEPTS = 50;
    for (const concept of concepts) {
      if (!CANONICAL_NODE_TYPES.has(concept.type)) {
        concept.type = "Topic";
        concept.relation = relationForType("Topic");
      }
    }
    if (concepts.length > MAX_CONCEPTS) {
      const overflowCount = concepts.length - MAX_CONCEPTS;
      concepts = concepts.slice(0, MAX_CONCEPTS);
      concepts.push({
        type: "Topic",
        label: `And ${overflowCount} more concepts…`,
        summary: `${overflowCount} additional concepts were extracted but not stored to limit graph growth.`,
        relation: "HAS_TOPIC",
        tags: ["overflow", "limit"],
        line: 0,
        filePaths: [],
      });
    }
    const conceptIds = concepts.map((concept, index) => this.nodeId(concept.type, `${path}:${index}:${concept.label}`));
    const memoryFileNodes = new Map<string, string>();
    for (const [index, concept] of concepts.entries()) {
      const conceptId = conceptIds[index];
      this.upsertNode(state, {
        id: conceptId,
        type: concept.type,
        labels: [`Omk${concept.type}`, concept.type],
        label: concept.label,
        summary: concept.summary,
        tags: concept.tags,
        properties: {
          generatedFrom: memoryId,
          line: concept.line,
          level: concept.level ?? null,
          path,
          projectKey: this.settings.project.key,
          sessionId: this.settings.session.id,
        },
        createdAt: now,
        updatedAt: now,
      });

      const ownerId = concept.parentIndex === undefined ? memoryId : conceptIds[concept.parentIndex] ?? memoryId;
      const relation = ownerId === memoryId ? concept.relation : nestedRelationForType(concept.type, concept.relation);
      this.upsertEdge(state, ownerId, conceptId, relation, now, { generatedFrom: memoryId });
      this.upsertEdge(state, conceptId, memoryId, "PART_OF", now, { generatedFrom: memoryId });

      for (const filePath of concept.filePaths) {
        const existingFileId = memoryFileNodes.get(filePath);
        const fileId = existingFileId ?? this.nodeId("File", `${path}:${filePath}`);
        memoryFileNodes.set(filePath, fileId);
        this.upsertNode(state, {
          id: fileId,
          type: "File",
          labels: ["OmkFile", "File"],
          label: filePath,
          path: filePath,
          summary: `Referenced by ${path}`,
          tags: ["file", ...pathTags(filePath)],
          properties: {
            generatedFrom: memoryId,
            path: filePath,
            projectKey: this.settings.project.key,
            sessionId: this.settings.session.id,
          },
          createdAt: now,
          updatedAt: now,
        });
        this.upsertEdge(state, conceptId, fileId, "TOUCHES_FILE", now, { generatedFrom: memoryId });
        this.upsertEdge(state, memoryId, fileId, "HAS_FILE", now, { generatedFrom: memoryId });
      }
    }
  }

  private expandNeighborhood(state: LocalGraphState, seedIds: Set<string>, limit: number): Set<string> {
    const included = new Set<string>();
    const queue = [...seedIds];
    while (queue.length > 0 && included.size < limit) {
      const id = queue.shift();
      if (!id || included.has(id)) continue;
      included.add(id);
      for (const edge of state.edges) {
        if (edge.from === id && !included.has(edge.to)) queue.push(edge.to);
        if (edge.to === id && !included.has(edge.from)) queue.push(edge.from);
      }
    }
    return included;
  }

  private buildMindmapTree(
    node: LocalGraphNode,
    state: LocalGraphState,
    includedIds: Set<string>,
    seen: Set<string>
  ): MemoryMindmapNode {
    const flat = this.toMindmapFlatNode(node);
    const tree: MemoryMindmapNode = { ...flat, children: [] };
    if (seen.has(node.id)) return tree;
    seen.add(node.id);
    const childEdges = state.edges.filter((edge) => includedIds.has(edge.to) && this.isMindmapForward(edge));
    const children = childEdges
      .filter((edge) => edge.from === node.id)
      .map((edge) => state.nodes.find((candidate) => candidate.id === edge.to))
      .filter((candidate): candidate is LocalGraphNode => Boolean(candidate))
      .sort((a, b) => sortRank(a.type) - sortRank(b.type) || a.label.localeCompare(b.label));
    for (const child of children) {
      tree.children.push(this.buildMindmapTree(child, state, includedIds, seen));
    }
    return tree;
  }

  private isMindmapForward(edge: LocalGraphEdge): boolean {
    return edge.type.startsWith("HAS_") || edge.type === "UPDATES" || edge.type === "WROTE" || edge.type === "TOUCHES_FILE" || edge.type === "USES_PROVIDER";
  }

  private toMindmapFlatNode(node: LocalGraphNode): Omit<MemoryMindmapNode, "children"> {
    return {
      id: node.id,
      type: node.type,
      label: node.label,
      path: node.path,
      summary: node.summary,
    };
  }

  private defaultRootNode(id: string): LocalGraphNode {
    const now = new Date().toISOString();
    return {
      id,
      type: "Project",
      labels: ["OmkProject", "Project"],
      label: this.settings.project.name,
      summary: this.settings.project.root,
      tags: ["project"],
      properties: { key: this.settings.project.key, root: this.settings.project.root },
      createdAt: now,
      updatedAt: now,
    };
  }

  private upsertNode(state: LocalGraphState, node: LocalGraphNode): void {
    const existing = state.nodes.findIndex((candidate) => candidate.id === node.id);
    if (existing === -1) {
      state.nodes.push(node);
      return;
    }
    state.nodes[existing] = {
      ...state.nodes[existing],
      ...node,
      createdAt: state.nodes[existing].createdAt,
    };
  }

  private upsertEdge(state: LocalGraphState, from: string, to: string, type: string, now: string, properties: Properties = {}): void {
    const id = this.edgeId(type, from, to);
    const existing = state.edges.findIndex((candidate) => candidate.id === id);
    const edge: LocalGraphEdge = {
      id,
      type,
      from,
      to,
      label: type.toLowerCase().replace(/_/g, " "),
      properties,
      createdAt: now,
      updatedAt: now,
    };
    if (existing === -1) {
      state.edges.push(edge);
      return;
    }
    state.edges[existing] = {
      ...state.edges[existing],
      ...edge,
      createdAt: state.edges[existing].createdAt,
    };
  }

  private memoryNodeId(path: string): string {
    return this.nodeId("Memory", this.memoryKey(path));
  }

  private memoryKey(path: string): string {
    return `${this.settings.project.key}:${hash(path)}`;
  }

  private nodeId(type: string, key: string): string {
    return `${type}:${hash(`${this.settings.project.key}:${key}`).slice(0, 24)}`;
  }

  private edgeId(type: string, from: string, to: string): string {
    return `${type}:${hash(`${from}\n${type}\n${to}`).slice(0, 24)}`;
  }
}

export function extractConcepts(content: string): ExtractedConcept[] {
  const concepts: ExtractedConcept[] = [];
  const topicStack: Array<{ level: number; index: number }> = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const label = cleanLabel(heading[2]);
      while (topicStack.length > 0 && topicStack[topicStack.length - 1].level >= level) topicStack.pop();
      const parentIndex = topicStack[topicStack.length - 1]?.index;
      const conceptIndex = concepts.length;
      topicStack.push({ level, index: conceptIndex });
      concepts.push({
        type: classify(label, false),
        label,
        summary: label,
        parentIndex,
        relation: relationForType(classify(label, false)),
        tags: tagsFor(label),
        line: index + 1,
        level,
        filePaths: extractFilePaths(label),
      });
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/) ?? trimmed.match(/^\d+[.)]\s+(.+)$/);
    const text = cleanLabel(bullet?.[1] ?? trimmed.replace(/^>\s*/, ""));
    const commandLike = inFence || isCommandLike(text);
    if (text.length < 3) continue;
    const parentIndex = topicStack[topicStack.length - 1]?.index;
    const type = commandLike ? "Command" : classify(text, Boolean(bullet));
    concepts.push({
      type,
      label: truncate(text, 140),
      summary: text,
      parentIndex,
      relation: relationForType(type),
      tags: tagsFor(text),
      line: index + 1,
      filePaths: extractFilePaths(text),
    });
  }

  return concepts;
}

function classify(text: string, isBullet: boolean): string {
  const lower = text.toLowerCase();
  if (/\b(audit link|audit trail|report link|evidence link|검증 링크|감사 링크)\b/i.test(text)) return "AuditLink";
  if (/\[[^\]]+\]\((?:\.omk\/runs\/|\.omk\/goals\/|[^)]+(?:report|summary|evidence)[^)]*\.md)[^)]*\)/i.test(text)) return "AuditLink";
  if (/\b(run\s*id|runid|run)\b/i.test(text) && /\b[\w.-]*run[\w.-]*\b|\.omk\/runs\//i.test(text)) return "Run";
  if (/\b(goal|objective|목표|비전|north star)\b/i.test(text)) return "Goal";
  if (/\b(decision|decide|chosen|결정|선택|합의)\b/i.test(text)) return "Decision";
  if (/\b(todo|task|해야|할 일|next|action|implement|구현|작업)\b/i.test(text)) return "Task";
  if (/\b(risk|blocked|blocker|fail|failure|warning|주의|리스크|위험|실패|차단)\b/i.test(text)) return "Risk";
  if (/\b(evidence|verified|tested|pass|출처|근거|검증|통과)\b/i.test(text)) return "Evidence";
  if (/\b(fallback|failover|fallback-to-kimi|대체|폴백)\b/i.test(text) && /\b(provider|kimi|deepseek|라우팅|공급자)\b/i.test(text)) return "ProviderFallback";
  if (/\b(provider route|provider routing|routeProvider|provider router|deepseek|compatibility-first|라우팅|공급자)\b/i.test(text)) return "ProviderRoute";
  if (/\b(provider|kimi|deepseek|runtime|worker pool|공급자|런타임)\b/i.test(text)) return "Provider";
  if (/\b(constraint|must|must not|required|제약|필수|금지)\b/i.test(text)) return "Constraint";
  if (text.endsWith("?") || /\b(question|질문|의문)\b/i.test(text)) return "Question";
  if (/\b(answer|resolution|해결|답변)\b/i.test(text)) return "Answer";
  if (isBullet && lower.length < 100) return "Concept";
  return "Topic";
}

function relationForType(type: string): string {
  switch (type) {
    case "Goal":
      return "HAS_GOAL";
    case "Run":
      return "HAS_RUN";
    case "Topic":
      return "HAS_TOPIC";
    case "Decision":
      return "HAS_DECISION";
    case "Task":
      return "HAS_TASK";
    case "Risk":
      return "HAS_RISK";
    case "Command":
      return "HAS_COMMAND";
    case "Evidence":
      return "HAS_EVIDENCE";
    case "Provider":
      return "USES_PROVIDER";
    case "ProviderRoute":
      return "HAS_PROVIDER_ROUTE";
    case "ProviderFallback":
      return "HAS_PROVIDER_FALLBACK";
    case "AuditLink":
      return "HAS_AUDIT_LINK";
    case "Constraint":
      return "HAS_CONSTRAINT";
    case "Question":
      return "HAS_QUESTION";
    case "Answer":
      return "HAS_ANSWER";
    case "File":
      return "HAS_FILE";
    default:
      return "HAS_CONCEPT";
  }
}

function nestedRelationForType(type: string, relation: string): string {
  if (["Run", "AuditLink", "ProviderRoute", "ProviderFallback", "Evidence"].includes(type)) {
    return relation;
  }
  return "HAS_CONCEPT";
}

function isCommandLike(text: string): boolean {
  return /^(\$\s*)?(npm|pnpm|yarn|node|tsx|tsc|git|omk|kimi|python|python3|uv|pytest|ruff|docker|docker-compose|kubectl)\b/.test(text);
}

function extractFilePaths(text: string): string[] {
  const markdownLinks = [...text.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .filter((target) => target && !/^[a-z][a-z0-9+.-]*:/i.test(target));
  const matches = text.match(/(?:\.?[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+)|(?:^|\s)(?:[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs|cjs|json|md|toml|yaml|yml|py|sh|mjs))/g) ?? [];
  return [...new Set([...markdownLinks, ...matches.map((match) => match.trim())].filter(Boolean))].slice(0, 10);
}

function tagsFor(text: string): string[] {
  const tags = new Set<string>();
  for (const part of text.toLowerCase().match(/[a-z0-9가-힣_-]{3,}/g) ?? []) {
    if (tags.size >= 12) break;
    tags.add(part);
  }
  return [...tags];
}

function pathTags(path: string): string[] {
  return path
    .split(/[\\/.:-]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 2)
    .slice(0, 8);
}

function cleanLabel(text: string): string {
  return text.replace(/[`*_~]/g, "").replace(/\s+/g, " ").trim();
}

function summarize(content: string): string {
  const firstUseful = content
    .split(/\r?\n/)
    .map((line) => cleanLabel(line.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "")))
    .find((line) => line.length > 0);
  return truncate(firstUseful ?? "", 180);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function sortRank(type: string): number {
  const order = ["Project", "Session", "Memory", "Goal", "Run", "Topic", "Decision", "Task", "Risk", "Evidence", "Provider", "ProviderRoute", "ProviderFallback", "AuditLink", "Constraint", "Command", "File", "Concept"];
  const index = order.indexOf(type);
  return index === -1 ? order.length : index;
}

function readStringArg(query: string, name: string): string | undefined {
  const match = query.match(new RegExp(`${name}\\s*:\\s*["']([^"']*)["']`, "i"));
  return match?.[1];
}

function readNumberArg(query: string, name: string): number | undefined {
  const match = query.match(new RegExp(`${name}\\s*:\\s*(\\d+)`, "i"));
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function evidenceObservationSatisfiesRequirement(requirementGate: string, observationKind: string): boolean {
  if (observationKind === requirementGate) return true;
  if (requirementGate === "test-pass" && observationKind === "command-pass") return true;
  if (requirementGate === "file-exists" && observationKind === "artifact") return true;
  return false;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
