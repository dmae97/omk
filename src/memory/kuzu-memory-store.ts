import { createHash } from "crypto";
import { mkdir } from "fs/promises";
import { dirname, join, resolve } from "path";
import {
  loadMemorySettings,
  summarizeMemorySettings,
  type MemorySettings,
  type MemoryStatus,
} from "./memory-config.js";
import type {
  MemoryOntology,
  MemoryMindmap,
  MemorySearchResult,
  GraphQueryResult,
} from "./local-graph-memory-store.js";
import { extractConcepts, ONTOLOGY } from "./local-graph-memory-store.js";
import { buildKuzuOntologySchema } from "./ontology-model.js";

// Lazy-load kuzu to avoid hard dependency at import time
type KuzuMod = typeof import("kuzu");
type KuzuDatabase = InstanceType<KuzuMod["Database"]>;
type KuzuConnection = InstanceType<KuzuMod["Connection"]>;
type KuzuQueryResult = InstanceType<KuzuMod["QueryResult"]>;

let kuzuCtor: { Database: KuzuMod["Database"]; Connection: KuzuMod["Connection"] } | undefined;
async function getKuzu(): Promise<{ Database: KuzuMod["Database"]; Connection: KuzuMod["Connection"] }> {
  if (!kuzuCtor) {
    try {
      const mod = await import("kuzu");
      kuzuCtor = mod as unknown as typeof kuzuCtor;
    } catch {
      throw new Error(
        "kuzu is not installed. Run: npm install kuzu (or yarn add kuzu) to enable the kuzu memory backend."
      );
    }
  }
  return kuzuCtor!;
}

export interface KuzuMemoryStoreOptions {
  projectRoot?: string;
  sessionId?: string;
  source?: string;
  env?: NodeJS.ProcessEnv;
}

export class KuzuMemoryStore {
  private db?: KuzuDatabase;
  private conn?: KuzuConnection;
  private schemaReady = false;

  constructor(
    private readonly settings: MemorySettings,
    private readonly source = "omk-memory"
  ) {}

