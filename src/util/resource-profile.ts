import { readFile } from "fs/promises";
import { totalmem } from "os";
import { join } from "path";
import {
  getProjectRoot,
  getProjectRootAsync,
  getProjectRootDiagnostics,
  resolveProjectRoot,
  resolveProjectRootAsync,
  displayProjectRootPath,
  type ProjectRootResolution,
  type ProjectRootSource,
} from "./project-root.js";
import { parseExecutionPromptPolicy } from "./execution-selection.js";
import type { ExecutionPromptPolicy } from "../contracts/orchestration.js";

export {
  getProjectRoot,
  getProjectRootAsync,
  getProjectRootDiagnostics,
  resolveProjectRoot,
  resolveProjectRootAsync,
  displayProjectRootPath,
  type ProjectRootResolution,
  type ProjectRootSource,
};

export type OmkResourceProfile = "lite" | "standard" | "super";
export type OmkResourceProfileRequest = OmkResourceProfile | "auto";
export type OmkRuntimeScope = "all" | "project" | "none";

export interface OmkResourceSettings {
  requestedProfile: OmkResourceProfileRequest;
  profile: OmkResourceProfile;
  reason: string;
  totalMemoryGb: number;
  maxWorkers: number;
  shellMaxBufferBytes: number;
  wireOutputBytes: number;
  renderLogo: boolean;
  mcpScope: OmkRuntimeScope;
  skillsScope: OmkRuntimeScope;
  hooksScope: OmkRuntimeScope;
  executionPrompt: ExecutionPromptPolicy;
  ensembleDefaultEnabled: boolean;
  localeLanguage: string;
}

type FlatToml = Record<string, string>;

const LITE_MEMORY_THRESHOLD_GB = 18;
const MIB = 1024 * 1024;

let settingsCache: Promise<OmkResourceSettings> | undefined;

export function resetOmkResourceSettingsCache(): void {
  settingsCache = undefined;
}

export interface OmkActivePreset {
  skills: string[];
  hooks: string[];
  mcpServers: string[];
}

export async function getActiveRuntimePreset(): Promise<OmkActivePreset | undefined> {
  try {
    const content = await readFile(join(await getProjectRootAsync(), ".omk", "runtime-preset.json"), "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      return {
        skills: Array.isArray(record.skills) ? (record.skills as string[]) : [],
        hooks: Array.isArray(record.hooks) ? (record.hooks as string[]) : [],
        mcpServers: Array.isArray(record.mcpServers) ? (record.mcpServers as string[]) : [],
      };
    }
  } catch {
    // ignore missing or invalid preset file
  }
  return undefined;
}

export async function getOmkResourceSettings(): Promise<OmkResourceSettings> {
  settingsCache ??= loadOmkResourceSettings();
  return settingsCache;
}

