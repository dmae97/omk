import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import {
  loadMemorySettings,
  summarizeMemorySettings,
  usesLocalGraphBackend,
  type MemorySettings,
  type MemoryStatus,
} from "./memory-config.js";

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

interface LocalGraphNode {
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

interface LocalGraphEdge {
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
    "HAS_RISK",
    "HAS_COMMAND",
    "HAS_FILE",
    "HAS_EVIDENCE",
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

export class LocalGraphMemoryStore {
  constructor(
    private readonly settings: MemorySettings,
    private readonly source = "omk-local-graph-memory"
  ) {}

  static async create(options: LocalGraphMemoryStoreOptions = {}): Promise<LocalGraphMemoryStore | null> {
    const env = options.sessionId
      ? { ...(options.env ?? process.env), OMK_SESSION_ID: options.sessionId }
      : options.env ?? process.env;
    const settings = await loadMemorySettings(options.projectRoot, env);
    if (!usesLocalGraphBackend(settings.backend)) return null;
    return new LocalGraphMemoryStore(settings, options.source ?? "omk-local-graph-memory");
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
    const memory = this.findMemoryNode(state, path);
    return memory?.content ?? "";
  }

  async write(path: string, content: string): Promise<void> {
    const state = await this.loadState();
    const now = new Date().toISOString();
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
    await this.saveState(state);
    if (this.settings.mirrorFiles) {
      await this.writeMirrorFiles(state);
    }
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

  async append(path: string, content: string): Promise<void> {
    const existing = await this.read(path);
    await this.write(path, existing ? `${existing}\n${content}` : content);
  }

  async search(query: string, limit = 10): Promise<MemorySearchResult[]> {
    const state = await this.loadState();
    const normalizedQuery = query.trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)) || 10);
    return state.nodes
      .filter((node) => node.type === "Memory")
      .filter((node) => {
        if (!normalizedQuery) return true;
        return [node.path, node.label, node.summary, node.content]
          .filter((value): value is string => typeof value === "string")
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, safeLimit)
      .map((node) => ({
        path: node.path ?? node.label,
        content: node.content ?? "",
        sessionId: String(node.properties.sessionId ?? ""),
        updatedAt: node.updatedAt,
        source: String(node.properties.source ?? this.source),
      }));
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
          return [node.label, node.path, node.summary, node.content, ...node.tags]
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
    try {
      const raw = await readFile(this.settings.localGraph.path, "utf-8");
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
    } catch {
      // Missing or invalid state starts a fresh local graph.
    }
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
    await mkdir(dirname(this.settings.localGraph.path), { recursive: true });
    const payload = `${JSON.stringify(state, null, 2)}\n`;
    await writeFile(this.settings.localGraph.path, payload, "utf-8");

    // Hardcoded fallback: always persist to the canonical path as the source of truth
    const fallbackPath = resolve(this.settings.project.root, ".omk/memory/graph-state.json");
    if (fallbackPath !== this.settings.localGraph.path) {
      await mkdir(dirname(fallbackPath), { recursive: true });
      await writeFile(fallbackPath, payload, "utf-8");
    }
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
  if (/\b(provider route|provider routing|routeProvider|provider router|deepseek|kimi-first|라우팅|공급자)\b/i.test(text)) return "ProviderRoute";
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

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
