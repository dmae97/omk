import { chmod, copyFile, mkdir, readdir, stat as fsStat, writeFile } from "fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { execSync } from "child_process";
import { checkCommand, getKimiVersion, runShell } from "../util/shell.js";
import { runOmkSafetySelfTest } from "../util/native-safety.js";
import { getKimiCapabilities } from "../kimi/capability.js";
import {
  pathExists,
  getKimiConfigPath,
  readTextFile,
  getProjectRootDiagnostics,
  getUserHome,
  syncAllKimiGlobals,
  displayProjectRootPath,
  type KimiGlobalSyncReport,
  type ProjectRootResolution,
} from "../util/fs.js";
import { isGitAvailable, getCurrentBranch, getGitStatus } from "../util/git.js";
import { style, status, header, separator } from "../util/theme.js";
import { getGlobalMemoryConfigPath, isGraphMemoryBackend, loadMemorySettings, usesLocalGraphBackend, usesKuzuBackend } from "../memory/memory-config.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { t } from "../util/i18n.js";
import { formatBytes } from "../util/output-buffer.js";
import { getOmkVersionSync } from "../util/version.js";
import { resolveBundledLspBinary } from "./lsp.js";
import { defaultLspConfigJson } from "../lsp/default-config.js";
import { detectPackageManager } from "../mcp/quality-gate.js";
import { MemoryStore } from "../memory/memory-store.js";
import { discoverRoutingInventory } from "../orchestration/routing.js";
import { OMK_PARALLEL_ORCHESTRATOR_PRESET, OMK_RUNTIME_PRESETS } from "../runtime/core-verified-preset.js";
import { buildMcpDoctorReport, repairMcpDoctorIssues, type McpDoctorFixReport } from "./mcp.js";
import { maybePromptForOmkUpdate } from "../util/update-check.js";
import {
  formatAgentYamlIssues,
  repairProjectAgentPromptArgStrings,
  validateProjectAgentYaml,
} from "../util/agent-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..", "..");

function semverGt(a: string, b: string): boolean {
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

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "info";
  message: string;
  metadata?: Record<string, unknown>;
}

interface CheckCategory {
  title: string;
  checks: () => Promise<CheckResult[]>;
}

interface JsonFileDiagnostic {
  path: string;
  exists: boolean;
  valid: boolean;
  error?: string;
}

interface AgentToolDeclarations {
  hasAgentTool: boolean;
  hasSearchWeb: boolean;
  hasFetchURL: boolean;
  usesDefaultToolSurface: boolean;
}

interface DoctorOptions {
  json?: boolean;
  soft?: boolean;
  fix?: boolean;
  global?: boolean;
  dryRun?: boolean;
  fixLevel?: DoctorFixLevel;
  verifyFix?: boolean;
  setDefaultProjectRoot?: string;
}

type DoctorFixSeverity = "info" | "warn" | "error";
type DoctorFixLevel = "safe" | "recommended" | "aggressive";
type DoctorFixSafetyTier = DoctorFixLevel | "global";
type DoctorFixOperationStatus = "planned" | "applied" | "skipped" | "blocked" | "failed";

interface DoctorFixOperation {
  id: string;
  category: string;
  severity: DoctorFixSeverity;
  safetyTier: DoctorFixSafetyTier;
  status: DoctorFixOperationStatus;
  before?: unknown;
  after?: unknown;
  backupPath?: string;
  verifyCheck?: string;
  reason?: string;
}

interface DoctorCheckSummary {
  warnings: number;
  errors: number;
}

interface DoctorPostFixCheck {
  before: DoctorCheckSummary;
  after: DoctorCheckSummary;
  fixed: number;
  remainingWarnings: number;
  remainingErrors: number;
  requiresManualAction: boolean;
}

interface DoctorFixPlan {
  operations: DoctorFixOperation[];
  changed: boolean;
  dryRun: boolean;
  backups: string[];
  manualActions: string[];
  postCheck?: DoctorPostFixCheck;
}

interface DoctorFixReport {
  changed: boolean;
  actions: string[];
  skipped: string[];
  mcp?: McpDoctorFixReport;
  globalSync?: KimiGlobalSyncReport;
  backups?: string[];
  dryRun?: boolean;
  fixPlan: DoctorFixPlan;
}

type OmkResourceSettings = Awaited<ReturnType<typeof getOmkResourceSettings>>;

interface DoctorCheckRun {
  categoryResults: Array<{ title: string; results: CheckResult[] }>;
  allResults: CheckResult[];
}

interface DoctorFixContext {
  dryRun: boolean;
  fixLevel: DoctorFixLevel;
  plan: DoctorFixPlan;
}

function createDoctorFixPlan(dryRun: boolean): DoctorFixPlan {
  return {
    operations: [],
    changed: false,
    dryRun,
    backups: [],
    manualActions: [],
  };
}

function addDoctorFixOperation(ctx: DoctorFixContext, operation: DoctorFixOperation): void {
  ctx.plan.operations.push(operation);
  if (operation.status === "applied") ctx.plan.changed = true;
  if (operation.backupPath && !ctx.plan.backups.includes(operation.backupPath)) {
    ctx.plan.backups.push(operation.backupPath);
  }
  if ((operation.status === "blocked" || operation.status === "failed") && operation.reason) {
    ctx.plan.manualActions.push(operation.reason);
  }
}

function recordDoctorFix(
  ctx: DoctorFixContext,
  operation: Omit<DoctorFixOperation, "status" | "severity" | "safetyTier"> & {
    status?: DoctorFixOperationStatus;
    severity?: DoctorFixSeverity;
    safetyTier?: DoctorFixSafetyTier;
  }
): void {
  const requestedStatus = operation.status ?? "applied";
  const status = ctx.dryRun && requestedStatus === "applied" ? "planned" : requestedStatus;
  addDoctorFixOperation(ctx, {
    severity: operation.severity ?? "info",
    safetyTier: operation.safetyTier ?? ctx.fixLevel,
    ...operation,
    status,
  });
}

function operationToAction(operation: DoctorFixOperation): string | null {
  if (operation.status !== "applied" && operation.status !== "planned") return null;
  return operation.reason ?? `${operation.id} ${operation.status}`;
}

function operationToSkipped(operation: DoctorFixOperation): string | null {
  if (operation.status !== "skipped" && operation.status !== "blocked" && operation.status !== "failed") return null;
  return operation.reason ?? `${operation.id} ${operation.status}`;
}

function createDoctorFixReport(
  ctx: DoctorFixContext,
  mcp?: McpDoctorFixReport,
  globalSync?: KimiGlobalSyncReport
): DoctorFixReport {
  const actions = ctx.plan.operations
    .map(operationToAction)
    .filter((message): message is string => typeof message === "string");
  const skipped = ctx.plan.operations
    .map(operationToSkipped)
    .filter((message): message is string => typeof message === "string");
  return {
    changed: ctx.plan.changed,
    actions,
    skipped,
    mcp,
    globalSync,
    backups: ctx.plan.backups,
    dryRun: ctx.dryRun,
    fixPlan: ctx.plan,
  };
}

function summarizeDoctorChecks(results: CheckResult[]): DoctorCheckSummary {
  return {
    warnings: results.filter((r) => r.status === "warn").length,
    errors: results.filter((r) => r.status === "fail").length,
  };
}

function buildDoctorPostFixCheck(beforeResults: CheckResult[], afterResults: CheckResult[], plan: DoctorFixPlan): DoctorPostFixCheck {
  const before = summarizeDoctorChecks(beforeResults);
  const after = summarizeDoctorChecks(afterResults);
  const beforeTotal = before.warnings + before.errors;
  const afterTotal = after.warnings + after.errors;
  return {
    before,
    after,
    fixed: Math.max(0, beforeTotal - afterTotal),
    remainingWarnings: after.warnings,
    remainingErrors: after.errors,
    requiresManualAction: plan.manualActions.length > 0 || after.errors > 0,
  };
}

function shouldVerifyDoctorFix(options: DoctorOptions): boolean {
  return options.fix === true && options.dryRun !== true && options.verifyFix !== false;
}

function buildDoctorCategories(
  root: string,
  rootResolution: ProjectRootResolution,
  resources: OmkResourceSettings
): CheckCategory[] {
  return [
    { title: "Project Root", checks: async () => rootChecks(rootResolution) },
    { title: "Runtime", checks: () => runtimeChecks(resources) },
    { title: "Toolchain", checks: () => toolchainChecks(root) },
    { title: "Primary CLI", checks: () => kimiChecks(root, resources) },
    { title: "Project", checks: () => projectChecks(root) },
    { title: "OMK Scaffold", checks: () => omkChecks(root) },
    { title: "Agent YAML", checks: () => agentYamlChecks(root) },
    { title: "MCP & Skills", checks: () => mcpSkillsChecks(root, resources) },
    { title: "Memory", checks: () => memoryChecks(root) },
    { title: "Security", checks: () => securityChecks(root) },
  ];
}

async function runDoctorChecks(
  root: string,
  rootResolution: ProjectRootResolution,
  resources: OmkResourceSettings
): Promise<DoctorCheckRun> {
  const categories = buildDoctorCategories(root, rootResolution, resources);
  const categoryResults = await Promise.all(
    categories.map(async (cat) => {
      const results = await cat.checks();
      return { title: cat.title, results };
    })
  );
  return {
    categoryResults,
    allResults: categoryResults.flatMap(({ results }) => results),
  };
}

const SECRET_KEY_SUBSTRINGS = ["apikey", "token", "password", "secret", "authorization", "bearer", "key"];

function isSecretKey(key: string): boolean {
  const lk = key.toLowerCase();
  return SECRET_KEY_SUBSTRINGS.some((sk) => lk === sk || lk.endsWith(sk));
}