async function loadOmkResourceSettings(): Promise<OmkResourceSettings> {
  const env = process.env;
  const projectRoot = await getProjectRootAsync();
  const config = await readSimpleToml(join(projectRoot, ".omk", "config.toml"));
  const totalMemoryGb = Number((totalmem() / 1024 / 1024 / 1024).toFixed(1));

  const requestedProfile = normalizeProfileRequest(
    env.OMK_RESOURCE_PROFILE
      ?? env.OMK_RUNTIME_PROFILE
      ?? optimizeEnvToProfile(env.OMK_OPTIMIZE)
      ?? config["runtime.resource_profile"]
      ?? "auto"
  );

  const autoLite = totalMemoryGb > 0 && totalMemoryGb <= LITE_MEMORY_THRESHOLD_GB;
  const profile: OmkResourceProfile = requestedProfile === "auto"
    ? autoLite ? "lite" : "standard"
    : requestedProfile;
  const reason = requestedProfile === "auto"
    ? autoLite
      ? `auto-detected <=${LITE_MEMORY_THRESHOLD_GB}GB RAM host`
      : `auto-detected >${LITE_MEMORY_THRESHOLD_GB}GB RAM host`
    : `requested by ${profileSource(env, config)}`;

  const maxWorkers = parsePositiveInt(env.OMK_MAX_WORKERS ?? config["runtime.max_workers"])
    ?? (profile === "lite" ? 1 : profile === "super" ? 4 : 2);

  const shellMaxBufferBytes = parseMib(env.OMK_MAX_OUTPUT_MB)
    ?? parseBytes(env.OMK_MAX_OUTPUT_BYTES)
    ?? parseMib(config["runtime.max_output_mb"])
    ?? (profile === "lite" ? 4 * MIB : 20 * MIB);

  const wireOutputBytes = parseMib(env.OMK_WIRE_OUTPUT_MB)
    ?? parseBytes(env.OMK_WIRE_MAX_OUTPUT_BYTES)
    ?? parseMib(config["runtime.wire_output_mb"])
    ?? (profile === "lite" ? 1 * MIB : 8 * MIB);

  const renderLogo = parseOptionalBoolean(env.OMK_RENDER_LOGO ?? config["theme.render_logo"])
    ?? profile !== "lite";

  const mcpScope = normalizeScope(env.OMK_MCP_SCOPE ?? config["runtime.mcp_scope"], "project");
  const skillsScope = normalizeScope(env.OMK_SKILLS_SCOPE ?? config["runtime.skills_scope"], "project");
  const hooksScope = normalizeScope(env.OMK_HOOKS_SCOPE ?? config["runtime.hooks_scope"], "project");
  const rawExecutionPrompt = env.OMK_EXECUTION_PROMPT ?? config["orchestration.execution_prompt"];
  const executionPromptSource = env.OMK_EXECUTION_PROMPT !== undefined
    ? "OMK_EXECUTION_PROMPT"
    : config["orchestration.execution_prompt"] !== undefined
      ? ".omk/config.toml orchestration.execution_prompt"
      : "orchestration.execution_prompt";
  const executionPrompt = parseExecutionPromptPolicy(rawExecutionPrompt, executionPromptSource) ?? "ask";

  const localeLanguage = normalizeLocaleLanguage(env.OMK_LANGUAGE ?? config["locale.language"]) ?? "en";

  return {
    requestedProfile,
    profile,
    reason,
    totalMemoryGb,
    maxWorkers,
    shellMaxBufferBytes,
    wireOutputBytes,
    renderLogo,
    mcpScope,
    skillsScope,
    hooksScope,
    executionPrompt,
    ensembleDefaultEnabled: profile !== "lite",
    localeLanguage,
  };
}

export async function readSimpleToml(path: string): Promise<FlatToml> {
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
    if ((char === "\"" || char === "'") && line[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        quote = char;
      } else if (quote === char) {
        inString = false;
      }
    }
    if (char === "#" && !inString) return line.slice(0, i);
  }
  return line;
}

function normalizeTomlValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeProfileRequest(value: string | undefined): OmkResourceProfileRequest {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "lite" || normalized === "low-memory" || normalized === "low_memory" || normalized === "16gb") return "lite";
  if (normalized === "standard" || normalized === "normal" || normalized === "full") return "standard";
  if (normalized === "super") return "super";
  return "auto";
}

function optimizeEnvToProfile(value: string | undefined): string | undefined {
  const parsed = parseOptionalBoolean(value);
  if (parsed === undefined) return undefined;
  return parsed ? "lite" : "standard";
}

function profileSource(env: NodeJS.ProcessEnv, config: FlatToml): string {
  if (env.OMK_RESOURCE_PROFILE !== undefined) return "OMK_RESOURCE_PROFILE";
  if (env.OMK_RUNTIME_PROFILE !== undefined) return "OMK_RUNTIME_PROFILE";
  if (env.OMK_OPTIMIZE !== undefined) return "OMK_OPTIMIZE";
  if (config["runtime.resource_profile"] !== undefined) return ".omk/config.toml";
  return "default";
}

function normalizeScope(value: string | undefined, fallback: OmkRuntimeScope): OmkRuntimeScope {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "none" || normalized === "off" || normalized === "disabled") return "none";
  if (normalized === "project" || normalized === "local") return "project";
  if (normalized === "all" || normalized === "global" || normalized === "local-user" || normalized === "local_user" || normalized === "personal" || normalized === "user") return "all";
  return fallback;
}

function normalizeLocaleLanguage(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "ko" || normalized === "kr" || normalized === "korean") return "ko";
  if (normalized === "en" || normalized === "eng" || normalized === "english") return "en";
  if (normalized === "ja" || normalized === "jp" || normalized === "japanese") return "ja";
  return undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseMib(value: string | undefined): number | undefined {
  const parsed = parsePositiveInt(value);
  return parsed === undefined ? undefined : parsed * MIB;
}

function parseBytes(value: string | undefined): number | undefined {
  const parsed = parsePositiveInt(value);
  return parsed === undefined ? undefined : parsed;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}
