/**
 * Ontology model for OMK project memory.
 *
 * Defines core node types, relationship types, project-isolation fields,
 * and schema helpers used across all graph-backed memory stores.
 */

export const ONTOLOGY_SCHEMA_VERSION = 1;

export const ONTOLOGY_NODE_TYPES = [
  "Project",
  "Session",
  "Run",
  "Goal",
  "Criterion",
  "Evidence",
  "Decision",
  "Task",
  "Risk",
  "Constraint",
  "File",
  "Symbol",
  "Test",
  "Command",
  "Commit",
  "MCPServer",
  "Skill",
  "Provider",
  "ProviderRoute",
  "ProviderFallback",
  "AuditLink",
] as const;

export type OntologyNodeType = (typeof ONTOLOGY_NODE_TYPES)[number];

export const ONTOLOGY_RELATIONSHIP_TYPES = [
  "HAS_GOAL",
  "HAS_RUN",
  "HAS_CRITERION",
  "HAS_EVIDENCE",
  "HAS_DECISION",
  "HAS_TASK",
  "DEPENDS_ON",
  "HAS_RISK",
  "HAS_FILE",
  "HAS_SYMBOL",
  "HAS_TEST",
  "HAS_COMMAND",
  "HAS_COMMIT",
  "USES_MCP",
  "USES_SKILL",
  "USES_PROVIDER",
  "HAS_PROVIDER_ROUTE",
  "ROUTES_TO",
  "FALLS_BACK_TO",
  "HAS_PROVIDER_FALLBACK",
  "HAS_AUDIT_LINK",
  "LINKS_TO",
] as const;

export type OntologyRelationshipType = (typeof ONTOLOGY_RELATIONSHIP_TYPES)[number];

/** Base properties present on every ontology node for project isolation. */
export interface OntologyNodeBase {
  /** Unique node identifier (scoped to project). */
  id: string;
  /** Project key for multi-tenant isolation. */
  projectId: string;
  /** SHA-256 hash of the workspace root path. */
  workspaceRootHash: string;
  /** Ontology schema version (default 1). */
  schemaVersion: number;
  /** ISO timestamp when the node was created. */
  createdAt: string;
  /** ISO timestamp when the node was last updated. */
  updatedAt: string;
}

/** Project node managed by graph memory stores. */
export interface ProjectNode extends OntologyNodeBase {
  key: string;
  name: string;
  root: string;
}

/** Session node managed by graph memory stores. */
export interface SessionNode extends OntologyNodeBase {
  key: string;
  sessionId: string;
  projectKey: string;
}

/** Runtime/run node used to link plans, evidence, reports, and provider attempts. */
export interface RunNode extends OntologyNodeBase {
  runId: string;
  status: string;
  startedAt: string;
}

/** Memory node managed by graph memory stores. */
export interface MemoryNode extends OntologyNodeBase {
  key: string;
  path: string;
  content: string;
  source: string;
}

/** MemoryVersion node managed by graph memory stores. */
export interface MemoryVersionNode extends OntologyNodeBase {
  key: string;
  path: string;
  content: string;
  source: string;
}

/** Goal node in the ontology graph. */
export interface GoalNode extends OntologyNodeBase {
  goalId: string;
  title: string;
  objective: string;
  status: string;
  riskLevel: string;
}

/** Criterion node linked to a Goal. */
export interface CriterionNode extends OntologyNodeBase {
  criterionId: string;
  description: string;
  requirement: string;
  weight: number;
}

/** Evidence node for goal verification. */
export interface EvidenceNode extends OntologyNodeBase {
  evidenceId: string;
  passed: boolean;
  message: string;
  checkedAt: string;
}

/** Decision node capturing project decisions. */
export interface DecisionNode extends OntologyNodeBase {
  decisionId: string;
  description: string;
  decidedAt: string;
}

/** Task node for actionable work items. */
export interface TaskNode extends OntologyNodeBase {
  taskId: string;
  description: string;
  status: string;
  priority: string;
}

/** Risk node for tracked risks. */
export interface RiskNode extends OntologyNodeBase {
  riskId: string;
  description: string;
  level: string;
}