function redactSecrets(obj: unknown): unknown {
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

function isNpmLauncherCommand(command: string | undefined): boolean {
  if (!command) return false;
  const executable = command.trim().split(/\s+/)[0];
  if (!executable) return false;
  const name = basename(executable).toLowerCase();
  return ["npm", "npx", "npm.cmd", "npx.cmd", "npm.exe", "npx.exe"].includes(name);
}

function isExpectedGlobalKimiFile(name: string): boolean {
  const expected = new Set([
    "AGENTS.md",
    "ENI.md",
    "Jailbreak.md",
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

async function inspectJsonFile(filePath: string): Promise<JsonFileDiagnostic> {
  if (!(await pathExists(filePath))) return { path: filePath, exists: false, valid: false };

  try {
    JSON.parse(await readTextFile(filePath, "{}"));
    return { path: filePath, exists: true, valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: filePath, exists: true, valid: false, error: `Invalid JSON: ${message}` };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rootDiagnosticData(resolution: ProjectRootResolution): Record<string, unknown> {
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

function rootChecks(resolution: ProjectRootResolution): CheckResult[] {
  const data = rootDiagnosticData(resolution);
  const result: CheckResult = {
    name: "Project Root",
    status: resolution.warning ? "warn" : "ok",
    message: `${data.effectiveProjectRoot ?? resolution.root} (source: ${resolution.source})`,
    metadata: data,
  };
  const checks = [result];
  if (resolution.defaultProjectRootError) {
    checks.push({
      name: "Project Root Default",
      status: "warn",
      message: resolution.defaultProjectRootError,
      metadata: {
        source: process.env.OMK_DEFAULT_PROJECT_ROOT ? "OMK_DEFAULT_PROJECT_ROOT" : "user-config",
      },
    });
  }
  return checks;
}

async function readAgentToolDeclarations(root: string): Promise<AgentToolDeclarations | null> {
  const rootYamlPath = join(root, ".omk", "agents", "root.yaml");
  if (!(await pathExists(rootYamlPath))) return null;
  const tools = new Set<string>();
  const visited = new Set<string>();
  let rawChain = "";
  let sawExplicitTools = false;

  const addTool = (value: string): void => {
    tools.add(value);
    const tail = value.split(/[.:]/).pop();
    if (tail) tools.add(tail);
  };

  const visitAgentFile = async (filePath: string): Promise<void> => {
    const resolved = resolve(filePath);
    if (visited.has(resolved) || !(await pathExists(resolved))) return;
    visited.add(resolved);

    const raw = await readTextFile(resolved, "");
    rawChain += `\n${raw}`;

    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch {
      return;
    }
    const agent = isRecord(parsed) && isRecord(parsed.agent) ? parsed.agent : null;
    if (!agent) return;

    const declaredTools = agent.tools;
    if (Array.isArray(declaredTools)) {
      sawExplicitTools = true;
      for (const tool of declaredTools) {
        if (typeof tool === "string") addTool(tool);
      }
    }

    const extend = typeof agent.extend === "string" ? agent.extend : undefined;
    if (!extend || extend === "default") return;
    const nextPath = isAbsolute(extend) ? extend : resolve(dirname(resolved), extend);
    await visitAgentFile(nextPath);
  };

  await visitAgentFile(rootYamlPath);
  const usesDefaultToolSurface = !sawExplicitTools;
  return {
    usesDefaultToolSurface,
    hasAgentTool: usesDefaultToolSurface || tools.has("Agent") || /\bAgent\b/.test(rawChain),
    hasSearchWeb: usesDefaultToolSurface || tools.has("SearchWeb") || /\bSearchWeb\b/.test(rawChain),
    hasFetchURL: usesDefaultToolSurface || tools.has("FetchURL") || /\bFetchURL\b/.test(rawChain),
  };
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const rootResolution = getProjectRootDiagnostics();
  const root = rootResolution.root;
  const resources = await getOmkResourceSettings();
  const preFixRun = shouldVerifyDoctorFix(options)
    ? await runDoctorChecks(root, rootResolution, resources)
    : undefined;
  const fixes = options.fix ? await applyDoctorFixes(root, options, rootResolution) : undefined;
  const postFixResources = options.fix ? await getOmkResourceSettings() : resources;
  const { categoryResults, allResults } = await runDoctorChecks(root, rootResolution, postFixResources);
  if (fixes?.fixPlan && preFixRun) {
    fixes.fixPlan.postCheck = buildDoctorPostFixCheck(preFixRun.allResults, allResults, fixes.fixPlan);
  }

  if (options.json) {
    const find = (name: string) => allResults.find((r) => r.name === name);
    const findMsg = (name: string) => find(name)?.message ?? null;
    const findOk = (name: string) => find(name)?.status === "ok";
    const findMeta = (name: string, key: string) => find(name)?.metadata?.[key] ?? null;

    const warnings = allResults
      .filter((r) => r.status === "warn")
      .map((r) => ({ name: r.name, message: r.message }));
    const errors = allResults
      .filter((r) => r.status === "fail")
      .map((r) => ({ name: r.name, message: r.message }));
    const info = allResults
      .filter((r) => r.status === "info")
      .map((r) => ({ name: r.name, message: r.message }));

    const data = {
      root: rootDiagnosticData(rootResolution),
      environment: {
        platform: process.platform,
        arch: process.arch,
        omkRuntime: {
          profile: resources.profile,
          ramGb: resources.totalMemoryGb,
          workers: resources.maxWorkers,
          bufferBytes: resources.shellMaxBufferBytes,
        },
        npmGlobalBin: findMsg("npm global bin"),
      },
      kimi: {
        installed: findOk("Primary CLI"),
        version: findMsg("Primary CLI"),
        runnable: findOk("Primary Runnable"),
        session: findMsg("Primary Session"),
        config: findOk("Primary Config"),
        hooks: findOk("OMK Hooks"),
        capabilities: findMsg("Primary Capabilities"),
        agentFile: findOk("Primary Agent File"),
        webTools: findOk("Primary Web Tools"),
        swarmStatus: findMsg("Primary Swarm"),
        installGuide: "curl -LsSf https://code.kimi.com/install.sh | bash or see https://github.com/dmae97/oh-my-kimi#install",
      },
      git: {
        installed: findOk("Git Installed"),
        available: findOk("Git Available"),
        isRepo: findOk("Git Repo"),
        clean: findOk("Git Clean"),
        safeDirectoryWarning: !findOk("Git Safe Directory"), // true if there IS a warning
        warning:
          allResults
            .filter((r) => r.status === "warn" && r.name.startsWith("Git"))
            .map((r) => r.message)[0] ?? null,
      },
      node: {
        version: process.version,
        npmGlobalBin: findMsg("npm global bin"),
      },
      scaffold: {
        initialized: findOk(".omk dir"),
        writable: findOk(".omk writable"),
        rootYaml: findOk("root.yaml"),
        okabeAgents: findMsg("Okabe Agents"),
        rootPrompt: findMsg("Root Prompt"),
        hooksExecutable: findOk("Hooks Exec"),
      },
      globalSync: {
        memory: findMsg("Global Memory"),
        graphMemory: findMsg("Graph Memory"),
        globalPollution: findMsg("Global Pollution"),
        mcp: findMsg("OMK MCP"),
        skills: findMsg(".kimi/skills"),
        agentSkills: findMsg(".agents/skills"),
        globalMcp: findMsg("Global MCP"),
        globalSkills: findMsg("Global Skills"),
      },
      security: {
        dangerousConfig: findMsg("Dangerous Config"),
      },
      rustSafety: {
        cargo: findMsg("Rust Cargo"),
        rustc: findMsg("Rust Compiler"),
        crate: findMsg("Rust Safety Crate"),
        native: findMsg("Rust Safety Native"),
        nativeSource: findMeta("Rust Safety Native", "source"),
        nativePlatformArch: findMeta("Rust Safety Native", "platformArch"),
        nativeBuiltFromSource: findMeta("Rust Safety Native", "builtFromSource"),
        nativePath: findMeta("Rust Safety Native", "path"),
      },
    };
    const output = {
      ok: errors.length === 0,
      command: "doctor",
      checkedAt: new Date().toISOString(),
      data,
      ...data,
      warnings,
      errors,
      info,
      fixes,
    };
    console.log(JSON.stringify(output, null, 2));
    if (errors.length > 0 && !options.soft) process.exit(1);
    return;
  }

  console.log(header("oh-my-kimi doctor"));
  console.log(separator());

  for (const { title, results } of categoryResults) {
    console.log(style.purpleBold(`\n  ${title}`));
    for (const r of results) {
      const icon = r.status === "ok" ? "✅" : r.status === "warn" ? "⚠️" : r.status === "fail" ? "❌" : "ℹ️";
      console.log(`    ${icon} ${r.name.padEnd(16)} ${r.message}`);
    }
  }

  if (fixes) {
    console.log(style.purpleBold("\n  Fixes"));
    if (fixes.actions.length === 0 && fixes.skipped.length === 0) {
      console.log(`    ${style.gray("ℹ")} no safe repairs were needed`);
    }
    for (const action of fixes.actions) {
      console.log(`    ${style.mint("✓")} ${action}`);
    }
    for (const item of fixes.skipped) {
      console.log(`    ${style.skin("⚠")} ${item}`);
    }
  }

  console.log();
  const fails = allResults.filter((r) => r.status === "fail").length;
  const warns = allResults.filter((r) => r.status === "warn").length;

  if (fails > 0) {
    console.log(status.error(t("doctor.failures", fails, warns)));
    if (!options.soft) process.exit(1);
  } else if (warns > 0) {
    console.log(status.warn(t("doctor.warnings", warns)));
  } else {
    console.log(status.ok(t("doctor.allPassed")));
  }

  const omkVersionResult = allResults.find((r) => r.name === "OMK Version");
  if (omkVersionResult?.status === "warn" && !options.json) {
    const updatePrompt = await maybePromptForOmkUpdate();
    if (updatePrompt.shouldExit) process.exit(updatePrompt.exitCode ?? 0);
  }
}

async function applyDoctorFixes(root: string, options: DoctorOptions, rootResolution: ProjectRootResolution): Promise<DoctorFixReport> {
  const dryRun = Boolean(options.dryRun);
  const ctx: DoctorFixContext = {
    dryRun,
    fixLevel: normalizeDoctorFixLevel(options.fixLevel),
    plan: createDoctorFixPlan(dryRun),
  };
  const allowGlobalFixes = shouldRunDoctorGlobalFixes(options);

  await applyDefaultProjectRootFix(options, rootResolution, ctx);
  await repairRuntimePresetFiles(root, ctx);
  await repairProjectConfigToml(root, ctx);
  await repairLspConfig(root, ctx);
  await bootstrapLocalGraphMemory(root, ctx);
  await ensureLocalScaffold(root, ctx);
  await repairHookExecutables(root, ctx);
  await verifyWebBridgePackageEntries(ctx);
  if (allowGlobalFixes) {
    await repairGitSafeDirectory(root, ctx);
  } else {
    await reportSkippedGitSafeDirectoryRepair(root, ctx);
  }

  const mcp = await repairMcpDoctorIssues({ dryRun, global: allowGlobalFixes });
  for (const [index, action] of mcp.actions.entries()) {
    recordDoctorFix(ctx, {
      id: `mcp-${index + 1}`,
      category: "mcp",
      safetyTier: allowGlobalFixes ? "global" : "safe",
      before: "mcp doctor issue",
      after: "mcp doctor repair",
      reason: `mcp: ${action}`,
      verifyCheck: "MCP Doctor",
    });
  }
  for (const backupPath of mcp.backups) {
    if (!ctx.plan.backups.includes(backupPath)) ctx.plan.backups.push(backupPath);
  }
  for (const [index, item] of mcp.skipped.entries()) {
    recordDoctorFix(ctx, {
      id: `mcp-skipped-${index + 1}`,
      category: "mcp",
      severity: "warn",
      safetyTier: allowGlobalFixes ? "global" : "safe",
      status: /blocked/i.test(item) ? "blocked" : "skipped",
      reason: `mcp: ${item}`,
      verifyCheck: "MCP Doctor",
    });
  }

  const globalSync = allowGlobalFixes && !dryRun
    ? await syncAllKimiGlobals({
        manifest: [],
        timestamp: new Date().toISOString(),
        quiet: true,
      })
    : createSkippedGlobalSyncReport();
  if (allowGlobalFixes && dryRun) {
    recordDoctorFix(ctx, {
      id: "global-sync",
      category: "global-sync",
      safetyTier: "global",
      reason: "global sync: would sync global config (dry-run)",
      verifyCheck: "Global MCP",
    });
  } else if (allowGlobalFixes) {
    for (const [index, action] of globalSync.actions.entries()) {
      recordDoctorFix(ctx, {
        id: `global-sync-${index + 1}`,
        category: "global-sync",
        safetyTier: "global",
        reason: `global sync: ${action}`,
        verifyCheck: "Global MCP",
      });
    }
    for (const step of globalSync.steps) {
      if (step.blocked) {
        recordDoctorFix(ctx, {
          id: `global-sync-blocked-${step.name}`,
          category: "global-sync",
          severity: "warn",
          safetyTier: "global",
          status: "blocked",
          reason: `global sync: ${step.name} blocked (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to repair global config)`,
          verifyCheck: "Global MCP",
        });
      }
      if (step.error) {
        recordDoctorFix(ctx, {
          id: `global-sync-failed-${step.name}`,
          category: "global-sync",
          severity: "error",
          safetyTier: "global",
          status: "failed",
          reason: `global sync failed: ${step.name}: ${step.error}`,
          verifyCheck: "Global MCP",
        });
      }
    }
    for (const [index, item] of globalSync.skipped.entries()) {
      if (/global write blocked/i.test(item)) continue;
      recordDoctorFix(ctx, {
        id: `global-sync-skipped-${index + 1}`,
        category: "global-sync",
        severity: "warn",
        safetyTier: "global",
        status: "skipped",
        reason: `global sync: ${item}`,
        verifyCheck: "Global MCP",
      });
    }
    for (const [index, item] of globalSync.errors.entries()) {
      recordDoctorFix(ctx, {
        id: `global-sync-error-${index + 1}`,
        category: "global-sync",
        severity: "error",
        safetyTier: "global",
        status: "failed",
        reason: `global sync failed: ${item}`,
        verifyCheck: "Global MCP",
      });
    }
  } else {
    recordDoctorFix(ctx, {
      id: "global-sync-skipped-safe-default",
      category: "global-sync",
      severity: "warn",
      safetyTier: "global",
      status: "skipped",
      reason: "global sync skipped (safe default; pass `omk doctor --fix --global` or set OMK_DOCTOR_FIX_GLOBAL=1 / OMK_MCP_ALLOW_WRITE_CONFIG=1 to sync global config)",
      verifyCheck: "Global MCP",
    });
  }

  return createDoctorFixReport(ctx, mcp, globalSync);
}

function normalizeDoctorFixLevel(level: DoctorOptions["fixLevel"]): DoctorFixLevel {
  return level === "recommended" || level === "aggressive" ? level : "safe";
}

async function applyDefaultProjectRootFix(
  options: DoctorOptions,
  resolution: ProjectRootResolution,
  ctx: DoctorFixContext
): Promise<void> {
  if (!options.setDefaultProjectRoot) {
    if (resolution.isHomeRoot && resolution.homeIsGitRepo) {
      recordDoctorFix(ctx, {
        id: "default-project-root-needed",
        category: "project-root",
        severity: "warn",
        safetyTier: "recommended",
        status: "skipped",
        reason: "project root is HOME; pass `omk doctor --fix --set-default-project-root /path/to/project` to persist an explicit default",
        verifyCheck: "Project Root",
      });
    }
    return;
  }

  const targetRoot = resolve(options.setDefaultProjectRoot);
  const info = await fsStat(targetRoot).catch(() => null);
  if (!info?.isDirectory()) {
    recordDoctorFix(ctx, {
      id: "default-project-root-invalid",
      category: "project-root",
      severity: "warn",
      safetyTier: "recommended",
      status: "skipped",
      reason: `default_project_root not set: ${targetRoot} is not a directory`,
      verifyCheck: "Project Root Default",
    });
    return;
  }

  const home = getUserHome();
  const configDir = join(home, ".omk");
  const configPath = join(configDir, "config.toml");
  const displayTarget = displayProjectRootPath(targetRoot, home) ?? targetRoot;
  if (ctx.dryRun) {
    recordDoctorFix(ctx, {
      id: "set-default-project-root",
      category: "project-root",
      safetyTier: "recommended",
      before: resolution.configuredDefaultProjectRoot ?? null,
      after: displayTarget,
      reason: `would set user default_project_root to ${displayTarget}`,
      verifyCheck: "Project Root",
    });
    return;
  }

  await mkdir(configDir, { recursive: true });
  const existing = await readTextFile(configPath, "");
  let backupPath: string | undefined;
  if (existing) {
    backupPath = join(configDir, `config.toml.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    await writeFile(backupPath, sanitizeConfigBackup(existing), { mode: 0o600 });
    if (!ctx.plan.backups.includes(backupPath)) ctx.plan.backups.push(backupPath);
  }
  await writeFile(configPath, setDefaultProjectRootToml(existing, targetRoot), { mode: 0o600 });
  recordDoctorFix(ctx, {
    id: "set-default-project-root",
    category: "project-root",
    safetyTier: "recommended",
    before: resolution.configuredDefaultProjectRoot ?? null,
    after: displayTarget,
    backupPath,
    reason: `set user default_project_root to ${displayTarget}`,
    verifyCheck: "Project Root",
  });
}

function sanitizeConfigBackup(content: string): string {
  return content.replace(
    /^(\s*[A-Za-z0-9_.-]*(?:token|secret|password|apikey|api_key|authorization|bearer|credential)[A-Za-z0-9_.-]*\s*=\s*).+$/gim,
    "$1\"***\""
  );
}

function setDefaultProjectRootToml(content: string, root: string): string {
  const line = `default_project_root = ${JSON.stringify(root)}`;
  const lines = content.split(/\r?\n/);
  let section = "";
  let replaced = false;
  const result = lines.map((original) => {
    const trimmed = original.trim();
    const sectionMatch = /^\[([^\]]+)]$/.exec(trimmed);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      return original;
    }
    if (!section && /^default_project_root\s*=/.test(trimmed)) {
      replaced = true;
      return line;
    }
    return original;
  });
  if (!replaced) result.unshift(line);
  return result.join("\n").replace(/\n*$/, "\n");
}

function shouldRunDoctorGlobalFixes(options: DoctorOptions): boolean {
  return (
    options.global === true ||
    /^(?:1|true|yes|on)$/i.test(process.env.OMK_DOCTOR_FIX_GLOBAL ?? "") ||
    /^(?:1|true|yes|on)$/i.test(process.env.OMK_MCP_ALLOW_WRITE_CONFIG ?? "")
  );
}

function createSkippedGlobalSyncReport(): KimiGlobalSyncReport {
  const steps: KimiGlobalSyncReport["steps"] = (["hooks", "mcp", "skills", "memory"] as const).map((name) => ({
    name,
    changed: false,
    blocked: false,
    skipped: true,
    manifest: [],
  }));
  return {
    changed: false,
    blocked: false,
    steps,
    actions: [],
    skipped: ["global sync skipped by doctor safe-local repair mode"],
    errors: [],
    manifest: [],
  };
}

function safeOperationId(prefix: string, value: string): string {
  const suffix = value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return suffix ? `${prefix}-${suffix}` : prefix;
}

async function readJsonValue(filePath: string): Promise<{ exists: boolean; valid: boolean; value?: unknown; error?: string }> {
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

async function repairRuntimePresetFiles(root: string, ctx: DoctorFixContext): Promise<void> {
  const runtimePresetPath = join(root, ".omk", "runtime-preset.json");
  const runtimePresetsPath = join(root, ".omk", "runtime-presets.json");
  const desiredPreset = OMK_PARALLEL_ORCHESTRATOR_PRESET;
  const currentPreset = await readJsonValue(runtimePresetPath);
  const presetNeedsRepair = !isRecord(currentPreset.value) || currentPreset.value.id !== desiredPreset.id;
  if (presetNeedsRepair) {
    if (!ctx.dryRun) {
      await mkdir(dirname(runtimePresetPath), { recursive: true });
      await writeFile(runtimePresetPath, `${JSON.stringify(desiredPreset, null, 2)}\n`, "utf-8");
    }
    recordDoctorFix(ctx, {
      id: "runtime-preset-default",
      category: "runtime",
      before: currentPreset.exists ? currentPreset.value ?? "invalid JSON" : "missing",
      after: desiredPreset.id,
      reason: `${ctx.dryRun ? "would repair" : "repaired"} .omk/runtime-preset.json default preset to ${desiredPreset.id}`,
      verifyCheck: "OMK Runtime",
    });
  }

  const currentPresets = await readJsonValue(runtimePresetsPath);
  let nextPresets: Record<string, unknown> = {
    defaultPresetId: OMK_PARALLEL_ORCHESTRATOR_PRESET.id,
    presets: OMK_RUNTIME_PRESETS,
  };
  if (isRecord(currentPresets.value)) {
    const desiredIds = new Set<string>(OMK_RUNTIME_PRESETS.map((preset) => preset.id));
    const extras = Array.isArray(currentPresets.value.presets)
      ? currentPresets.value.presets.filter((preset) => isRecord(preset) && typeof preset.id === "string" && !desiredIds.has(preset.id))
      : [];
    nextPresets = {
      ...currentPresets.value,
      defaultPresetId: OMK_PARALLEL_ORCHESTRATOR_PRESET.id,
      presets: [...OMK_RUNTIME_PRESETS, ...extras],
    };
  }
  if (JSON.stringify(currentPresets.value) !== JSON.stringify(nextPresets)) {
    if (!ctx.dryRun) {
      await mkdir(dirname(runtimePresetsPath), { recursive: true });
      await writeFile(runtimePresetsPath, `${JSON.stringify(nextPresets, null, 2)}\n`, "utf-8");
    }
    recordDoctorFix(ctx, {
      id: "runtime-presets-default",
      category: "runtime",
      before: currentPresets.exists ? currentPresets.value ?? "invalid JSON" : "missing",
      after: { defaultPresetId: OMK_PARALLEL_ORCHESTRATOR_PRESET.id },
      reason: `${ctx.dryRun ? "would repair" : "repaired"} .omk/runtime-presets.json defaultPresetId to ${OMK_PARALLEL_ORCHESTRATOR_PRESET.id}`,
      verifyCheck: "OMK Runtime",
    });
  }
}

const DEFAULT_SAFE_CONFIG_TOML = `# oh-my-kimi project settings
[orchestration]
execution_prompt = "ask"

[runtime]
mcp_scope = "project"
skills_scope = "project"
hooks_scope = "project"

[memory]
backend = "local_graph"
scope = "project-session"
strict = true
mirror_files = true
migrate_files = true

[local_graph]
path = ".omk/memory/graph-state.json"
ontology = "omk-ontology-mindmap-v1"
query = "graphql-lite"
`;

interface TomlStringRepairSpec {
  section: string;
  key: string;
  value: string;
  validValues?: readonly string[];
  allowCustomNonEmpty?: boolean;
}

function parseTomlStringValue(line: string): string | null {
  const match = /^[A-Za-z0-9_.-]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))/.exec(line.trim());
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function repairTomlStringKey(content: string, spec: TomlStringRepairSpec): { content: string; changed: boolean; before?: string | null } {
  const lines = content.replace(/\s*$/, "\n").split(/\r?\n/);
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let index = 0; index < lines.length; index++) {
    const sectionMatch = /^\s*\[([^\]]+)]\s*$/.exec(lines[index]);
    if (!sectionMatch) continue;
    if (sectionMatch[1] !== spec.section) continue;
    sectionStart = index;
    for (let next = index + 1; next < lines.length; next++) {
      if (/^\s*\[[^\]]+]\s*$/.test(lines[next])) {
        sectionEnd = next;
        break;
      }
    }
    break;
  }
  const desiredLine = `${spec.key} = ${JSON.stringify(spec.value)}`;
  if (sectionStart === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(`[${spec.section}]`, desiredLine);
    return { content: lines.join("\n").replace(/\n*$/, "\n"), changed: true, before: null };
  }
  for (let index = sectionStart + 1; index < sectionEnd; index++) {
    if (!new RegExp(`^\\s*${spec.key}\\s*=`).test(lines[index])) continue;
    const before = parseTomlStringValue(lines[index]);
    const valid = spec.allowCustomNonEmpty
      ? typeof before === "string" && before.trim().length > 0
      : spec.validValues?.includes(before ?? "") ?? before === spec.value;
    if (valid) return { content, changed: false, before };
    lines[index] = desiredLine;
    return { content: lines.join("\n").replace(/\n*$/, "\n"), changed: true, before };
  }
  lines.splice(sectionStart + 1, 0, desiredLine);
  return { content: lines.join("\n").replace(/\n*$/, "\n"), changed: true, before: null };
}

function repairProjectConfigTomlContent(content: string): { content: string; changes: Array<{ key: string; before?: string | null; after: string }> } {
  if (content.trim().length === 0) {
    return {
      content: DEFAULT_SAFE_CONFIG_TOML,
      changes: [
        { key: "orchestration.execution_prompt", before: null, after: "ask" },
        { key: "runtime.mcp_scope", before: null, after: "project" },
        { key: "runtime.skills_scope", before: null, after: "project" },
        { key: "runtime.hooks_scope", before: null, after: "project" },
        { key: "memory.backend", before: null, after: "local_graph" },
      ],
    };
  }
  const specs: TomlStringRepairSpec[] = [
    { section: "orchestration", key: "execution_prompt", value: "ask", validValues: ["ask", "auto", "parallel", "sequential"] },
    { section: "runtime", key: "mcp_scope", value: "project", validValues: ["all", "project", "none"] },
    { section: "runtime", key: "skills_scope", value: "project", validValues: ["all", "project", "none"] },
    { section: "runtime", key: "hooks_scope", value: "project", validValues: ["all", "project", "none"] },
    { section: "memory", key: "backend", value: "local_graph", validValues: ["local_graph", "kuzu"] },
    { section: "local_graph", key: "path", value: ".omk/memory/graph-state.json", allowCustomNonEmpty: true },
    { section: "local_graph", key: "ontology", value: "omk-ontology-mindmap-v1", validValues: ["omk-ontology-mindmap-v1"] },
    { section: "local_graph", key: "query", value: "graphql-lite", validValues: ["graphql-lite"] },
  ];
  let next = content;
  const changes: Array<{ key: string; before?: string | null; after: string }> = [];
  for (const spec of specs) {
    const repaired = repairTomlStringKey(next, spec);
    next = repaired.content;
    if (repaired.changed) {
      changes.push({ key: `${spec.section}.${spec.key}`, before: repaired.before, after: spec.value });
    }
  }
  return { content: next, changes };
}

async function repairProjectConfigToml(root: string, ctx: DoctorFixContext): Promise<void> {
  const configPath = join(root, ".omk", "config.toml");
  const existing = await readTextFile(configPath, "");
  const repaired = repairProjectConfigTomlContent(existing);
  if (repaired.changes.length === 0) return;
  if (!ctx.dryRun) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, repaired.content, "utf-8");
  }
  recordDoctorFix(ctx, {
    id: "project-config-safe-defaults",
    category: "runtime",
    before: repaired.changes.map((change) => ({ key: change.key, value: change.before ?? null })),
    after: repaired.changes.map((change) => ({ key: change.key, value: change.after })),
    reason: `${ctx.dryRun ? "would repair" : "repaired"} .omk/config.toml safe runtime/memory defaults`,
    verifyCheck: "Dangerous Config",
  });
}

async function repairLspConfig(root: string, ctx: DoctorFixContext): Promise<void> {
  const lspConfigPath = join(root, ".omk", "lsp.json");
  const current = await readJsonValue(lspConfigPath);
  const parsed = isRecord(current.value) ? current.value : null;
  const valid = parsed?.enabled === true && isRecord(parsed.servers) && isRecord(parsed.servers.typescript);
  if (valid) return;
  if (!ctx.dryRun) {
    await mkdir(dirname(lspConfigPath), { recursive: true });
    await writeFile(lspConfigPath, defaultLspConfigJson(), "utf-8");
  }
  recordDoctorFix(ctx, {
    id: "lsp-config",
    category: "scaffold",
    before: current.exists ? current.value ?? "invalid JSON" : "missing",
    after: "default TypeScript LSP config",
    reason: `${ctx.dryRun ? "would restore" : "restored"} .omk/lsp.json default TypeScript LSP config`,
    verifyCheck: "Built-in LSP",
  });
}

async function bootstrapLocalGraphMemory(root: string, ctx: DoctorFixContext): Promise<void> {
  const graphPath = join(root, ".omk", "memory", "graph-state.json");
  const current = await readJsonValue(graphPath);
  const parsed = isRecord(current.value) ? current.value : null;
  const valid = parsed?.version === 1 && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges);
  if (valid) return;
  if (!ctx.dryRun) {
    const store = new MemoryStore(join(root, ".omk", "memory"), {
      projectRoot: root,
      sessionId: "doctor-fix",
      source: "omk-doctor-fix",
      env: {
        ...process.env,
        OMK_MEMORY_BACKEND: "local_graph",
        OMK_MEMORY_FORCE: "0",
        OMK_MEMORY_STRICT: "false",
        OMK_MEMORY_MIRROR_FILES: "false",
        OMK_LOCAL_GRAPH_PATH: graphPath,
      },
    });
    await store.ensureGraphState();
  }
  recordDoctorFix(ctx, {
    id: "memory-graph-state",
    category: "memory",
    before: current.exists ? current.value ?? "invalid JSON" : "missing",
    after: ".omk/memory/graph-state.json local graph bootstrap",
    reason: `${ctx.dryRun ? "would bootstrap" : "bootstrapped"} .omk/memory/graph-state.json local graph memory`,
    verifyCheck: "Graph Memory",
  });
}

async function verifyWebBridgePackageEntries(ctx: DoctorFixContext): Promise<void> {
  const requiredPackageFiles = [
    "package.json",
    join("templates", "web-bridge", "chrome-extension", "manifest.json"),
    join("templates", "web-bridge", "chrome-extension", "background.js"),
    join("templates", "web-bridge", "chrome-extension", "content-script.js"),
    join("templates", "web-bridge", "chrome-extension", "popup.html"),
    join("templates", "web-bridge", "chrome-extension", "popup.js"),
  ];
  const missing: string[] = [];
  for (const relativePath of requiredPackageFiles) {
    if (!(await pathExists(join(packageRoot, relativePath)))) missing.push(relativePath);
  }
  if (missing.length === 0) return;
  recordDoctorFix(ctx, {
    id: "web-bridge-package-templates",
    category: "web-bridge",
    severity: "warn",
    status: "blocked",
    before: { missing },
    after: "package templates present",
    reason: `web bridge package templates missing; reinstall or rebuild OMK package: ${missing.join(", ")}`,
    verifyCheck: "web-bridge doctor",
  });
}

async function ensureLocalScaffold(root: string, ctx: DoctorFixContext): Promise<void> {
  const dirs = [
    ".omk/agents/roles",
    ".omk/hooks",
    ".omk/prompts",
    ".omk/memory",
    ".kimi/skills",
    ".agents/skills",
  ];
  for (const dir of dirs) {
    const fullPath = join(root, dir);
    if (await pathExists(fullPath)) continue;
    if (!ctx.dryRun) {
      await mkdir(fullPath, { recursive: true });
    }
    recordDoctorFix(ctx, {
      id: safeOperationId("create-dir", dir),
      category: "scaffold",
      before: "missing",
      after: dir,
      reason: `${ctx.dryRun ? "would create" : "created"} ${dir}`,
      verifyCheck: ".omk dir",
    });
  }

  await copyMissingTemplateFile(root, "AGENTS.md", ctx);
  await copyMissingTemplateFile(root, join(".kimi", "AGENTS.md"), ctx);
  await copyMissingTemplateFile(root, join(".omk", "agents", "okabe.yaml"), ctx);
  await copyMissingTemplateFile(root, join(".omk", "agents", "root.yaml"), ctx);
  await copyMissingTemplateFile(root, join(".omk", "prompts", "root.md"), ctx);
  await copyMissingTemplateTree(root, join("skills", "kimi"), join(".kimi", "skills"), ctx);
  await copyMissingTemplateTree(root, join("skills", "agents"), join(".agents", "skills"), ctx);
  await copyMissingTemplateTree(root, join(".omk", "agents", "roles"), join(".omk", "agents", "roles"), ctx);
  await ensureAgentCapabilityFlags(root, ctx);
  await ensureAgentPromptArgStrings(root, ctx);
  await ensureRootSubagentAliases(root, ctx);
}

async function ensureRootSubagentAliases(root: string, ctx: DoctorFixContext): Promise<void> {
  const rootYamlPath = join(root, ".omk", "agents", "root.yaml");
  const templateYamlPath = join(packageRoot, "templates", ".omk", "agents", "root.yaml");
  if (!(await pathExists(rootYamlPath)) || !(await pathExists(templateYamlPath))) return;

  try {
    const current = YAML.parse(await readTextFile(rootYamlPath, "")) as unknown;
    const template = YAML.parse(await readTextFile(templateYamlPath, "")) as unknown;
    if (!isRecord(current) || !isRecord(template)) return;
    const currentAgent = isRecord(current.agent) ? current.agent : null;
    const templateAgent = isRecord(template.agent) ? template.agent : null;
    if (!currentAgent || !templateAgent || !isRecord(templateAgent.subagents)) return;

    if (!isRecord(currentAgent.subagents)) currentAgent.subagents = {};
    const currentSubagents = currentAgent.subagents as Record<string, unknown>;
    let added = 0;
    for (const [name, value] of Object.entries(templateAgent.subagents)) {
      if (Object.prototype.hasOwnProperty.call(currentSubagents, name)) continue;
      currentSubagents[name] = value;
      added += 1;
    }
    if (added === 0) return;
    if (!ctx.dryRun) {
      await writeFile(rootYamlPath, YAML.stringify(current), "utf-8");
    }
    recordDoctorFix(ctx, {
      id: "root-subagent-aliases",
      category: "scaffold",
      before: "missing aliases",
      after: `${added} aliases`,
      reason: `${ctx.dryRun ? "would merge" : "merged"} ${added} missing root subagent alias(es) into .omk/agents/root.yaml`,
      verifyCheck: "root.yaml",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    recordDoctorFix(ctx, {
      id: "root-subagent-aliases-skipped",
      category: "scaffold",
      severity: "warn",
      status: "skipped",
      reason: `root subagent alias merge skipped: ${message}`,
      verifyCheck: "root.yaml",
    });
  }
}

async function copyMissingTemplateFile(
  root: string,
  relativePath: string,
  ctx: DoctorFixContext
): Promise<void> {
  const src = join(packageRoot, "templates", relativePath);
  const dest = join(root, relativePath);
  if (await pathExists(dest)) {
    const current = await readTextFile(dest, "");
    if (current.trim().length > 0) return;
  }
  if (!(await pathExists(src))) {
    recordDoctorFix(ctx, {
      id: safeOperationId("template-missing", relativePath),
      category: "scaffold",
      severity: "warn",
      status: "skipped",
      reason: `template missing: templates/${relativePath}`,
      verifyCheck: "OMK Scaffold",
    });
    return;
  }
  if (!ctx.dryRun) {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
  recordDoctorFix(ctx, {
    id: safeOperationId("restore-template", relativePath),
    category: "scaffold",
    before: "missing or empty",
    after: relativePath,
    reason: `${ctx.dryRun ? "would restore" : "restored"} ${relativePath} from template`,
    verifyCheck: "OMK Scaffold",
  });
}

async function copyMissingTemplateTree(
  root: string,
  templateRelativePath: string,
  destRelativePath: string,
  ctx: DoctorFixContext
): Promise<void> {
  const src = join(packageRoot, "templates", templateRelativePath);
  const dest = join(root, destRelativePath);
  if (!(await pathExists(src))) {
    recordDoctorFix(ctx, {
      id: safeOperationId("template-dir-missing", templateRelativePath),
      category: "scaffold",
      severity: "warn",
      status: "skipped",
      reason: `template dir missing: templates/${templateRelativePath}`,
      verifyCheck: "OMK Scaffold",
    });
    return;
  }
  const copied = await copyTreeMissingOnly(src, dest, ctx.dryRun);
  if (copied > 0) {
    recordDoctorFix(ctx, {
      id: safeOperationId("restore-template-tree", destRelativePath),
      category: "scaffold",
      before: "missing files",
      after: `${copied} file(s)`,
      reason: `${ctx.dryRun ? "would restore" : "restored"} ${copied} missing file(s) under ${destRelativePath}`,
      verifyCheck: "OMK Scaffold",
    });
  }
}

async function copyTreeMissingOnly(src: string, dest: string, dryRun: boolean): Promise<number> {
  const entries = await readdir(src, { withFileTypes: true });
  let copied = 0;
  if (!dryRun) {
    await mkdir(dest, { recursive: true });
  }
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += await copyTreeMissingOnly(srcPath, destPath, dryRun);
      continue;
    }
    if (!entry.isFile() || await pathExists(destPath)) continue;
    if (!dryRun) {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    }
    copied++;
  }
  return copied;
}

const AGENT_CAPABILITY_FLAGS = ["OMK_MCP_ENABLED", "OMK_SKILLS_ENABLED", "OMK_HOOKS_ENABLED"] as const;

async function ensureAgentCapabilityFlags(root: string, ctx: DoctorFixContext): Promise<void> {
  const agentFiles = [
    join(root, ".omk", "agents", "root.yaml"),
    join(root, ".omk", "agents", "okabe.yaml"),
  ];
  const rolesDir = join(root, ".omk", "agents", "roles");
  if (await pathExists(rolesDir)) {
    try {
      const entries = await readdir(rolesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".yaml")) {
          agentFiles.push(join(rolesDir, entry.name));
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      recordDoctorFix(ctx, {
        id: "agent-role-scan-skipped",
        category: "scaffold",
        severity: "warn",
        status: "skipped",
        reason: `agent role scan skipped: ${message}`,
        verifyCheck: "Agent YAML Schema",
      });
    }
  }

  for (const filePath of agentFiles) {
    if (!(await pathExists(filePath))) continue;
    const content = await readTextFile(filePath, "");
    const next = withAgentCapabilityFlags(content);
    if (next === content) continue;
    if (!ctx.dryRun) {
      await writeFile(filePath, next, "utf-8");
    }
    recordDoctorFix(ctx, {
      id: safeOperationId("agent-capability-flags", filePath),
      category: "scaffold",
      before: "missing MCP/skills/hooks flags",
      after: "OMK_MCP_ENABLED/OMK_SKILLS_ENABLED/OMK_HOOKS_ENABLED",
      reason: `${ctx.dryRun ? "would enable" : "enabled"} MCP/skills/hooks flags in ${filePath}`,
      verifyCheck: "Agent YAML Schema",
    });
  }
}

async function ensureAgentPromptArgStrings(root: string, ctx: DoctorFixContext): Promise<void> {
  if (ctx.dryRun) return;
  const report = await repairProjectAgentPromptArgStrings(root);
  if (report.convertedArgs > 0) {
    recordDoctorFix(ctx, {
      id: "agent-prompt-args",
      category: "scaffold",
      before: "non-string system_prompt_args",
      after: `${report.convertedArgs} converted`,
      reason: `converted ${report.convertedArgs} agent system_prompt_args value(s) to strings`,
      verifyCheck: "Agent YAML Schema",
    });
  }
  for (const filePath of report.changedFiles) {
    recordDoctorFix(ctx, {
      id: safeOperationId("agent-prompt-args", filePath),
      category: "scaffold",
      before: "non-string system_prompt_args",
      after: "string system_prompt_args",
      reason: `normalized agent prompt args in ${filePath}`,
      verifyCheck: "Agent YAML Schema",
    });
  }
  for (const item of report.skipped) {
    recordDoctorFix(ctx, {
      id: safeOperationId("agent-prompt-args-skipped", item),
      category: "scaffold",
      severity: "warn",
      status: "skipped",
      reason: `agent prompt arg repair skipped: ${item}`,
      verifyCheck: "Agent YAML Schema",
    });
  }
}

function withAgentCapabilityFlags(content: string): string {
  const missing = AGENT_CAPABILITY_FLAGS.filter((flag) =>
    !new RegExp(`^\\s*${flag}:\\s*["']?true["']?\\s*$`, "m").test(content)
  );
  if (missing.length === 0) return content;
  const lines = content.split(/\r?\n/);
  const insertAt = lines.findIndex((line) => /^\s*system_prompt_args:\s*$/.test(line));
  const flagLines = missing.map((flag) => `    ${flag}: "true"`);
  if (insertAt >= 0) {
    lines.splice(insertAt + 1, 0, ...flagLines);
    return lines.join("\n");
  }
  const agentAt = lines.findIndex((line) => /^\s*agent:\s*$/.test(line));
  if (agentAt >= 0) {
    lines.splice(agentAt + 1, 0, "  system_prompt_args:", ...flagLines);
    return lines.join("\n");
  }
  return content;
}

async function repairHookExecutables(root: string, ctx: DoctorFixContext): Promise<void> {
  const hooksDir = join(root, ".omk", "hooks");
  if (!(await pathExists(hooksDir))) return;
  try {
    const entries = await readdir(hooksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".sh")) continue;
      const hookPath = join(hooksDir, entry.name);
      const stats = await fsStat(hookPath);
      if ((stats.mode & 0o111) !== 0) continue;
      if (!ctx.dryRun) {
        await chmod(hookPath, stats.mode | 0o755);
      }
      recordDoctorFix(ctx, {
        id: safeOperationId("hook-executable", hookPath),
        category: "hooks",
        before: stats.mode,
        after: stats.mode | 0o755,
        reason: `${ctx.dryRun ? "would make" : "made"} hook executable: ${hookPath}`,
        verifyCheck: "Hooks Exec",
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    recordDoctorFix(ctx, {
      id: "hook-executable-skipped",
      category: "hooks",
      severity: "warn",
      status: "skipped",
      reason: `hook executable repair skipped: ${message}`,
      verifyCheck: "Hooks Exec",
    });
  }
}

async function repairGitSafeDirectory(root: string, ctx: DoctorFixContext): Promise<void> {
  const repoCheck = await runShell("git", ["rev-parse", "--git-dir"], { cwd: root, timeout: 5000 });
  if (!repoCheck.failed || !repoCheck.stderr.includes("safe.directory")) return;
  if (ctx.dryRun) {
    recordDoctorFix(ctx, {
      id: "git-safe-directory",
      category: "git",
      safetyTier: "global",
      before: "safe.directory missing",
      after: root,
      reason: `would add git safe.directory for ${root}`,
      verifyCheck: "Git Safe Directory",
    });
    return;
  }
  const result = await runShell("git", ["config", "--global", "--add", "safe.directory", root], { timeout: 5000 });
  if (result.failed) {
    recordDoctorFix(ctx, {
      id: "git-safe-directory-failed",
      category: "git",
      severity: "error",
      safetyTier: "global",
      status: "failed",
      reason: `git safe.directory repair failed: ${result.stderr.trim() || result.stdout.trim()}`,
      verifyCheck: "Git Safe Directory",
    });
    return;
  }
  recordDoctorFix(ctx, {
    id: "git-safe-directory",
    category: "git",
    safetyTier: "global",
    before: "safe.directory missing",
    after: root,
    reason: `added git safe.directory for ${root}`,
    verifyCheck: "Git Safe Directory",
  });
}

async function reportSkippedGitSafeDirectoryRepair(root: string, ctx: DoctorFixContext): Promise<void> {
  const repoCheck = await runShell("git", ["rev-parse", "--git-dir"], { cwd: root, timeout: 5000 });
  if (!repoCheck.failed || !repoCheck.stderr.includes("safe.directory")) return;
  recordDoctorFix(ctx, {
    id: "git-safe-directory-skipped",
    category: "git",
    severity: "warn",
    safetyTier: "global",
    status: "skipped",
    reason: "git safe.directory repair skipped (safe default; pass `omk doctor --fix --global` or set OMK_DOCTOR_FIX_GLOBAL=1)",
    verifyCheck: "Git Safe Directory",
  });
}

// ── Runtime ───────────────────────────────────────────────────

async function runtimeChecks(resources: Awaited<ReturnType<typeof getOmkResourceSettings>>): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
  results.push({
    name: "Node.js",
    status: nodeMajor >= 20 ? "ok" : "warn",
    message: nodeMajor >= 20 ? `${nodeVersion}` : `${nodeVersion} ${t("doctor.nodeRecommend")}`,
  });

  try {
    const npmVersion = execSync("npm --version", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], timeout: 5000 }).trim();
    const npmMajor = parseInt(npmVersion.split(".")[0], 10);
    results.push({
      name: "npm",
      status: npmMajor >= 10 ? "ok" : "warn",
      message: npmMajor >= 10 ? `v${npmVersion}` : `v${npmVersion} — npm 10+ recommended`,
    });
  } catch {
    results.push({ name: "npm", status: "warn", message: "Unable to detect npm version" });
  }

  try {
    // npm 10+ removed `npm bin -g`; use `npm prefix -g` exclusively
    const prefix = execSync("npm prefix -g", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], timeout: 5000 }).trim();
    const npmBin = join(prefix, process.platform === "win32" ? "" : "bin");
    if (npmBin) {
      const pathDelimiter = process.platform === "win32" ? ";" : ":";
      const inPath = process.env.PATH?.split(pathDelimiter).some((p) => p === npmBin || npmBin.startsWith(p));
      results.push({
        name: "npm global bin",
        status: inPath ? "ok" : "warn",
        message: inPath ? npmBin : `${npmBin} not in PATH`,
      });

      // PATH diagnosis: check if omk is in npm global bin but not in PATH
      const omkPath = join(npmBin, "omk");
      if (!inPath && (await pathExists(omkPath))) {
        results.push({
          name: "omk in PATH",
          status: "warn",
          message: `omk found at ${omkPath} but not in PATH — add ${npmBin} to your shell profile`,
        });
      }
    } else {
      results.push({ name: "npm global bin", status: "warn", message: "Unable to detect npm global bin" });
    }
  } catch {
    results.push({ name: "npm global bin", status: "warn", message: "npm bin detection failed" });
  }

  results.push({
    name: "OMK Runtime",
    status: resources.profile === "lite" ? "info" : "ok",
    message: `profile=${resources.profile}, RAM=${resources.totalMemoryGb}GB, workers=${resources.maxWorkers}, buffer=${formatBytes(resources.shellMaxBufferBytes)}`,
  });

  const currentVersion = getOmkVersionSync();
  try {
    const latest = execSync("npm view @oh-my-kimi/cli version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (latest && semverGt(latest, currentVersion)) {
      results.push({
        name: "OMK Version",
        status: "warn",
        message: `${currentVersion} → ${latest} available. Run: npm i -g @oh-my-kimi/cli`,
      });
    } else {
      results.push({
        name: "OMK Version",
        status: "ok",
        message: `${currentVersion} (latest)`,
      });
    }
  } catch {
    results.push({
      name: "OMK Version",
      status: "info",
      message: `${currentVersion} (offline or registry unreachable)`,
    });
  }

  return results;
}

// ── Toolchain ─────────────────────────────────────────────────

async function toolchainChecks(root: string): Promise<CheckResult[]> {
  const [gitAvailable, jqExists, tmuxExists, cargoExists, rustcExists, rustSafetyCrateExists] = await Promise.all([
    isGitAvailable(),
    checkCommand("jq"),
    checkCommand("tmux"),
    checkCommand("cargo"),
    checkCommand("rustc"),
    pathExists(join(root, "crates", "omk-safety", "Cargo.toml")),
  ]);

  const results: CheckResult[] = [];

  // Git checks — semantically distinct for correct JSON output
  results.push({
    name: "Git Installed",
    status: gitAvailable ? "ok" : "fail",
    message: gitAvailable ? "Installed" : t("doctor.gitNotFound"),
  });

  results.push({
    name: "Git Available",
    status: gitAvailable ? "ok" : "fail",
    message: gitAvailable ? "Available" : t("doctor.gitNotFound"),
  });

  if (gitAvailable) {
    const repoCheck = await runShell("git", ["rev-parse", "--git-dir"], { cwd: root, timeout: 5000 });
    const isRepo = !repoCheck.failed;
    const safeDirIssueFromRepoCheck = repoCheck.failed && repoCheck.stderr.includes("safe.directory");

    let repoMessage = isRepo ? "Repository detected" : t("doctor.gitNotRepo");
    if (safeDirIssueFromRepoCheck) {
      repoMessage = `Repository detected but blocked by safe.directory — run: git config --global --add safe.directory "${root}"`;
    }
    results.push({
      name: "Git Repo",
      status: isRepo ? "ok" : "warn",
      message: repoMessage,
    });

    if (isRepo) {
      const [branch, gitStatus] = await Promise.all([getCurrentBranch(), getGitStatus()]);
      results.push({
        name: "Git Clean",
        status: gitStatus.clean ? "ok" : "warn",
        message: t("doctor.gitBranchChanges", branch ?? "?", gitStatus.changes),
      });

      const statusResult = await runShell("git", ["status"], { cwd: root, timeout: 5000 });
      const safeDirIssue = statusResult.failed && statusResult.stderr.includes("safe.directory");
      results.push({
        name: "Git Safe Directory",
        status: safeDirIssue ? "warn" : "ok",
        message: safeDirIssue ? "safe.directory configuration needed" : "no safe.directory issues",
      });
    } else {
      results.push({
        name: "Git Clean",
        status: "info",
        message: "not a git repository",
      });
      results.push({
        name: "Git Safe Directory",
        status: safeDirIssueFromRepoCheck ? "warn" : "info",
        message: safeDirIssueFromRepoCheck ? "safe.directory configuration needed" : "not a git repository",
      });
    }
  } else {
    results.push({
      name: "Git Repo",
      status: "info",
      message: t("doctor.gitNotFound"),
    });
    results.push({
      name: "Git Clean",
      status: "info",
      message: t("doctor.gitNotFound"),
    });
    results.push({
      name: "Git Safe Directory",
      status: "info",
      message: t("doctor.gitNotFound"),
    });
  }

  results.push({
    name: "jq",
    status: jqExists ? "ok" : "fail",
    message: jqExists ? t("doctor.jqInstalled") : t("doctor.jqMissing"),
  });

  results.push({
    name: "tmux",
    status: tmuxExists ? "ok" : "info",
    message: tmuxExists ? t("doctor.tmuxInstalled") : t("doctor.tmuxRecommend"),
  });

  results.push({
    name: "Rust Cargo",
    status: cargoExists ? "ok" : "info",
    message: cargoExists ? "cargo available" : "cargo not found — Rust safety harness checks will be skipped",
  });

  results.push({
    name: "Rust Compiler",
    status: rustcExists ? "ok" : "info",
    message: rustcExists ? "rustc available" : "rustc not found — Rust safety harness checks will be skipped",
  });

  results.push({
    name: "Rust Safety Crate",
    status: rustSafetyCrateExists ? "ok" : "info",
    message: rustSafetyCrateExists ? "crates/omk-safety configured" : "no Rust safety crate configured",
  });

  results.push(await rustSafetyNativeCheck(root));

  const pkgMgr = detectPackageManager(root);
  results.push({ name: "Pkg Manager", status: "ok", message: `${pkgMgr} detected` });

  const tsconfigExists = await pathExists(join(root, "tsconfig.json"));
  results.push({
    name: "TypeScript",
    status: tsconfigExists ? "ok" : "info",
    message: tsconfigExists ? "tsconfig.json found" : "No tsconfig.json — TS project?",
  });

  return results;
}

async function rustSafetyNativeCheck(root: string): Promise<CheckResult> {
  const result = await runOmkSafetySelfTest({ root });
  return {
    name: "Rust Safety Native",
    status: result.status,
    message: result.message,
    metadata: {
      source: result.source,
      platformArch: result.platformArch,
      builtFromSource: result.builtFromSource,
      path: result.path,
      checks: result.checks,
    },
  };
}

// ── Kimi CLI ──────────────────────────────────────────────────

async function kimiChecks(root: string, resources: OmkResourceSettings): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const kimiExists = await checkCommand("kimi");
  const agentTools = await readAgentToolDeclarations(root);
  const agentYamlDeclaresWebTools = Boolean(agentTools?.hasSearchWeb && agentTools.hasFetchURL);

  if (kimiExists) {
    const version = await getKimiVersion();
    results.push({ name: "Primary CLI", status: "ok", message: version ?? t("doctor.kimiInstalled") });
    results.push({
      name: "Primary Runnable",
      status: version ? "ok" : "warn",
      message: version ? t("doctor.kimiRunnable") : t("doctor.kimiRunFailed"),
    });

    // Session indicator check
    try {
      const kimiConfigPath = getKimiConfigPath();
      const kimiConfig = await readTextFile(kimiConfigPath, "");
      const hasIndicators = /default_model|session|credential/.test(kimiConfig);
      results.push({
        name: "Primary Session",
        status: hasIndicators ? "ok" : "warn",
        message: hasIndicators ? "config indicators present" : "provider login may be required",
      });
    } catch {
      results.push({ name: "Primary Session", status: "warn", message: "config read failed" });
    }
  } else {
    results.push({ name: "Primary CLI", status: "fail", message: t("doctor.kimiNotFound") });
    results.push({ name: "Primary Install Guide", status: "info", message: "curl -LsSf https://code.kimi.com/install.sh | bash or see https://github.com/dmae97/oh-my-kimi#install" });
    results.push({ name: "Primary Capabilities", status: "info", message: "unknown — primary CLI not installed" });
  }

  const kimiConfigPath = getKimiConfigPath();
  const kimiConfigExists = await pathExists(kimiConfigPath);
  results.push({
    name: "Primary Config",
    status: kimiConfigExists ? "ok" : "warn",
    message: kimiConfigExists ? t("doctor.kimiConfigExists") : t("doctor.kimiConfigMissing"),
  });

  if (kimiConfigExists) {
    const kimiContent = await readTextFile(kimiConfigPath, "");
    const hasOmkHooks = kimiContent.includes("# >>> omk managed hooks");
    const projectHooksConfig = await readTextFile(join(root, ".omk", "kimi.config.toml"), "");
    const hasProjectHooks = resources.hooksScope !== "none" && /\[\[hooks\]\]/.test(projectHooksConfig);
    results.push({
      name: "OMK Hooks",
      status: hasOmkHooks || hasProjectHooks ? "ok" : "warn",
      message: hasOmkHooks ? t("doctor.hooksSynced") : hasProjectHooks ? `project hooks active (${resources.hooksScope})` : t("doctor.hooksRecommendSync"),
    });
  }

  // Capability probe
  if (kimiExists) {
    const caps = getKimiCapabilities();
    const supported = [
      caps.model && "model",
      caps.thinking && "thinking",
      caps.temperature && "temperature",
      caps.topP && "top-p",
      caps.variant && "variant",
    ].filter(Boolean);
    results.push({
      name: "Primary Capabilities",
      status: supported.length > 0 ? "ok" : "info",
      message: supported.length > 0 ? supported.join(", ") : "no extended sampling flags",
    });

    results.push({
      name: "Primary Agent File",
      status: caps.agentFile ? "ok" : "warn",
      message: caps.agentFile ? "--agent-file supported" : "--agent-file not detected — update primary CLI",
    });

    const webToolStatus = caps.webTools ? "ok" : agentYamlDeclaresWebTools ? "info" : "warn";
    results.push({
      name: "Primary Web Tools",
      status: webToolStatus,
      message: caps.webTools
        ? "SearchWeb / FetchURL available"
        : agentYamlDeclaresWebTools
          ? "web tool declarations present; CLI help does not expose tool availability"
          : "web search tools not detected — may be unavailable",
    });

    results.push({
      name: "Primary Swarm",
      status: caps.swarmStatus === "available" ? "ok" : caps.swarmStatus === "unavailable" ? "info" : "warn",
      message: caps.swarmStatus === "available"
        ? "K2.6 Agent Swarm platform capability detected"
        : caps.swarmStatus === "unavailable"
          ? "swarm APIs not available in this primary CLI version"
          : "unable to detect swarm capability from version",
    });
  }

  // Agent YAML tools check
  if (agentTools) {
    const { hasAgentTool, hasSearchWeb, hasFetchURL, usesDefaultToolSurface } = agentTools;
    const agentToolStatus = hasAgentTool && hasSearchWeb && hasFetchURL ? "ok" : "warn";
    results.push({
      name: "Agent YAML Tools",
      status: agentToolStatus,
      message: hasAgentTool && hasSearchWeb && hasFetchURL
        ? usesDefaultToolSurface
          ? "agent inheritance includes Agent, SearchWeb, FetchURL via default tool surface"
          : "agent inheritance includes Agent, SearchWeb, FetchURL"
        : `agent inheritance missing tools: ${[!hasAgentTool && "Agent", !hasSearchWeb && "SearchWeb", !hasFetchURL && "FetchURL"].filter(Boolean).join(", ")}`,
    });
  }

  return results;
}

// ── Project ───────────────────────────────────────────────────

async function projectChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const agentsMdPath = join(root, "AGENTS.md");
  const kimiAgentsMdPath = join(root, ".kimi", "AGENTS.md");
  const [agentsMdExists, kimiAgentsMdExists, agentsMdContent, kimiAgentsMdContent] = await Promise.all([
    pathExists(agentsMdPath),
    pathExists(kimiAgentsMdPath),
    readTextFile(agentsMdPath, ""),
    readTextFile(kimiAgentsMdPath, ""),
  ]);
  const agentsMdNonEmpty = agentsMdContent.trim().length > 0;
  const kimiAgentsMdNonEmpty = kimiAgentsMdContent.trim().length > 0;
  results.push({
    name: "AGENTS.md",
    status: agentsMdNonEmpty ? "ok" : agentsMdExists ? "fail" : "warn",
    message: agentsMdNonEmpty
      ? t("doctor.agentsMdExists")
      : agentsMdExists
        ? "AGENTS.md is empty"
        : t("doctor.agentsMdMissing"),
  });
  results.push({
    name: ".kimi/AGENTS.md",
    status: kimiAgentsMdNonEmpty ? "ok" : kimiAgentsMdExists ? "fail" : "warn",
    message: kimiAgentsMdNonEmpty
      ? t("doctor.kimiAgentsMdExists")
      : kimiAgentsMdExists
        ? ".kimi/AGENTS.md is empty"
        : t("doctor.kimiAgentsMdMissing"),
  });

  return results;
}

// ── OMK Scaffold ──────────────────────────────────────────────

async function omkChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const omkDir = join(root, ".omk");
  const omkExists = await pathExists(omkDir);

  results.push({
    name: ".omk dir",
    status: omkExists ? "ok" : "warn",
    message: omkExists ? t("doctor.omkInitialized") : t("doctor.omkInitNeeded"),
  });

  if (omkExists) {
    try {
      const testFile = join(omkDir, ".doctor-write-test");
      const fs = await import("fs/promises");
      await fs.writeFile(testFile, "ok", "utf-8");
      await fs.rm(testFile);
      results.push({ name: ".omk writable", status: "ok", message: "write test passed" });
    } catch {
      results.push({ name: ".omk writable", status: "fail", message: ".omk is not writable" });
    }
  }

  const rootYamlExists = await pathExists(join(omkDir, "agents", "root.yaml"));
  results.push({
    name: "root.yaml",
    status: rootYamlExists ? "ok" : "warn",
    message: rootYamlExists ? t("doctor.rootYamlExists") : t("doctor.rootYamlMissing"),
  });

  const agentYamlPaths = [join(omkDir, "agents", "root.yaml")];
  const rolesDir = join(omkDir, "agents", "roles");
  if (await pathExists(rolesDir)) {
    try {
      const entries = await readdir(rolesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".yaml")) {
          agentYamlPaths.push(join(rolesDir, entry.name));
        }
      }
    } catch { /* ignore */ }
  }
  const agentChecks = await Promise.all(
    agentYamlPaths.map(async (agentPath) => {
      if (!(await pathExists(agentPath))) return { exists: false, extendsOkabe: false };
      const content = await readTextFile(agentPath, "");
      const extendsOkabe = /^\s*extend:\s*(?:\.\.\/|\.)?\/?okabe\.yaml\b/m.test(content);
      return { exists: true, extendsOkabe };
    })
  );
  const totalAgentCount = agentChecks.filter((c) => c.exists).length;
  const okabeAgentCount = agentChecks.filter((c) => c.extendsOkabe).length;
  const okabeBase = await readTextFile(join(omkDir, "agents", "okabe.yaml"), "");
  const okabeBaseHasRequiredTools =
    okabeBase.includes("kimi_cli.tools.agent:Agent") &&
    okabeBase.includes("kimi_cli.tools.dmail:SendDMail") &&
    /^\s*tools:\s*$/m.test(okabeBase);
  results.push({
    name: "Okabe Agents",
    status: totalAgentCount > 0 && okabeAgentCount === totalAgentCount && okabeBaseHasRequiredTools ? "ok" : "warn",
    message: totalAgentCount > 0 && okabeBaseHasRequiredTools
      ? `${okabeAgentCount}/${totalAgentCount} agents inherit okabe.yaml (Agent + SendDMail)`
      : t("doctor.okabeMissing"),
  });

  const rootPromptPath = join(omkDir, "prompts", "root.md");
  let rootPromptValid = false;
  let rootPromptHasAgentsMd = false;
  let rootPromptHasSkills = false;
  if (await pathExists(rootPromptPath)) {
    const rootPrompt = await readTextFile(rootPromptPath, "");
    rootPromptHasAgentsMd = rootPrompt.includes("${KIMI_AGENTS_MD}");
    rootPromptHasSkills = rootPrompt.includes("${KIMI_SKILLS}");
    rootPromptValid = rootPromptHasAgentsMd && rootPromptHasSkills;
  }
  results.push({
    name: "Root Prompt",
    status: rootPromptValid ? "ok" : "warn",
    message: rootPromptValid
      ? t("doctor.rootPromptInjected")
      : t("doctor.rootPromptPartial", !rootPromptHasAgentsMd ? "AGENTS_MD " : "", !rootPromptHasSkills ? "SKILLS" : ""),
  });

  const hooksDir = join(omkDir, "hooks");
  let hooksExecutable = true;
  if (await pathExists(hooksDir)) {
    try {
      const fs = await import("fs/promises");
      const entries = await fs.readdir(hooksDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".sh")) {
          const stat = await fs.stat(join(hooksDir, entry.name));
          if ((stat.mode & 0o111) === 0) hooksExecutable = false;
        }
      }
    } catch { /* ignore */ }
  }
  results.push({
    name: "Hooks Exec",
    status: hooksExecutable ? "ok" : "warn",
    message: hooksExecutable ? t("doctor.hooksExecutable") : t("doctor.hooksNotExecutable"),
  });

  return results;
}

