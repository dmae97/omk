import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { basename, join, resolve } from "path";
import {
  type EmbeddingConfig,
  loadEmbeddingConfig,
  redactEmbeddingConfig,
} from "./embedding.js";

export type MemoryBackend = "local_graph" | "kuzu";

export interface MemorySettings {
  backend: MemoryBackend;
  strict: boolean;
  force: boolean;
  mirrorFiles: boolean;
  migrateFiles: boolean;
  project: {
    key: string;
    name: string;
    root: string;
  };
  session: {
    id: string;
    key: string;
  };
  localGraph: {
    path: string;
    ontology: string;
    query: "graphql-lite";
    configured: boolean;
  };
  embedding: EmbeddingConfig;
}

export interface MemoryStatus {
  backend: MemoryBackend;
  strict: boolean;
  force: boolean;
  mirrorFiles: boolean;
  migrateFiles: boolean;
  projectKey: string;
  projectName: string;
  sessionId: string;
  localGraph: {
    configured: boolean;
    path: string;
    ontology: string;
    query: "graphql-lite";
  };
  embedding: Omit<EmbeddingConfig, "apiKey">;
}

type FlatToml = Record<string, string>;

type Env = NodeJS.ProcessEnv;

const FALLBACK_SESSION_ID = `process-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

export const GLOBAL_MEMORY_CONFIG_TOML = `# oh-my-kimi global memory policy
# Default is project-local graph memory: open-source friendly, no daemon, no secrets.
# Use backend = "kuzu" when you want the embedded Kuzu graph backend.
[memory]
backend = "local_graph"    # local_graph | kuzu
scope = "project-session"
strict = true               # fail memory writes if the selected graph backend is unavailable
force = true                # global policy wins over project-local backend overrides
mirror_files = true         # keep .omk/memory/*.md as readable mirrors
migrate_files = true        # seed the graph from existing .omk/memory files on first read

[local_graph]
path = ".omk/memory/graph-state.json"
ontology = "omk-ontology-mindmap-v1"
query = "graphql-lite"
`;

export function getGlobalMemoryConfigPath(): string {
  return join(homedir(), ".kimi", "omk.memory.toml");
}

export function isGraphMemoryBackend(backend: MemoryBackend): boolean {
  return backend === "local_graph" || backend === "kuzu";
}

export function usesLocalGraphBackend(backend: MemoryBackend): boolean {
  return backend === "local_graph";
}

export function usesKuzuBackend(backend: MemoryBackend): boolean {
  return backend === "kuzu";
}

export async function loadMemorySettings(projectRoot = process.cwd(), env: Env = process.env): Promise<MemorySettings> {
  const normalizedRoot = resolve(projectRoot);
  const [globalConfig, projectConfig] = await Promise.all([
    readSimpleToml(getGlobalMemoryConfigPath()),
    readSimpleToml(join(normalizedRoot, ".omk", "config.toml")),
  ]);

  const envForce = parseOptionalBoolean(env.OMK_MEMORY_FORCE);
  const force = envForce ?? readBoolean(globalConfig, "memory.force") ?? false;

  const readSetting = (key: string): string | undefined => {
    const envKey = toEnvKey(key);
    const envValue = env[envKey];
    if (envValue !== undefined && envValue !== "") return envValue;
    return force ? globalConfig[key] ?? projectConfig[key] : projectConfig[key] ?? globalConfig[key];
  };

  const backend = normalizeBackend(env.OMK_MEMORY_BACKEND ?? readSetting("memory.backend"));
  const strict = parseOptionalBoolean(env.OMK_MEMORY_STRICT) ?? parseOptionalBoolean(readSetting("memory.strict")) ?? true;
  const mirrorFiles = parseOptionalBoolean(env.OMK_MEMORY_MIRROR_FILES) ?? parseOptionalBoolean(readSetting("memory.mirror_files")) ?? true;
  const migrateFiles = parseOptionalBoolean(env.OMK_MEMORY_MIGRATE_FILES) ?? parseOptionalBoolean(readSetting("memory.migrate_files")) ?? true;

  const projectName = env.OMK_PROJECT_NAME ?? readSetting("project.name") ?? (basename(normalizedRoot) || "project");
  const projectKey = env.OMK_PROJECT_ID ?? readSetting("memory.project_id") ?? `${basename(normalizedRoot) || "project"}:${hashShort(normalizedRoot)}`;
  const sessionId = env.OMK_SESSION_ID ?? env.OMK_RUN_ID ?? env.KIMI_SESSION_ID ?? FALLBACK_SESSION_ID;
  const sessionKey = `${projectKey}:${sessionId}`;

  const localGraphPath = resolve(
    normalizedRoot,
    env.OMK_LOCAL_GRAPH_PATH ?? readSetting("local_graph.path") ?? ".omk/memory/graph-state.json"
  );
  const localGraphOntology = env.OMK_LOCAL_GRAPH_ONTOLOGY ?? readSetting("local_graph.ontology") ?? "omk-ontology-mindmap-v1";

  const embedding = loadEmbeddingConfig(env);

  return {
    backend,
    strict,
    force,
    mirrorFiles,
    migrateFiles,
    project: {
      key: projectKey,
      name: projectName,
      root: normalizedRoot,
    },
    session: {
      id: sessionId,
      key: sessionKey,
    },
    localGraph: {
      path: localGraphPath,
      ontology: localGraphOntology,
      query: "graphql-lite",
      configured: true,
    },
    embedding,
  };
}

export function summarizeMemorySettings(settings: MemorySettings): MemoryStatus {
  return {
    backend: settings.backend,
    strict: settings.strict,
    force: settings.force,
    mirrorFiles: settings.mirrorFiles,
    migrateFiles: settings.migrateFiles,
    projectKey: settings.project.key,
    projectName: settings.project.name,
    sessionId: settings.session.id,
    localGraph: {
      configured: settings.localGraph.configured,
      path: settings.localGraph.path,
      ontology: settings.localGraph.ontology,
      query: settings.localGraph.query,
    },
    embedding: redactEmbeddingConfig(settings.embedding),
  };
}

async function readSimpleToml(path: string): Promise<FlatToml> {
  try {
    const content = await readFile(path, "utf-8");
    return parseSimpleToml(content);
  } catch {
    return {};
  }
}

function parseSimpleToml(content: string): FlatToml {
  const result: FlatToml = {};
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = section ? `${section}.${kv[1].trim()}` : kv[1].trim();
    result[key] = normalizeTomlValue(kv[2].trim());
  }
  return result;
}

function stripComment(line: string): string {
  let inString = false;
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        quote = char;
      } else if (quote === char) {
        inString = false;
      }
    }
    if (char === "#" && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}

function normalizeTomlValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeBackend(value: string | undefined): MemoryBackend {
  if (value === "local_graph" || value === "kuzu") return value;
  if (value === "graph" || value === "local-graph") return "local_graph";
  // Legacy external graph-database settings are intentionally downgraded to the
  // local ontology graph. Kuzu remains available through backend = "kuzu".
  return "local_graph";
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function readBoolean(config: FlatToml, key: string): boolean | undefined {
  return parseOptionalBoolean(config[key]);
}

function toEnvKey(key: string): string {
  return `OMK_${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
