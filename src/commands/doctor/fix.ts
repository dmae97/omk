import { join, dirname, resolve } from "path";
import { chmod, copyFile, mkdir, readdir, rm, stat as fsStat, writeFile } from "fs/promises";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { runShell } from "../../util/shell.js";
import {
  pathExists,
  readTextFile,
  getUserHome,
  syncAllKimiGlobals,
  displayProjectRootPath,
  type KimiGlobalSyncReport,
  type ProjectRootResolution,
} from "../../util/fs.js";
import { MemoryStore } from "../../memory/memory-store.js";
import { OMK_CORE_VERIFIED_PRESET, OMK_RUNTIME_PRESETS } from "../../runtime/core-verified-preset.js";
import { repairMcpDoctorIssues } from "../mcp.js";
import {
  createDoctorFixPlan,
  recordDoctorFix,
  createDoctorFixReport,
  type DoctorFixReport,
  type DoctorFixContext,
  type DoctorFixLevel,
} from "./fix-plan.js";
import { defaultLspConfigJson } from "../../lsp/default-config.js";
import { repairProjectAgentPromptArgStrings } from "../../util/agent-schema.js";
import {
  type DoctorOptions,
  safeOperationId,
  readJsonValue,
  isRecord,
} from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..", "..", "..");

export function normalizeDoctorFixLevel(level: DoctorOptions["fixLevel"]): DoctorFixLevel {
  return level === "recommended" || level === "aggressive" ? level : "safe";
}

export async function applyDoctorFixes(root: string, options: DoctorOptions, rootResolution: ProjectRootResolution): Promise<DoctorFixReport> {
  const dryRun = Boolean(options.dryRun);
  const ctx: DoctorFixContext = {
    dryRun,
    fixLevel: normalizeDoctorFixLevel(options.fixLevel),
    plan: createDoctorFixPlan(dryRun),
  };
  const allowGlobalFixes = shouldRunDoctorGlobalFixes(options);

  await applyDefaultProjectRootFix(options, rootResolution, ctx);
  await repairLegacyIdentityProjectConfig(root, ctx);
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

function legacyIdentityDirName(): string {
  return `.${[112, 105].map((code) => String.fromCharCode(code)).join("")}`;
}

function normalizeLegacyIdentityRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isAllowedLegacyIdentityProjectPath(path: string): boolean {
  const normalized = normalizeLegacyIdentityRelPath(path);
  return normalized === "settings.json" || normalized === "theme.json" || /^themes\/[^/]+\.json$/i.test(normalized);
}

function isSecretBearingLegacyIdentityPath(path: string): boolean {
  const normalized = normalizeLegacyIdentityRelPath(path).toLowerCase();
  return /(?:^|\/)(?:auth|oauth|tokens?|session|credentials|service-account.*)\.json$/.test(normalized)
    || /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519)$/.test(normalized)
    || /\.(?:pem|key|p8|p12|pfx)$/i.test(normalized);
}

function containsSecretLikeMaterial(content: string): boolean {
  return /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|authorization|bearer|secret|password)\b['"]?\s*[:=]\s*['"]?[A-Za-z0-9._~+/=@:-]{12,}/i.test(content)
    || /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i.test(content);
}

async function collectLegacyIdentityProjectFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectLegacyIdentityProjectFiles(fullPath, rel));
    } else if (entry.isFile()) {
      files.push(normalizeLegacyIdentityRelPath(rel));
    }
  }
  return files;
}