async function agentYamlChecks(root: string): Promise<CheckResult[]> {
  const report = await validateProjectAgentYaml(root);
  if (report.errors.length > 0) {
    return [{
      name: "Agent YAML Schema",
      status: "fail",
      message: formatAgentYamlIssues(report),
      metadata: {
        errors: report.errors.map((item) => `${item.file}: ${item.message}`),
        warnings: report.warnings.map((item) => `${item.file}: ${item.message}`),
      },
    }];
  }
  if (
    report.warnings.length === 1 &&
    report.warnings[0]?.code === "project-agents-not-initialized"
  ) {
    return [{
      name: "Agent YAML Schema",
      status: "info",
      message: report.warnings[0].message,
      metadata: {
        warnings: report.warnings.map((item) => `${item.file}: ${item.message}`),
      },
    }];
  }
  if (report.warnings.length > 0) {
    return [{
      name: "Agent YAML Schema",
      status: "warn",
      message: formatAgentYamlIssues(report),
      metadata: {
        warnings: report.warnings.map((item) => `${item.file}: ${item.message}`),
      },
    }];
  }
  return [{ name: "Agent YAML Schema", status: "ok", message: "agent YAML schema is valid" }];
}

// ── MCP & Skills ──────────────────────────────────────────────

async function mcpSkillsChecks(root: string, resources: OmkResourceSettings): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const kimiSkillsDir = join(root, ".kimi", "skills");
  const agentsSkillsDir = join(root, ".agents", "skills");
  const projectKimiMcpPath = join(root, ".kimi", "mcp.json");
  const omkMcpPath = join(root, ".omk", "mcp.json");
  const globalMcpPath = join(getUserHome(), ".kimi", "mcp.json");
  const [projectKimiMcp, omkMcp, globalMcp, kimiSkillsCount, agentsSkillsCount] = await Promise.all([
    inspectJsonFile(projectKimiMcpPath),
    inspectJsonFile(omkMcpPath),
    inspectJsonFile(globalMcpPath),
    (async () => {
      if (!(await pathExists(kimiSkillsDir))) return 0;
      try {
        const fs = await import("fs/promises");
        const entries = await fs.readdir(kimiSkillsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).length;
      } catch { return 0; }
    })(),
    (async () => {
      if (!(await pathExists(agentsSkillsDir))) return 0;
      try {
        const fs = await import("fs/promises");
        const entries = await fs.readdir(agentsSkillsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).length;
      } catch { return 0; }
    })(),
  ]);
  results.push({
    name: "Project MCP",
    status: projectKimiMcp.exists ? "ok" : "info",
    message: projectKimiMcp.exists ? t("doctor.mcpExists") : t("doctor.mcpMissing"),
  });
  results.push({
    name: "OMK MCP",
    status: resources.mcpScope === "none" ? "info" : "ok",
    message: resources.mcpScope === "none"
      ? "omk-project virtual runtime MCP injection disabled by MCP scope none"
      : "omk-project virtual runtime MCP injected at chat/runtime startup (not written to project/global MCP files)",
  });
  const activeDiagnostics = resources.mcpScope === "all" ? [omkMcp, projectKimiMcp, globalMcp] : [omkMcp, projectKimiMcp];
  for (const diagnostic of activeDiagnostics) {
    if (!diagnostic.exists || diagnostic.valid) continue;
    results.push({
      name: "MCP JSON",
      status: "fail",
      message: `${diagnostic.path}: ${diagnostic.error ?? "Invalid JSON"}`,
    });
  }
  if (globalMcp.exists && !globalMcp.valid && resources.mcpScope !== "all") {
    results.push({
      name: "Global MCP JSON",
      status: "info",
      message: `${globalMcp.path}: invalid but inactive in project MCP scope`,
    });
  }
  results.push({
    name: ".kimi/skills",
    status: kimiSkillsCount > 0 ? "ok" : "warn",
    message: kimiSkillsCount > 0 ? t("doctor.skillsExist", kimiSkillsCount) : t("doctor.skillsMissing"),
  });
  results.push({
    name: ".agents/skills",
    status: agentsSkillsCount > 0 ? "ok" : "warn",
    message: agentsSkillsCount > 0 ? t("doctor.agentSkillsExist", agentsSkillsCount) : t("doctor.agentSkillsMissing"),
  });

  const lspConfigPath = join(root, ".omk", "lsp.json");
  const tsLspBinary = resolveBundledLspBinary("typescript");
  const [lspConfigExists, tsLspAvailable] = await Promise.all([
    pathExists(lspConfigPath),
    tsLspBinary.includes("/") || tsLspBinary.includes("\\")
      ? pathExists(tsLspBinary)
      : checkCommand(tsLspBinary),
  ]);
  let lspConfigValid = false;
  if (lspConfigExists) {
    try {
      const parsed = JSON.parse(await readTextFile(lspConfigPath, "{}")) as {
        enabled?: boolean;
        servers?: Record<string, unknown>;
      };
      lspConfigValid = parsed.enabled === true && typeof parsed.servers?.typescript === "object";
    } catch { /* ignore */ }
  }
  results.push({
    name: "Built-in LSP",
    status: lspConfigValid && tsLspAvailable ? "ok" : "warn",
    message: lspConfigValid && tsLspAvailable
      ? `.omk/lsp.json + TypeScript LSP (${tsLspBinary})`
      : t("doctor.lspMissing"),
  });

  let globalMcpCount = 0;
  const stdioMcpServers: string[] = [];
  const npxMcpServers: string[] = [];
  if (globalMcp.valid) {
    const content = await readTextFile(globalMcpPath, "{}");
    const parsed = redactSecrets(JSON.parse(content)) as {
      mcpServers?: Record<string, { command?: string; type?: string }>;
    };
    const servers: Record<string, { command?: string; type?: string }> = parsed.mcpServers ?? {};
    globalMcpCount = Object.keys(servers).length;
    for (const [name, cfg] of Object.entries(servers)) {
      if (cfg.type === "stdio" || !cfg.type) {
        stdioMcpServers.push(name);
        if (isNpmLauncherCommand(cfg.command)) {
          npxMcpServers.push(name);
        }
      }
    }
  }
  results.push({
    name: "Global MCP",
    status: globalMcp.valid && globalMcpCount > 0 ? "ok" : resources.mcpScope === "all" ? "warn" : "info",
    message: globalMcp.valid && globalMcpCount > 0
      ? t("doctor.globalMcpSynced", globalMcpCount)
      : resources.mcpScope === "all"
        ? t("doctor.globalMcpMissing")
        : `${t("doctor.globalMcpMissing")} (optional in project MCP scope)`,
  });
  if (stdioMcpServers.length > 0) {
    results.push({
      name: "Global MCP (stdio)",
      status: npxMcpServers.length > 0 ? "warn" : "info",
      message:
        `${stdioMcpServers.join(", ")} — ` +
        (npxMcpServers.length > 0
          ? `npx-based servers (${npxMcpServers.join(", ")}) may fail to connect and crash Kimi CLI sessions. Remove or fix them in ~/.kimi/mcp.json if unused.`
          : "stdio servers detected. Ensure they are available."),
    });
  }

  const globalSkillsDir = join(getUserHome(), ".kimi", "skills");
  const globalSkillsExists = await pathExists(globalSkillsDir);
  let globalSkillCount = 0;
  if (globalSkillsExists) {
    try {
      const fs = await import("fs/promises");
      const entries = await fs.readdir(globalSkillsDir, { withFileTypes: true });
      globalSkillCount = entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).length;
    } catch { /* ignore */ }
  }
  results.push({
    name: "Global Skills",
    status: globalSkillCount > 0 ? "ok" : "info",
    message: globalSkillCount > 0 ? t("doctor.globalSkillsSynced", globalSkillCount) : t("doctor.globalSkillsMissing"),
  });

  try {
    const mcpDoctor = await buildMcpDoctorReport();
    results.push({
      name: "MCP Doctor",
      status: mcpDoctor.ok ? "ok" : "fail",
      message: mcpDoctor.ok
        ? `activeScope=${mcpDoctor.activeScope}, servers=${mcpDoctor.servers.length}`
        : `${mcpDoctor.issueCount} issue(s): ${mcpDoctor.errors[0] ?? "MCP diagnostics failed"}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name: "MCP Doctor", status: "fail", message });
  }

  // Advanced: routing inventory discovery (uses skills + mcp)
  try {
    const inventory = discoverRoutingInventory(root);
    const skillNames = [...inventory.skills.keys()];
    const mcpNames = [...inventory.mcpServers.keys()];
    const toolNames = [...inventory.tools];
    results.push({
      name: "Routing",
      status: "ok",
      message: `${skillNames.length} skills, ${mcpNames.length} MCPs, ${toolNames.length} tools discovered`,
    });
  } catch {
    results.push({ name: "Routing", status: "warn", message: "routing inventory discovery failed" });
  }

  return results;
}

// ── Memory ────────────────────────────────────────────────────

async function memoryChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const globalMemoryConfigPath = getGlobalMemoryConfigPath();
  const globalKimiDir = join(getUserHome(), ".kimi");
  const [globalMemoryConfigExists, memorySettings, globalKimiDirExists] = await Promise.all([
    pathExists(globalMemoryConfigPath),
    loadMemorySettings(root),
    pathExists(globalKimiDir),
  ]);

  results.push({
    name: "Global Memory",
    status: globalMemoryConfigExists ? "ok" : isGraphMemoryBackend(memorySettings.backend) ? "info" : "warn",
    message: globalMemoryConfigExists
      ? t("doctor.memorySynced")
      : isGraphMemoryBackend(memorySettings.backend)
        ? `${t("doctor.memoryMissing")} (optional with ${memorySettings.backend} backend)`
        : t("doctor.memoryMissing"),
  });

  results.push({
    name: "Graph Memory",
    status: isGraphMemoryBackend(memorySettings.backend) ? "ok" : "info",
    message: isGraphMemoryBackend(memorySettings.backend)
      ? usesLocalGraphBackend(memorySettings.backend)
        ? `backend=local_graph, ontology=${memorySettings.localGraph.ontology}, state=${memorySettings.localGraph.path}`
        : usesKuzuBackend(memorySettings.backend)
          ? `backend=kuzu, path=${join(memorySettings.project.root, ".omk", "memory", "kuzu.db")}, project=${memorySettings.project.key}`
          : `backend=${memorySettings.backend}, project=${memorySettings.project.key}`
      : t("doctor.memoryFileBackend"),
  });

  let globalPollution = false;
  if (globalKimiDirExists) {
    try {
      const fs = await import("fs/promises");
      const entries = await fs.readdir(globalKimiDir, { withFileTypes: true });
      const unexpected = entries.filter((e) => e.isFile() && !isExpectedGlobalKimiFile(e.name)).map((e) => e.name);
      if (unexpected.length > 0) globalPollution = true;
    } catch { /* ignore */ }
  }
  results.push({
    name: "Global Pollution",
    status: globalPollution ? "warn" : "ok",
    message: globalPollution ? t("doctor.globalPollution") : t("doctor.globalClean"),
  });

  return results;
}

// ── Security ──────────────────────────────────────────────────

async function securityChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const configPath = join(root, ".omk", "config.toml");
  const configExists = await pathExists(configPath);

  if (!configExists) {
    results.push({ name: "Config Audit", status: "info", message: ".omk/config.toml not found" });
    return results;
  }

  const config = await readTextFile(configPath, "");
  const warnings: string[] = [];

  if (/^\s*yolo_mode\s*=\s*true\b/m.test(config)) {
    warnings.push("yolo_mode=true");
  }

  const approvalMatch = config.match(/^approval_policy\s*=\s*"([^"]+)"/m);
  const approvalPolicy = approvalMatch?.[1]?.trim();
  if (approvalPolicy === "yolo") {
    warnings.push("approval_policy=yolo");
  }

  if (process.env.OMK_TRUST_ABSOLUTE_LOGO_PATH) {
    warnings.push("OMK_TRUST_ABSOLUTE_LOGO_PATH set");
  }

  if (/^\s*allow_write_config\s*=\s*true\b/m.test(config)) {
    warnings.push("allow_write_config=true");
  }

  if (warnings.length > 0) {
    results.push({
      name: "Dangerous Config",
      status: "warn",
      message: warnings.join(", ") + " — review security implications",
    });
  } else {
    results.push({
      name: "Dangerous Config",
      status: "ok",
      message: "no dangerous settings detected",
    });
  }

  return results;
}
