import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { redactSecrets as redactSecretText } from "./secret-scanner.js";

export type QualityGateName = "lint" | "typecheck" | "test" | "build";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type QualityGateStatus = "passed" | "failed" | "skipped" | "blocked" | "missing" | "timeout" | "error";
export type QualityGateFailureType = "exit-code" | "timeout" | "mcp-error" | null;

export interface QualityGateResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  status: QualityGateStatus;
  failureType: QualityGateFailureType;
  logPath?: string;
}

export interface QualityGateResults {
  lint: QualityGateResult;
  typecheck: QualityGateResult;
  test: QualityGateResult;
  build: QualityGateResult;
}

interface ParsedQualitySetting {
  scriptName: string;
  packageManager?: PackageManager;
}

interface ResolvedQualityCommand {
  command: string;
  executable?: PackageManager;
  args?: string[];
  skipped?: boolean;
  blocked?: boolean;
  missing?: boolean;
}

const QUALITY_KEYS: QualityGateName[] = ["lint", "typecheck", "test", "build"];
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:_-]+$/;
const PACKAGE_MANAGERS = new Set<PackageManager>(["npm", "pnpm", "yarn", "bun"]);
const AUTO_SCRIPT_CANDIDATES: Record<QualityGateName, string[]> = {
  lint: ["lint"],
  typecheck: ["typecheck", "check"],
  test: ["test"],
  build: ["build"],
};

const DEBUG = !!process.env.OMK_DEBUG;

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.error("[quality-gate]", ...args);
  }
}

function redactQualityText(text: string): string {
  return redactSecretText(text).redacted;
}

export function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
  if (existsSync(join(projectRoot, "bun.lockb")) || existsSync(join(projectRoot, "bun.lock"))) return "bun";
  return "npm";
}

export function resolvePackageManagerExecutable(pm: PackageManager): string {
  if (process.platform === "win32") {
    return `${pm}.cmd`;
  }
  return pm;
}

export async function readPackageScripts(projectRoot: string): Promise<Set<string> | undefined> {
  try {
    const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, unknown>;
    };
    if (!packageJson.scripts || typeof packageJson.scripts !== "object") return new Set();
    return new Set(
      Object.entries(packageJson.scripts)
        .filter(([, value]) => typeof value === "string")
        .map(([key]) => key)
    );
  } catch {
    return undefined;
  }
}

export function getQualitySetting(config: string, key: QualityGateName): string {
  const regex = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m");
  return config.match(regex)?.[1]?.trim() ?? "auto";
}

export function resolveQualityCommand(
  setting: string,
  defaultScript: QualityGateName,
  detectedPackageManager: PackageManager,
  availableScripts?: Set<string>
): ResolvedQualityCommand {
  const normalized = setting.trim();
  if (normalized === "off") {
    return { command: "", skipped: true };
  }

  const parsed = normalized === "auto"
    ? { scriptName: resolveAutoScriptName(defaultScript, availableScripts) } satisfies ParsedQualitySetting
    : parseQualitySetting(normalized);

  if (!parsed || !SCRIPT_NAME_PATTERN.test(parsed.scriptName)) {
    return { command: "[blocked unsafe quality command]", blocked: true };
  }

  const packageManager = parsed.packageManager ?? detectedPackageManager;
  if (availableScripts && !availableScripts.has(parsed.scriptName)) {
    return {
      command: formatPackageScriptCommand(packageManager, parsed.scriptName),
      missing: true,
    };
  }

  return {
    command: formatPackageScriptCommand(packageManager, parsed.scriptName),
    executable: packageManager,
    args: ["run", parsed.scriptName],
  };
}

function resolveAutoScriptName(defaultScript: QualityGateName, availableScripts?: Set<string>): string {
  const candidates = AUTO_SCRIPT_CANDIDATES[defaultScript];
  if (!availableScripts) return candidates[0];
  return candidates.find((script) => availableScripts.has(script)) ?? candidates[0];
}

export async function runQualityGate(projectRoot: string, config: string): Promise<QualityGateResults> {
  const resources = await getOmkResourceSettings();
  const packageManager = detectPackageManager(projectRoot);
  const availableScripts = await readPackageScripts(projectRoot);

  // Run gates sequentially to avoid dist race conditions
  const results: QualityGateResult[] = [];
  for (const gate of QUALITY_KEYS) {
    const command = resolveQualityCommand(getQualitySetting(config, gate), gate, packageManager, availableScripts);
    results.push(await runResolvedQualityCommand(gate, command, projectRoot, resources.shellMaxBufferBytes));
  }

  const [lint, typecheck, test, build] = results;

  return { lint, typecheck, test, build };
}

function parseQualitySetting(setting: string): ParsedQualitySetting | null {
  if (SCRIPT_NAME_PATTERN.test(setting)) {
    return { scriptName: setting };
  }

  const parts = setting.split(/\s+/);
  if (parts.length === 3 && isPackageManager(parts[0]) && parts[1] === "run") {
    return { packageManager: parts[0], scriptName: parts[2] };
  }

  if (parts.length === 2 && parts[0] === "yarn") {
    return { packageManager: "yarn", scriptName: parts[1] };
  }

  return null;
}