async function repairLegacyIdentityProjectConfig(root: string, ctx: DoctorFixContext): Promise<void> {
  const legacyDir = join(root, legacyIdentityDirName());
  if (!(await pathExists(legacyDir))) return;
  const legacyInfo = await fsStat(legacyDir).catch(() => null);
  if (!legacyInfo?.isDirectory()) {
    recordDoctorFix(ctx, {
      id: "legacy-identity-storage-not-directory",
      category: "legacy-identity",
      severity: "warn",
      status: "skipped",
      before: legacyIdentityDirName(),
      after: ".omk",
      reason: "legacy local runtime path exists but is not a directory; manual cleanup required",
      verifyCheck: "OMK Scaffold",
    });
    return;
  }

  const files = await collectLegacyIdentityProjectFiles(legacyDir);
  const imported: string[] = [];
  const duplicates: string[] = [];
  const conflictBackups: string[] = [];
  const skipped: string[] = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (const relPath of files) {
    const sourcePath = join(legacyDir, relPath);
    if (isSecretBearingLegacyIdentityPath(relPath) || !isAllowedLegacyIdentityProjectPath(relPath)) {
      skipped.push(relPath);
      continue;
    }
    const sourceText = await readTextFile(sourcePath, "");
    if (containsSecretLikeMaterial(sourceText)) {
      skipped.push(relPath);
      continue;
    }

    const destPath = join(root, ".omk", relPath);
    const destExists = await pathExists(destPath);
    const destText = destExists ? await readTextFile(destPath, "") : "";
    if (destExists && destText === sourceText) {
      duplicates.push(relPath);
      continue;
    }

    if (ctx.dryRun) {
      imported.push(relPath);
      continue;
    }

    await mkdir(dirname(destPath), { recursive: true });
    if (destExists) {
      const backupPath = `${destPath}.legacy-${timestamp}`;
      await copyFile(sourcePath, backupPath);
      conflictBackups.push(backupPath);
      if (!ctx.plan.backups.includes(backupPath)) ctx.plan.backups.push(backupPath);
    } else {
      await copyFile(sourcePath, destPath);
      imported.push(relPath);
    }
  }

  if (skipped.length > 0) {
    recordDoctorFix(ctx, {
      id: "legacy-identity-storage-skipped",
      category: "legacy-identity",
      severity: "warn",
      status: "blocked",
      before: { files },
      after: { imported, duplicates, conflictBackups },
      reason: `legacy local runtime import skipped secret-bearing or unsupported files: ${skipped.join(", ")}`,
      verifyCheck: "OMK Scaffold",
    });
    return;
  }

  if (!ctx.dryRun) {
    await rm(legacyDir, { recursive: true, force: true });
  }
  recordDoctorFix(ctx, {
    id: "legacy-identity-storage-import",
    category: "legacy-identity",
    before: { legacyDir: legacyIdentityDirName(), files },
    after: { canonicalDir: ".omk", imported, duplicates, conflictBackups, removedLegacyDir: !ctx.dryRun },
    reason: `${ctx.dryRun ? "would import" : "imported"} legacy local runtime settings into .omk and ${ctx.dryRun ? "would remove" : "removed"} the legacy project directory`,
    verifyCheck: "OMK Scaffold",
  });
}

async function repairRuntimePresetFiles(root: string, ctx: DoctorFixContext): Promise<void> {
  const runtimePresetPath = join(root, ".omk", "runtime-preset.json");
  const runtimePresetsPath = join(root, ".omk", "runtime-presets.json");
  const desiredPreset = OMK_CORE_VERIFIED_PRESET;
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
    defaultPresetId: OMK_CORE_VERIFIED_PRESET.id,
    presets: OMK_RUNTIME_PRESETS,
  };
  if (isRecord(currentPresets.value)) {
    const desiredIds = new Set<string>(OMK_RUNTIME_PRESETS.map((preset) => preset.id));
    const extras = Array.isArray(currentPresets.value.presets)
      ? currentPresets.value.presets.filter((preset) => isRecord(preset) && typeof preset.id === "string" && !desiredIds.has(preset.id))
      : [];
    nextPresets = {
      ...currentPresets.value,
      defaultPresetId: OMK_CORE_VERIFIED_PRESET.id,
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
      after: { defaultPresetId: OMK_CORE_VERIFIED_PRESET.id },
      reason: `${ctx.dryRun ? "would repair" : "repaired"} .omk/runtime-presets.json defaultPresetId to ${OMK_CORE_VERIFIED_PRESET.id}`,
      verifyCheck: "OMK Runtime",
    });
  }
}

const DEFAULT_SAFE_CONFIG_TOML = `# open-multi-agent-kit project settings
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
      if (/^\s*\[[^\]]+]]\s*$/.test(lines[next])) {
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
  const valid = parsed?.enabled === true
    && isRecord(parsed.servers)
    && isRecord(parsed.servers.typescript)
    && isRecord(parsed.servers.python);
  if (valid) return;
  if (!ctx.dryRun) {
    await mkdir(dirname(lspConfigPath), { recursive: true });
    await writeFile(lspConfigPath, defaultLspConfigJson(), "utf-8");
  }
  recordDoctorFix(ctx, {
    id: "lsp-config",
    category: "scaffold",
    before: current.exists ? current.value ?? "invalid JSON" : "missing",
    after: "default TypeScript/Python LSP config",
    reason: `${ctx.dryRun ? "would restore" : "restored"} .omk/lsp.json default TypeScript/Python LSP config`,
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
