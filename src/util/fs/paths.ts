import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import {
  getProjectRoot as resolveProjectRootSync,
  getProjectRootAsync as resolveProjectRootAsyncPath,
  getProjectRootDiagnostics,
  resolveProjectRoot,
  resolveProjectRootAsync,
  displayProjectRootPath,
  type ProjectRootResolution,
  type ProjectRootSource,
} from "../project-root.js";

export {
  getProjectRootDiagnostics,
  resolveProjectRoot,
  resolveProjectRootAsync,
  displayProjectRootPath,
  type ProjectRootResolution,
  type ProjectRootSource,
};

export function getProjectRoot(): string {
  return resolveProjectRootSync();
}

export async function getProjectRootAsync(): Promise<string> {
  return resolveProjectRootAsyncPath();
}

export function getUserHome(env: NodeJS.ProcessEnv = process.env): string {
  return (
    normalizeUserHomePath(env.OMK_ORIGINAL_HOME)
    ?? normalizeUserHomePath(env.HOME)
    ?? normalizeUserHomePath(env.USERPROFILE)
    ?? normalizeUserHomePath(homedir())
    ?? homedir()
  );
}

export function normalizeUserHomePath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = stripWrappingQuotes(value.trim());
  if (!trimmed) return undefined;

  const wslPath = normalizeWslUncPath(trimmed);
  return stripKimiConfigSuffix(wslPath ?? trimmed);
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeWslUncPath(value: string): string | undefined {
  const slashPath = value.replace(/\\/g, "/");
  const match = slashPath.match(/^\/\/wsl(?:\.localhost|\$)\/[^/]+(?:\/(.*))?$/i);
  if (!match) return undefined;
  const distroRelative = match[1] ?? "";
  return `/${distroRelative}`.replace(/\/+/g, "/");
}

function stripKimiConfigSuffix(value: string): string {
  const slashPath = value.replace(/\\/g, "/");
  const lower = slashPath.toLowerCase();
  for (const suffix of ["/.kimi/mcp.json", "/.kimi/config.toml", "/.kimi/skills"]) {
    if (lower.endsWith(suffix)) {
      return value.slice(0, value.length - suffix.length);
    }
  }
  if (lower.endsWith("/.kimi")) {
    return value.slice(0, value.length - "/.kimi".length);
  }
  return value;
}

export function getOmkPath(subPath?: string): string {
  const root = getProjectRoot();
  return subPath ? join(root, ".omk", subPath) : join(root, ".omk");
}

export {
  validateRunId,
  sanitizeRunId,
  validateRunArtifactPath,
  getRunsDir,
  getRunPath,
  getRunArtifactPath,
  listValidRunIds,
} from "../run-store.js";

export function getKimiConfigPath(): string {
  return join(getUserHome(), ".kimi", "config.toml");
}

/** 프로젝트의 .kimi/skills 디렉토리 경로 */
export function getKimiSkillsDir(): string {
  return join(getProjectRoot(), ".kimi", "skills");
}

/** ~/.kimi/config.toml 에서 default_model 읽기 */
export async function getKimiDefaultModel(): Promise<string | null> {
  const configPath = getKimiConfigPath();
  try {
    const content = await readFile(configPath, "utf-8");
    const match = content.match(/^default_model\s*=\s*["']([^"']+)["']/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