function isPackageManager(value: string): value is PackageManager {
  return PACKAGE_MANAGERS.has(value as PackageManager);
}

function formatPackageScriptCommand(packageManager: PackageManager, scriptName: string): string {
  return `${packageManager} run ${scriptName}`;
}

async function runResolvedQualityCommand(
  gateName: QualityGateName,
  command: ResolvedQualityCommand,
  projectRoot: string,
  maxBuffer: number
): Promise<QualityGateResult> {
  if (command.skipped) {
    return {
      command: "",
      exitCode: 0,
      stdout: "",
      stderr: "skipped (off)",
      status: "skipped",
      failureType: null,
    };
  }
  if (command.blocked) {
    const result: QualityGateResult = {
      command: command.command,
      exitCode: 126,
      stdout: "",
      stderr: "blocked unsafe quality command; use auto, off, a package script name, or '<package-manager> run <script>'",
      status: "blocked",
      failureType: "mcp-error",
    };
    await saveQualityGateLog(projectRoot, gateName, result);
    return result;
  }
  if (command.missing || !command.executable || !command.args) {
    const result: QualityGateResult = {
      command: command.command,
      exitCode: 127,
      stdout: "",
      stderr: "package.json script not found",
      status: "missing",
      failureType: "mcp-error",
    };
    await saveQualityGateLog(projectRoot, gateName, result);
    return result;
  }

  try {
    debugLog(`Running ${gateName}: ${command.command}`);
    const stdout = execFileSync(resolvePackageManagerExecutable(command.executable), command.args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      maxBuffer,
      shell: process.platform === "win32",
    });

    const stdoutStr = redactQualityText(stdout ?? "");

    const result: QualityGateResult = {
      command: command.command,
      exitCode: 0,
      stdout: stdoutStr,
      stderr: "",
      status: "passed",
      failureType: null,
    };
    await saveQualityGateLog(projectRoot, gateName, result);
    return result;
  } catch (err: unknown) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number; signal?: string; code?: string };
    const stdoutStr = redactQualityText(String(e.stdout ?? ""));
    const stderrStr = redactQualityText(String(e.stderr ?? ""));
    const signal = e.signal ? `\nterminated by signal: ${e.signal}` : "";

    let status: QualityGateStatus = "failed";
    let failureType: QualityGateFailureType = "exit-code";

    if (e.code === "ETIMEDOUT" || signal.includes("terminated by signal")) {
      status = "timeout";
      failureType = "timeout";
    } else if (e.status !== 0 && e.status !== undefined) {
      failureType = "exit-code";
    }

    debugLog(`${gateName} ${status}: ${failureType}`);

    const result: QualityGateResult = {
      command: command.command,
      exitCode: e.status ?? 1,
      stdout: stdoutStr,
      stderr: redactQualityText(`${stderrStr}${signal}`),
      status,
      failureType,
    };
    await saveQualityGateLog(projectRoot, gateName, result);
    return result;
  }
}

async function saveQualityGateLog(projectRoot: string, gateName: QualityGateName, result: QualityGateResult): Promise<void> {
  try {
    const logsDir = join(projectRoot, ".omk", "logs", "quality-gate");
    await mkdir(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${gateName}-${timestamp}.log`;
    const logPath = join(logsDir, fileName);

    const logContent = [
      `gate: ${gateName}`,
      `command: ${result.command || "(none)"}`,
      `status: ${result.status}`,
      `failureType: ${result.failureType ?? "none"}`,
      `exitCode: ${result.exitCode}`,
      `--- stdout ---`,
      redactQualityText(result.stdout || "(empty)"),
      `--- stderr ---`,
      redactQualityText(result.stderr || "(empty)"),
    ].join("\n");

    await writeFile(logPath, logContent, "utf-8");
    result.logPath = logPath;
  } catch (err) {
    debugLog("Failed to save quality gate log:", err);
  }
}

export function printQualityGateResults(results: QualityGateResults, printMode = false): string {
  const lines: string[] = [];
  if (printMode) {
    lines.push("{\"qualityGates\":");
  }

  const entries = QUALITY_KEYS.map((key) => {
    const r = results[key];
    const icon = r.status === "passed" ? "✓" : r.status === "skipped" ? "○" : "✗";
    const failureDetail = r.failureType ? ` (${r.failureType})` : "";
    return `  ${icon} ${key}: ${r.status}${failureDetail}${r.logPath ? ` [log: ${r.logPath}]` : ""}`;
  });

  lines.push(...entries);

  if (printMode) {
    lines.push("}");
  }

  return lines.join("\n");
}

export function getQualityKeys(): QualityGateName[] {
  return [...QUALITY_KEYS];
}