/** Command node for recorded commands. */
export interface CommandNode extends OntologyNodeBase {
  commandId: string;
  command: string;
  description: string;
}

/** File node for referenced files. */
export interface FileNode extends OntologyNodeBase {
  path: string;
  description: string;
}

/** Skill node for available skills. */
export interface SkillNode extends OntologyNodeBase {
  name: string;
  description: string;
}

/** MCP Server node for configured MCP servers. */
export interface MCPServerNode extends OntologyNodeBase {
  name: string;
  description: string;
}

/** Provider node for Kimi-first multi-provider orchestration. */
export interface ProviderNode extends OntologyNodeBase {
  providerId: "kimi" | "deepseek";
  role: "primary" | "opportunistic";
  description: string;
}

/** Provider route decision node for DAG node execution. */
export interface ProviderRouteNode extends OntologyNodeBase {
  routeId: string;
  nodeId: string;
  requestedProvider: string;
  actualProvider: string;
  reason: string;
  confidence: number;
}

/** Provider fallback event node for preserving run evidence. */
export interface ProviderFallbackNode extends OntologyNodeBase {
  fallbackId: string;
  nodeId: string;
  fromProvider: string;
  toProvider: string;
  reason: string;
}

/** Audit link node connecting reports/evidence to runs, goals, files, or providers. */
export interface AuditLinkNode extends OntologyNodeBase {
  linkId: string;
  label: string;
  target: string;
  targetType: string;
}

/** Minimal executor interface accepted by {@link createOntologyConstraints}. */
export interface OntologyConstraintExecutor {
  executeQuery(query: string, params?: Record<string, unknown>, options?: { database?: string }): Promise<unknown>;
}

/**
 * Create unique constraints for every ontology node type.
 * Each constraint enforces uniqueness on `(projectId, id)` for the label.
 */
export async function createOntologyConstraints(
  executor: OntologyConstraintExecutor,
  database?: string
): Promise<void> {
  const options = database ? { database } : undefined;
  for (const nodeType of ONTOLOGY_NODE_TYPES) {
    const label = `Omk${nodeType}`;
    const constraintName = `omk_${nodeType.toLowerCase()}_project_id_unique`;
    await executor.executeQuery(
      `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS FOR (n:${label}) REQUIRE (n.projectId, n.id) IS UNIQUE`,
      {},
      options
    );
  }
}

/** Kuzu DDL statements for the full OMK ontology schema. */
export interface KuzuOntologySchema {
  nodeTables: string[];
  relTables: string[];
}

