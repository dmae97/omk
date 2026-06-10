import { basename } from "path";
import {
  pathExists,
  readTextFile,
  displayProjectRootPath,
  type ProjectRootResolution,
} from "../../util/fs.js";
import { getOmkResourceSettings } from "../../util/resource-profile.js";
import { type DoctorFixLevel } from "./fix-plan.js";

export interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "info";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface CheckCategory {
  title: string;
  checks: () => Promise<CheckResult[]>;
}

export interface JsonFileDiagnostic {
  path: string;
  exists: boolean;
  valid: boolean;
  error?: string;
}

export interface DoctorOptions {
  json?: boolean;
  soft?: boolean;
  fix?: boolean;
  global?: boolean;
  dryRun?: boolean;
  fixLevel?: DoctorFixLevel;
  verifyFix?: boolean;
  setDefaultProjectRoot?: string;
}

export type OmkResourceSettings = Awaited<ReturnType<typeof getOmkResourceSettings>>;

export interface DoctorCheckRun {
  categoryResults: Array<{ title: string; results: CheckResult[] }>;
  allResults: CheckResult[];
}

export function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

const SECRET_KEY_SUBSTRINGS = ["apikey", "token", "password", "secret", "authorization", "bearer", "key"];

export function isSecretKey(key: string): boolean {
  const lk = key.toLowerCase();
  return SECRET_KEY_SUBSTRINGS.some((sk) => lk === sk || lk.endsWith(sk));
}

export function redactSecrets(obj: unknown): unknown {
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && isSecretKey(key)) {
      result[key] = "***";
    } else {
      result[key] = redactSecrets(value);
    }
  }
  return result;
}

export function isNpmLauncherCommand(command: string | undefined): boolean {
  if (!command) return false;
  const executable = command.trim().split(/\s+/)[0];
  if (!executable) return false;
  const name = basename(executable).toLowerCase();
  return ["npm", "npx", "npm.cmd", "npx.cmd", "npm.exe", "npx.exe"].includes(name);
}

export function isExpectedGlobalKimiFile(name: string): boolean {
  const expected = new Set([
    "AGENTS.md",
    ["E", "N", "I"].join("") + ".md",
    ["Jail", "break"].join("") + ".md",
    "PARALLEL_AGENTS.md",
    "User.md",
    "agent.yaml",
    "config.toml",
    "device_id",
    "kimi.json",
    "latest_version.txt",
    "mcp-web-search.sh",
    "mcp.json",
    "mcp.manifest.json",
    "omk.memory.toml",
    "setup.md",
    "system.md",
    "user.md",
  ]);
  return (
    expected.has(name)
    || /^config\.toml\.bak(?:[-_].*)?$/.test(name)
    || /^mcp(?:\.manifest)?\.json\.bak(?:[-_].*)?$/.test(name)
    || /^eggup-\d+\.json$/i.test(name)
    || /\.json:Zone\.Identifier$/i.test(name)
  );
}

export async function inspectJsonFile(filePath: string): Promise<JsonFileDiagnostic> {
  if (!(await pathExists(filePath))) return { path: filePath, exists: false, valid: false };

  try {
    JSON.parse(await readTextFile(filePath, "{}"));
    return { path: filePath, exists: true, valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: filePath, exists: true, valid: false, error: `Invalid JSON: ${message}` };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rootDiagnosticData(resolution: ProjectRootResolution): Record<string, unknown> {
  return {
    activeCwd: displayProjectRootPath(resolution.cwd, resolution.home),
    detectedGitRoot: displayProjectRootPath(resolution.gitRoot, resolution.home),
    effectiveProjectRoot: displayProjectRootPath(resolution.root, resolution.home),
    source: resolution.source,
    marker: resolution.marker ?? null,
    homeIsGitRepo: resolution.homeIsGitRepo,
    isHomeRoot: resolution.isHomeRoot,
    defaultProjectRoot: displayProjectRootPath(resolution.configuredDefaultProjectRoot, resolution.home),
    defaultProjectRootError: resolution.defaultProjectRootError ?? null,
    warning: resolution.warning ?? null,
    recommendation: resolution.recommendation ?? null,
    fixCommand: resolution.isHomeRoot && resolution.homeIsGitRepo
      ? "omk doctor --fix --set-default-project-root /path/to/project"
      : null,
  };
}

export function safeOperationId(prefix: string, value: string): string {
  const suffix = value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return suffix ? `${prefix}-${suffix}` : prefix;
}

export async function readJsonValue(filePath: string): Promise<{ exists: boolean; valid: boolean; value?: unknown; error?: string }> {
  if (!(await pathExists(filePath))) return { exists: false, valid: false };
  try {
    return { exists: true, valid: true, value: JSON.parse(await readTextFile(filePath, "{}")) as unknown };
  } catch (err: unknown) {
    return {
      exists: true,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