  static async create(options: KuzuMemoryStoreOptions = {}): Promise<KuzuMemoryStore | null> {
    const env = options.sessionId
      ? { ...(options.env ?? process.env), OMK_SESSION_ID: options.sessionId }
      : options.env ?? process.env;
    const settings = await loadMemorySettings(options.projectRoot, env);
    if (settings.backend !== "kuzu") return null;
    return new KuzuMemoryStore(settings, options.source ?? "omk-memory");
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

  private get dbPath(): string {
    const root = this.settings.project.root;
    return resolve(join(root, ".omk", "memory", "kuzu.db"));
  }

  private async ensureDb(): Promise<void> {
    if (this.db && this.conn) return;
    const Kuzu = await getKuzu();
    await mkdir(dirname(this.dbPath), { recursive: true });
    this.db = new Kuzu.Database(this.dbPath);
    this.conn = new Kuzu.Connection(this.db);
  }

  private async runQuery(query: string): Promise<KuzuQueryResult> {
    if (!this.conn) throw new Error("Kuzu connection not initialized");
    const result = await this.conn.query(query);
    return Array.isArray(result) ? result[0] : result;
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.ensureDb();
    if (!this.conn) throw new Error("Kuzu connection not initialized");

    const tables = await this.getTables();

    const nodeTables = [
      `CREATE NODE TABLE OmkProject (projectKey STRING PRIMARY KEY, name STRING, root STRING, updatedAt STRING)`,
      `CREATE NODE TABLE OmkSession (sessionKey STRING PRIMARY KEY, sessionId STRING, projectKey STRING, updatedAt STRING)`,
      `CREATE NODE TABLE OmkMemory (path STRING PRIMARY KEY, content STRING, projectKey STRING, sessionId STRING, source STRING, updatedAt STRING)`,
      `CREATE NODE TABLE OmkMemoryVersion (versionKey STRING PRIMARY KEY, path STRING, content STRING, projectKey STRING, sessionId STRING, source STRING, createdAt STRING)`,
    ];

    for (const ddl of nodeTables) {
      const tableName = extractTableName(ddl);
      if (!tables.has(tableName)) {
        try {
          await this.conn.query(ddl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("already exists")) throw err;
        }
      }
    }

    const relTables = [
      `CREATE REL TABLE HAS_SESSION (FROM OmkProject TO OmkSession)`,
      `CREATE REL TABLE HAS_MEMORY (FROM OmkProject TO OmkMemory)`,
      `CREATE REL TABLE WROTE (FROM OmkSession TO OmkMemoryVersion)`,
      `CREATE REL TABLE UPDATES (FROM OmkMemoryVersion TO OmkMemory)`,
    ];

    for (const ddl of relTables) {
      const tableName = extractTableName(ddl);
      if (!tables.has(tableName)) {
        try {
          await this.conn.query(ddl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("already exists")) throw err;
        }
      }
    }

    // Ontology node / relationship tables
    const ontologySchema = buildKuzuOntologySchema();
    for (const ddl of ontologySchema.nodeTables) {
      const tableName = extractTableName(ddl);
      if (!tables.has(tableName)) {
        try {
          await this.conn.query(ddl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("already exists")) throw err;
        }
      }
    }
    for (const ddl of ontologySchema.relTables) {
      const tableName = extractTableName(ddl);
      if (!tables.has(tableName)) {
        try {
          await this.conn.query(ddl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("already exists")) throw err;
        }
      }
    }

    this.schemaReady = true;
  }

  private async getTables(): Promise<Set<string>> {
    if (!this.conn) return new Set();
    try {
      const result = await this.runQuery("CALL show_tables() RETURN *");
      const rows = await result.getAll();
      const names = new Set<string>();
      for (const row of rows as Array<Record<string, unknown>>) {
        const name = row.name ?? row["table name"] ?? row["Name"];
        if (typeof name === "string") names.add(name);
      }
      return names;
    } catch {
      return new Set();
    }
  }

  private escapeString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  async read(path: string): Promise<string> {
    await this.ensureSchema();
    if (!this.conn) return "";
    const projectKey = this.escapeString(this.settings.project.key);
    const memoryKey = this.escapeString(this.memoryKey(path));
    const escapedPath = this.escapeString(path);
    try {
      const result = await this.runQuery(
        `MATCH (v:OmkMemoryVersion {path: "${escapedPath}", projectKey: "${projectKey}"}) RETURN v.content AS content, v.createdAt AS createdAt ORDER BY v.createdAt DESC LIMIT 1`
      );
      const rows = (await result.getAll()) as Array<Record<string, unknown>>;
      const content = rows[0]?.content;
      if (typeof content === "string") return content;
    } catch {
      // Fallback below reads the legacy summary field.
    }
    try {
      const result = await this.runQuery(
        `MATCH (m:OmkMemory {path: "${memoryKey}", projectKey: "${projectKey}"}) RETURN m.content AS content`
      );
      const rows = (await result.getAll()) as Array<Record<string, unknown>>;
      const content = rows[0]?.content;
      return typeof content === "string" ? content : "";
    } catch {
      return "";
    }
  }

  async write(path: string, content: string): Promise<void> {
    await this.ensureSchema();
    if (!this.conn) throw new Error("Kuzu connection not initialized");
    const now = new Date().toISOString();
    const memoryKey = this.escapeString(this.memoryKey(path));
    const versionKey = this.escapeString(this.versionKey(path, content, now));
    const projectKey = this.escapeString(this.settings.project.key);
    const projectName = this.escapeString(this.settings.project.name);
    const projectRoot = this.escapeString(this.settings.project.root);
    const sessionKey = this.escapeString(this.settings.session.key);
    const sessionId = this.escapeString(this.settings.session.id);
    const escapedPath = this.escapeString(path);
    const escapedContent = this.escapeString(content.length <= 1000 ? content : `${content.slice(0, 999)}…`);
    const escapedVersionContent = this.escapeString(content);
    const source = this.escapeString(this.source);

    // Upsert project
    await this.conn.query(
      `CREATE (p:OmkProject {projectKey: "${projectKey}", name: "${projectName}", root: "${projectRoot}", updatedAt: "${now}"})`
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate") || msg.includes("constraint")) {
        // Update instead
        return this.conn!.query(
          `MATCH (p:OmkProject {projectKey: "${projectKey}"}) SET p.name = "${projectName}", p.root = "${projectRoot}", p.updatedAt = "${now}"`
        );
      }
      throw err;
    });