/** Build Kuzu CREATE NODE TABLE / CREATE REL TABLE DDLs from the ontology model. */
export function buildKuzuOntologySchema(): KuzuOntologySchema {
  const baseProps =
    "id STRING PRIMARY KEY, projectId STRING, workspaceRootHash STRING, schemaVersion INT64, createdAt STRING, updatedAt STRING";

  const nodeTables: string[] = [
    `CREATE NODE TABLE OmkGoal (${baseProps}, goalId STRING, title STRING, objective STRING, status STRING, riskLevel STRING)`,
    `CREATE NODE TABLE OmkCriterion (${baseProps}, criterionId STRING, description STRING, requirement STRING, weight INT64)`,
    `CREATE NODE TABLE OmkEvidence (${baseProps}, evidenceId STRING, passed BOOLEAN, message STRING, checkedAt STRING)`,
    `CREATE NODE TABLE OmkDecision (${baseProps}, decisionId STRING, description STRING, decidedAt STRING)`,
    `CREATE NODE TABLE OmkTask (${baseProps}, taskId STRING, description STRING, status STRING, priority STRING)`,
    `CREATE NODE TABLE OmkRisk (${baseProps}, riskId STRING, description STRING, level STRING)`,
    `CREATE NODE TABLE OmkConstraint (${baseProps}, constraintId STRING, description STRING)`,
    `CREATE NODE TABLE OmkFile (${baseProps}, path STRING, description STRING)`,
    `CREATE NODE TABLE OmkSymbol (${baseProps}, symbolId STRING, name STRING, kind STRING)`,
    `CREATE NODE TABLE OmkTest (${baseProps}, testId STRING, name STRING, status STRING)`,
    `CREATE NODE TABLE OmkCommand (${baseProps}, commandId STRING, command STRING, description STRING)`,
    `CREATE NODE TABLE OmkCommit (${baseProps}, commitId STRING, message STRING, author STRING)`,
    `CREATE NODE TABLE OmkMCPServer (${baseProps}, name STRING, description STRING)`,
    `CREATE NODE TABLE OmkSkill (${baseProps}, name STRING, description STRING)`,
    `CREATE NODE TABLE OmkProvider (${baseProps}, providerId STRING, role STRING, description STRING)`,
    `CREATE NODE TABLE OmkProviderRoute (${baseProps}, routeId STRING, nodeId STRING, requestedProvider STRING, actualProvider STRING, reason STRING, confidence DOUBLE)`,
    `CREATE NODE TABLE OmkProviderFallback (${baseProps}, fallbackId STRING, nodeId STRING, fromProvider STRING, toProvider STRING, reason STRING)`,
    `CREATE NODE TABLE OmkRun (${baseProps}, runId STRING, status STRING, startedAt STRING)`,
    `CREATE NODE TABLE OmkAuditLink (${baseProps}, linkId STRING, label STRING, target STRING, targetType STRING)`,
  ];

  const relTables: string[] = [
    `CREATE REL TABLE HAS_GOAL (FROM OmkProject TO OmkGoal)`,
    `CREATE REL TABLE HAS_RUN (FROM OmkProject TO OmkRun)`,
    `CREATE REL TABLE HAS_CRITERION (FROM OmkGoal TO OmkCriterion)`,
    `CREATE REL TABLE HAS_EVIDENCE (FROM OmkCriterion TO OmkEvidence)`,
    `CREATE REL TABLE HAS_DECISION (FROM OmkProject TO OmkDecision)`,
    `CREATE REL TABLE HAS_TASK (FROM OmkProject TO OmkTask)`,
    `CREATE REL TABLE DEPENDS_ON (FROM OmkTask TO OmkTask)`,
    `CREATE REL TABLE HAS_RISK (FROM OmkProject TO OmkRisk)`,
    `CREATE REL TABLE HAS_FILE (FROM OmkProject TO OmkFile)`,
    `CREATE REL TABLE HAS_SYMBOL (FROM OmkFile TO OmkSymbol)`,
    `CREATE REL TABLE HAS_TEST (FROM OmkProject TO OmkTest)`,
    `CREATE REL TABLE HAS_COMMAND (FROM OmkProject TO OmkCommand)`,
    `CREATE REL TABLE HAS_COMMIT (FROM OmkProject TO OmkCommit)`,
    `CREATE REL TABLE USES_MCP (FROM OmkProject TO OmkMCPServer)`,
    `CREATE REL TABLE USES_SKILL (FROM OmkProject TO OmkSkill)`,
    `CREATE REL TABLE USES_PROVIDER (FROM OmkProject TO OmkProvider)`,
    `CREATE REL TABLE HAS_PROVIDER_ROUTE (FROM OmkTask TO OmkProviderRoute)`,
    `CREATE REL TABLE ROUTES_TO (FROM OmkProviderRoute TO OmkProvider)`,
    `CREATE REL TABLE FALLS_BACK_TO (FROM OmkProviderRoute TO OmkProvider)`,
    `CREATE REL TABLE HAS_PROVIDER_FALLBACK (FROM OmkTask TO OmkProviderFallback)`,
    `CREATE REL TABLE HAS_AUDIT_LINK (FROM OmkProject TO OmkAuditLink)`,
    `CREATE REL TABLE LINKS_TO (FROM OmkAuditLink TO OmkFile)`,
  ];

  return { nodeTables, relTables };
}

/** Cypher write keywords rejected by the read-only graph query guard. */
export const MUTATION_KEYWORDS = ["CREATE", "DELETE", "SET", "REMOVE", "MERGE", "DROP"];

/**
 * Return true if the provided Cypher query contains write mutations.
 * Strips line comments and block comments before scanning.
 */
export function containsMutation(query: string): boolean {
  const normalized = query
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return MUTATION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}