    // Upsert session
    await this.conn.query(
      `CREATE (s:OmkSession {sessionKey: "${sessionKey}", sessionId: "${sessionId}", projectKey: "${projectKey}", updatedAt: "${now}"})`
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate") || msg.includes("constraint")) {
        return this.conn!.query(
          `MATCH (s:OmkSession {sessionKey: "${sessionKey}"}) SET s.sessionId = "${sessionId}", s.projectKey = "${projectKey}", s.updatedAt = "${now}"`
        );
      }
      throw err;
    });

    // Link project -> session
    await this.conn.query(
      `MATCH (p:OmkProject {projectKey: "${projectKey}"}), (s:OmkSession {sessionKey: "${sessionKey}"}) CREATE (p)-[:HAS_SESSION]->(s)`
    ).catch(() => {
      // ignore duplicate rel errors
    });

    // Upsert memory
    await this.conn.query(
      `CREATE (m:OmkMemory {path: "${memoryKey}", content: "${escapedContent}", projectKey: "${projectKey}", sessionId: "${sessionId}", source: "${source}", updatedAt: "${now}"})`
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate") || msg.includes("constraint")) {
        return this.conn!.query(
          `MATCH (m:OmkMemory {path: "${memoryKey}"}) SET m.content = "${escapedContent}", m.projectKey = "${projectKey}", m.sessionId = "${sessionId}", m.source = "${source}", m.updatedAt = "${now}"`
        );
      }
      throw err;
    });

    // Link project -> memory
    await this.conn.query(
      `MATCH (p:OmkProject {projectKey: "${projectKey}"}), (m:OmkMemory {path: "${memoryKey}"}) CREATE (p)-[:HAS_MEMORY]->(m)`
    ).catch(() => {
      // ignore duplicate rel errors
    });

    // Create version node
    await this.conn.query(
      `CREATE (v:OmkMemoryVersion {versionKey: "${versionKey}", path: "${escapedPath}", content: "${escapedVersionContent}", projectKey: "${projectKey}", sessionId: "${sessionId}", source: "${source}", createdAt: "${now}"})`
    );

    // Link session -> version
    await this.conn.query(
      `MATCH (s:OmkSession {sessionKey: "${sessionKey}"}), (v:OmkMemoryVersion {versionKey: "${versionKey}"}) CREATE (s)-[:WROTE]->(v)`
    ).catch(() => {
      // ignore duplicate rel errors
    });

    // Link version -> memory
    await this.conn.query(
      `MATCH (v:OmkMemoryVersion {versionKey: "${versionKey}"}), (m:OmkMemory {path: "${memoryKey}"}) CREATE (v)-[:UPDATES]->(m)`
    ).catch(() => {
      // ignore duplicate rel errors
    });

    await this.writeConcepts(path, content, now);
  }

  private async writeConcepts(path: string, content: string, now: string): Promise<void> {
    if (!this.conn) return;
    const allConcepts = extractConcepts(content);
    const MAX_CONCEPTS = 50;
    const concepts = allConcepts.slice(0, MAX_CONCEPTS);
    if (concepts.length === 0 && allConcepts.length === 0) return;

    const memoryKey = this.escapeString(this.memoryKey(path));
    const projectKey = this.escapeString(this.settings.project.key);

    // Ensure concept node tables exist (dynamically)
    const tables = await this.getTables();
    for (const concept of concepts) {
      const tableName = `Omk${concept.type}`;
      const relName = `HAS_${concept.type.toUpperCase()}`;
      if (!tables.has(tableName)) {
        try {
          await this.conn.query(
            `CREATE NODE TABLE ${tableName} (conceptId STRING PRIMARY KEY, label STRING, summary STRING, path STRING, projectKey STRING, updatedAt STRING)`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("already exists")) throw err;
        }
      }
      if (!tables.has(relName)) {
        try {
          await this.conn.query(
            `CREATE REL TABLE ${relName} (FROM OmkMemory TO ${tableName})`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("already exists")) throw err;
        }
      }

      const conceptId = this.escapeString(hash(`${projectKey}:${path}:${concept.line}:${concept.label}`));
      const label = this.escapeString(concept.label);
      const summary = this.escapeString(concept.summary);
      const escapedPath = this.escapeString(path);

      await this.conn.query(
        `CREATE (c:${tableName} {conceptId: "${conceptId}", label: "${label}", summary: "${summary}", path: "${escapedPath}", projectKey: "${projectKey}", updatedAt: "${now}"})`
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("duplicate") || msg.includes("constraint")) {
          return this.conn!.query(
            `MATCH (c:${tableName} {conceptId: "${conceptId}"}) SET c.label = "${label}", c.summary = "${summary}", c.path = "${escapedPath}", c.projectKey = "${projectKey}", c.updatedAt = "${now}"`
          );
        }
        throw err;
      });

      await this.conn.query(
        `MATCH (m:OmkMemory {path: "${memoryKey}"}), (c:${tableName} {conceptId: "${conceptId}"}) CREATE (m)-[:${relName}]->(c)`
      ).catch(() => {
        // ignore duplicate rel errors
      });
    }
  }

  async append(path: string, content: string): Promise<void> {
    const existing = await this.read(path);
    await this.write(path, existing ? `${existing}\n${content}` : content);
  }

  async search(query: string, limit = 10): Promise<MemorySearchResult[]> {
    await this.ensureSchema();
    if (!this.conn) return [];
    const projectKey = this.escapeString(this.settings.project.key);
    const escapedQuery = this.escapeString(query.toLowerCase());
    try {
      const result = await this.runQuery(
        `MATCH (m:OmkMemory {projectKey: "${projectKey}"})
         WHERE contains(lower(m.content), "${escapedQuery}")
         RETURN m.path AS path, m.content AS content, m.sessionId AS sessionId, m.updatedAt AS updatedAt, m.source AS source
         LIMIT ${Math.max(1, limit)}`
      );
      const rows = (await result.getAll()) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        path: String(row.path ?? ""),
        content: String(row.content ?? ""),
        sessionId: String(row.sessionId ?? ""),
        updatedAt: String(row.updatedAt ?? ""),
        source: String(row.source ?? ""),
      }));
    } catch {
      return [];
    }
  }

  async ontology(): Promise<MemoryOntology> {
    return ONTOLOGY;
  }

  async mindmap(query?: string, limit = 20): Promise<MemoryMindmap | null> {
    await this.ensureSchema();
    if (!this.conn) return null;
    const projectKey = this.escapeString(this.settings.project.key);
    const l = Math.max(1, limit);

    try {
      const result = await this.runQuery(
        `MATCH (p:OmkProject {projectKey: "${projectKey}"})-[:HAS_MEMORY]->(m:OmkMemory)
         RETURN m.path AS path, m.content AS content
         LIMIT ${l}`
      );
      const rows = (await result.getAll()) as Array<Record<string, unknown>>;

      const root: MemoryMindmap["root"] = {
        id: projectKey,
        type: "Project",
        label: this.settings.project.name,
        children: [],
      };

      const nodes: MemoryMindmap["nodes"] = [];
      const edges: MemoryMindmap["edges"] = [];

      for (const row of rows) {
        const path = String(row.path ?? "");
        const content = String(row.content ?? "");
        const nodeId = hash(`${projectKey}:memory:${path}`);
        nodes.push({
          id: nodeId,
          type: "Memory",
          label: path.split("/").pop() ?? path,
          path,
          summary: content.slice(0, 120),
        });
        edges.push({ from: root.id, to: nodeId, type: "HAS_MEMORY" });
        root.children.push({
          id: nodeId,
          type: "Memory",
          label: path.split("/").pop() ?? path,
          children: [],
        });
      }

      if (query) {
        const escapedQuery = this.escapeString(query);
        try {
          const conceptResult = await this.runQuery(
            `MATCH (m:OmkMemory {projectKey: "${projectKey}"})-[:HAS_TOPIC|HAS_DECISION|HAS_TASK|HAS_RISK|HAS_CONCEPT]->(c)
             WHERE contains(lower(c.label), "${escapedQuery}") OR contains(lower(c.summary), "${escapedQuery}")
             RETURN c.conceptId AS id, labels(c) AS types, c.label AS label, c.summary AS summary
             LIMIT ${l}`
          );
          const conceptRows = (await conceptResult.getAll()) as Array<Record<string, unknown>>;
          for (const row of conceptRows) {
            const id = String(row.id ?? "");
            const types = Array.isArray(row.types) ? row.types : [String(row.types ?? "Concept")];
            const label = String(row.label ?? "");
            const summary = String(row.summary ?? "");
            nodes.push({
              id,
              type: types[0] ?? "Concept",
              label,
              summary: summary.slice(0, 120),
            });
          }
        } catch {
          // ignore concept query errors
        }
      }

      return { root, nodes, edges, ontology: ONTOLOGY };
    } catch {
      return null;
    }
  }

  async graphQuery(query: string): Promise<GraphQueryResult> {
    await this.ensureSchema();
    if (!this.conn) {
      throw new Error("Kuzu connection not initialized");
    }
    if (!isReadOnlyQuery(query)) {
      throw new Error("omk_graph_query only supports read-only Cypher queries on kuzu backend");
    }
    try {
      const result = await this.runQuery(query);
      const rows = (await result.getAll()) as Array<Record<string, unknown>>;
      return {
        data: rows,
        extensions: {
          dialect: "cypher",
          backend: "kuzu",
        },
      };
    } catch (err) {
      throw new Error(`Kuzu graph query failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private memoryKey(path: string): string {
    return hash(`${this.settings.project.key}:${path}`);
  }

  private versionKey(path: string, content: string, now: string): string {
    return hash(`${this.settings.project.key}:${path}:${content}:${now}`);
  }
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function extractTableName(ddl: string): string {
  const match = ddl.match(/CREATE\s+(?:NODE|REL)\s+TABLE\s+(\w+)/i);
  return match?.[1] ?? "";
}

function isReadOnlyQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  const writeKeywords = [
    "create ",
    "merge ",
    "set ",
    "delete ",
    "remove ",
    "drop ",
    "call create_",
  ];
  return !writeKeywords.some((kw) => normalized.includes(kw));
}
