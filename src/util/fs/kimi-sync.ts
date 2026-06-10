import {
  access,
  constants,
  readdir,
  symlink,
  rm,
  unlink,
  lstat,
  copyFile,
} from "fs/promises";
import { join, relative, resolve } from "path";
import { GLOBAL_MEMORY_CONFIG_TOML, getGlobalMemoryConfigPath } from "../../memory/memory-config.js";
import { SyncManifestEntry, sha256, simpleDiff } from "../sync-manifest.js";
import { ensureDir, pathExists, readTextFile, writeFileSafe } from "./core.js";
import { getKimiConfigPath, getOmkPath, getProjectRootAsync, getUserHome } from "./paths.js";
import { backupFile, getBackupDir } from "./manifest.js";
import { isShellInlineMcpArg, PACKAGE_MANAGER_COMMANDS } from "./internal.js";

type KimiGlobalSyncStepName = "hooks" | "mcp" | "skills" | "memory";

export interface KimiGlobalSyncOptions {
  dryRun?: boolean;
  diff?: boolean;
  quiet?: boolean;
  manifest?: SyncManifestEntry[];
  timestamp?: string;
}

export interface KimiGlobalSyncStepReport {
  name: KimiGlobalSyncStepName;
  changed: boolean;
  blocked: boolean;
  skipped: boolean;
  error?: string;
  manifest: SyncManifestEntry[];
}

export interface KimiGlobalSyncReport {
  changed: boolean;
  blocked: boolean;
  steps: KimiGlobalSyncStepReport[];
  actions: string[];
  skipped: string[];
  errors: string[];
  manifest: SyncManifestEntry[];
}

function isGlobalWriteAllowed(): boolean {
  return /^(?:1|true|yes|on)$/i.test(process.env.OMK_MCP_ALLOW_WRITE_CONFIG ?? "");
}

function shouldRewriteMcpArgPath(server: Record<string, unknown>, arg: unknown, index: number): arg is string {
  if (typeof arg !== "string") return false;
  if (arg.startsWith("/") || arg.startsWith("http") || arg.startsWith("-")) return false;
  if (isShellInlineMcpArg(server, index)) return false;
  if (/[\s;"'|&<>]/.test(arg)) return false;
  if (isPackageManagerMcpServer(server) && isNpmPackageSpecifierArg(arg)) return false;
  return isExplicitRelativeMcpPathArg(arg, server, index);
}

function isPackageManagerMcpServer(server: Record<string, unknown>): boolean {
  const command = typeof server.command === "string" ? server.command : "";
  const commandName = command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
  return PACKAGE_MANAGER_COMMANDS.has(commandName);
}

function isNpmPackageSpecifierArg(arg: string): boolean {
  if (arg.startsWith(".") || arg.startsWith("/") || arg.includes("\\") || arg.includes(":")) return false;
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9._~+-]+)?$/i.test(arg);
}

function isExplicitRelativeMcpPathArg(arg: string, server: Record<string, unknown>, index: number): boolean {
  const args = Array.isArray(server.args) ? server.args : [];
  const previous = args[index - 1];
  if (typeof previous === "string" && /^(?:--?(?:config|file|path|root|dir|directory|cwd|database|db|schema|mount|workspace)|--(?:config|file|path|root|dir|directory|cwd|database|db|schema|mount|workspace)=)$/i.test(previous)) {
    return true;
  }
  if (arg.startsWith("./") || arg.startsWith("../")) return true;
  if (arg.includes("/") || arg.includes("\\")) return true;
  return /\.(?:[cm]?[jt]s|json|toml|ya?ml|py|sh|db|sqlite3?|wasm|bin)$/i.test(arg);
}

const OMK_START_MARKER = "# >>> omk managed hooks — do not edit manually";
const OMK_END_MARKER = "# >>> end omk managed hooks";

/**
 * .omk/kimi.config.toml 의 hooks 를 ~/.kimi/config.toml 에 병합.
 * 상대 경로를 절대 경로로 변환하여 어디서 실행돼도 작동하도록 함.
 */
export async function mergeKimiHooks(
  omkConfigPath: string,
  options: KimiGlobalSyncOptions = {}
): Promise<boolean> {
  const manifest = options.manifest ?? [];
  const timestamp = options.timestamp ?? new Date().toISOString();
  const kimiConfigPath = getKimiConfigPath();
  const omkContent = await readTextFile(omkConfigPath, "");
  if (!omkContent.trim()) return false;

  const root = await getProjectRootAsync();
  const resolvedContent = resolveHookPaths(omkContent, root);

  const hooksContent = extractHooksBlocks(resolvedContent);
  if (!hooksContent) return false;

  let kimiContent = await readTextFile(kimiConfigPath, "");
  const previousContent = kimiContent;

  // 기존 omk 섹션 제거
  const startIdx = kimiContent.indexOf(OMK_START_MARKER);
  if (startIdx !== -1) {
    const endIdx = kimiContent.indexOf(OMK_END_MARKER, startIdx);
    if (endIdx !== -1) {
      const before = kimiContent.slice(0, startIdx).trimEnd();
      const after = kimiContent.slice(endIdx + OMK_END_MARKER.length).trimStart();
      kimiContent = before + (before && after ? "\n\n" : before ? "\n" : "") + after;
    }
  }

  const omkSection = `${OMK_START_MARKER}\n${hooksContent}\n${OMK_END_MARKER}\n`;

  if (!kimiContent.trim()) {
    kimiContent = omkSection;
  } else {
    kimiContent = kimiContent.trimEnd() + "\n\n" + omkSection;
  }

  if (previousContent === kimiContent) return false;

  if (!isGlobalWriteAllowed()) {
    if (!options.quiet) {
      console.warn(`⚠️  Skipping global write to ${kimiConfigPath} (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to allow)`);
    }
    manifest.push({
      path: kimiConfigPath,
      scope: "global",
      action: "blocked",
      previousHash: previousContent.trim() ? sha256(previousContent) : null,
      newHash: sha256(kimiContent),
      backupPath: null,
      timestamp,
    });
    return true;
  }

  if (options.diff && previousContent.trim()) {
    console.log(`--- ${kimiConfigPath}`);
    console.log(`+++ ${kimiConfigPath}`);
    console.log(simpleDiff(previousContent, kimiContent));
  }

  if (!options.dryRun) {
    let backupPath: string | null = null;
    if (await pathExists(kimiConfigPath)) {
      const backupDir = getBackupDir(timestamp);
      backupPath = await backupFile(kimiConfigPath, backupDir, relative(getUserHome(), kimiConfigPath));
    }
    await writeFileSafe(kimiConfigPath, kimiContent);
    manifest.push({
      path: kimiConfigPath,
      scope: "global",
      action: previousContent.trim() ? "update" : "create",
      previousHash: previousContent.trim() ? sha256(previousContent) : null,
      newHash: sha256(kimiContent),
      backupPath,
      timestamp,
    });
  } else {
    manifest.push({
      path: kimiConfigPath,
      scope: "global",
      action: previousContent.trim() ? "update" : "create",
      previousHash: previousContent.trim() ? sha256(previousContent) : null,
      newHash: sha256(kimiContent),
      backupPath: null,
      timestamp,
    });
  }

  return true;
}

function resolveHookPaths(content: string, root: string): string {
  return content.replace(
    /command\s*=\s*["'](\.omk\/hooks\/[^"']+)["']/g,
    (_match, p1) => {
      const absPath = join(root, p1).replace(/\\/g, "/");
      return `command = "${absPath}"`;
    }
  );
}

export function extractHooksBlocks(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let foundHooks = false;
  for (const line of lines) {
    if (line.trim().startsWith("[[hooks]]")) foundHooks = true;
    if (foundHooks) result.push(line);
  }
  return result.join("\n").trim();
}

/* ──────────────────────────────────────────────
 *  Global sync: .kimi/  →  ~/.kimi/
 * ────────────────────────────────────────────── */

/** 프로젝트의 .omk/mcp.json + .kimi/mcp.json → ~/.kimi/mcp.json 병합 */
export async function syncKimiMcpGlobal(
  options: KimiGlobalSyncOptions = {}
): Promise<boolean> {
  const manifest = options.manifest ?? [];
  const timestamp = options.timestamp ?? new Date().toISOString();
  const globalMcpPath = join(getUserHome(), ".kimi", "mcp.json");
  const root = await getProjectRootAsync();
  const projectConfigs = [join(root, ".omk", "mcp.json"), join(root, ".kimi", "mcp.json")];

  const mergedServers: Record<string, unknown> = {};
  let hasAny = false;

  for (const p of projectConfigs) {
    if (!(await pathExists(p))) continue;
    try {
      const content = await readTextFile(p, "{}");
      const parsed = JSON.parse(content);
      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        const root = await getProjectRootAsync();
        for (const [name, server] of Object.entries(parsed.mcpServers)) {
          const s = server as Record<string, unknown>;
          // args의 상대 경로를 MCP 설정 파일 기준 절대 경로로 변환.
          // Shell snippets such as `set -a; source ...; exec npx ...` must
          // remain untouched or MCP configs become broken Windows/WSL paths.
          if (Array.isArray(s.args)) {
            s.args = s.args.map((arg: unknown, index: number) => {
              if (shouldRewriteMcpArgPath(s, arg, index)) {
                return join(root, arg);
              }
              return arg;
            });
          }
          mergedServers[name] = s;
        }
        hasAny = true;
      }
    } catch {
      // ignore invalid JSON
    }
  }

  if (!hasAny) return false;

  // 기존 글로벌 mcp.json 읽기
  let globalParsed: { mcpServers?: Record<string, unknown> } = {};
  let previousContent = "";
  if (await pathExists(globalMcpPath)) {
    try {
      previousContent = await readTextFile(globalMcpPath, "{}");
      globalParsed = JSON.parse(previousContent);
    } catch {
      // ignore
    }
  }

  // 병합: 글로벌 먼저, 프로젝트가 같은 키 덮어씀
  const finalServers = { ...(globalParsed.mcpServers ?? {}), ...mergedServers };
  const newContent = JSON.stringify({ mcpServers: finalServers }, null, 2) + "\n";

  if (previousContent === newContent) return false;

  if (!isGlobalWriteAllowed()) {
    if (!options.quiet) {
      console.warn(`⚠️  Skipping global write to ${globalMcpPath} (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to allow)`);
    }
    manifest.push({
      path: globalMcpPath,
      scope: "global",
      action: "blocked",
      previousHash: previousContent ? sha256(previousContent) : null,
      newHash: sha256(newContent),
      backupPath: null,
      timestamp,
    });
    return true;
  }

  if (options.diff && previousContent) {
    console.log(`--- ${globalMcpPath}`);
    console.log(`+++ ${globalMcpPath}`);
    console.log(simpleDiff(previousContent, newContent));
  }

  if (!options.dryRun) {
    let backupPath: string | null = null;
    if (await pathExists(globalMcpPath)) {
      const backupDir = getBackupDir(timestamp);
      backupPath = await backupFile(globalMcpPath, backupDir, relative(getUserHome(), globalMcpPath));
    }
    await writeFileSafe(globalMcpPath, newContent);
    manifest.push({
      path: globalMcpPath,
      scope: "global",
      action: previousContent ? "update" : "create",
      previousHash: previousContent ? sha256(previousContent) : null,
      newHash: sha256(newContent),
      backupPath,
      timestamp,
    });
  } else {
    manifest.push({
      path: globalMcpPath,
      scope: "global",
      action: previousContent ? "update" : "create",
      previousHash: previousContent ? sha256(previousContent) : null,
      newHash: sha256(newContent),
      backupPath: null,
      timestamp,
    });
  }

  return true;
}

/** 프로젝트의 .kimi/skills/* → ~/.kimi/skills/ 심링크 */
export async function syncKimiSkillsGlobal(
  options: KimiGlobalSyncOptions = {}
): Promise<boolean> {
  const root = await getProjectRootAsync();
  const projectSkillsDir = join(root, ".kimi", "skills");
  const globalSkillsDir = join(getUserHome(), ".kimi", "skills");

  if (!(await pathExists(projectSkillsDir))) return false;

  const entries = await readdir(projectSkillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((e) => e.isDirectory());
  if (skillDirs.length === 0) return false;

  if (options.dryRun) {
    for (const dir of skillDirs) {
      options.manifest?.push({
        path: join(globalSkillsDir, dir.name),
        scope: "global",
        action: "symlink",
        previousHash: null,
        newHash: null,
        backupPath: null,
        timestamp: options.timestamp ?? new Date().toISOString(),
      });
    }
    return true;
  }

  if (!isGlobalWriteAllowed()) {
    if (!options.quiet) {
      console.warn(`⚠️  Skipping global skills sync to ${globalSkillsDir} (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to allow)`);
    }
    for (const dir of skillDirs) {
      options.manifest?.push({
        path: join(globalSkillsDir, dir.name),
        scope: "global",
        action: "blocked",
        previousHash: null,
        newHash: null,
        backupPath: null,
        timestamp: options.timestamp ?? new Date().toISOString(),
      });
    }
    return true;
  }

  await ensureDir(globalSkillsDir);

  // 깨진 심링크 정리
  try {
    const globalEntries = await readdir(globalSkillsDir, { withFileTypes: true });
    for (const e of globalEntries) {
      if (!e.isSymbolicLink()) continue;
      const linkPath = join(globalSkillsDir, e.name);
      try {
        await access(linkPath, constants.F_OK);
      } catch {
        await unlink(linkPath);
      }
    }
  } catch {
    // ignore
  }

  for (const dir of skillDirs) {
    const src = resolve(join(projectSkillsDir, dir.name));
    const dest = join(globalSkillsDir, dir.name);

    // 사용자가 직접 설치한 폴더(심링크 아님)는 건드리지 않음
    try {
      const destStat = await lstat(dest);
      if (!destStat.isSymbolicLink()) continue;
      await unlink(dest);
    } catch {
      // dest 없음 → OK
    }

    try {
      await symlink(src, dest, "dir");
    } catch {
      // 심링크 실패 시 복사 fallback — dest 가 실제 사용자 디렉토리가 아닌지 재확인
      try {
        const st = await lstat(dest);
        if (!st.isSymbolicLink()) continue; // 사용자 데이터 보호
        await rm(dest, { recursive: true, force: true });
      } catch {
        // dest 없음 → 복사만 진행
      }
      await copyDir(src, dest);
    }
  }

  return true;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/** local graph memory policy를 ~/.kimi/omk.memory.toml 에 동기화 */
export async function syncKimiMemoryGlobal(
  options: KimiGlobalSyncOptions = {}
): Promise<boolean> {
  const manifest = options.manifest ?? [];
  const timestamp = options.timestamp ?? new Date().toISOString();
  const memoryPath = getGlobalMemoryConfigPath();
  const previousContent = await readTextFile(memoryPath, "");
  const newContent = GLOBAL_MEMORY_CONFIG_TOML;

  if (previousContent === newContent) return false;

  if (!isGlobalWriteAllowed()) {
    if (!options.quiet) {
      console.warn(`⚠️  Skipping global write to ${memoryPath} (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to allow)`);
    }
    manifest.push({
      path: memoryPath,
      scope: "global",
      action: "blocked",
      previousHash: previousContent.trim() ? sha256(previousContent) : null,
      newHash: sha256(newContent),
      backupPath: null,
      timestamp,
    });
    return true;
  }

  if (options.diff && previousContent.trim()) {
    console.log(`--- ${memoryPath}`);
    console.log(`+++ ${memoryPath}`);
    console.log(simpleDiff(previousContent, newContent));
  }

  if (!options.dryRun) {
    let backupPath: string | null = null;
    if (await pathExists(memoryPath)) {
      const backupDir = getBackupDir(timestamp);
      backupPath = await backupFile(memoryPath, backupDir, relative(getUserHome(), memoryPath));
    }
    await writeFileSafe(memoryPath, newContent);
    manifest.push({
      path: memoryPath,
      scope: "global",
      action: previousContent.trim() ? "update" : "create",
      previousHash: previousContent.trim() ? sha256(previousContent) : null,
      newHash: sha256(newContent),
      backupPath,
      timestamp,
    });
  } else {
    manifest.push({
      path: memoryPath,
      scope: "global",
      action: previousContent.trim() ? "update" : "create",
      previousHash: previousContent.trim() ? sha256(previousContent) : null,
      newHash: sha256(newContent),
      backupPath: null,
      timestamp,
    });
  }

  return true;
}

/** Sync hooks + MCP + skills to ~/.kimi/ at once */
export async function syncAllKimiGlobals(
  options: KimiGlobalSyncOptions = {}
): Promise<KimiGlobalSyncReport> {
  const manifest = options.manifest ?? [];
  const steps: KimiGlobalSyncStepReport[] = [];
  const actions: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  async function runStep(name: KimiGlobalSyncStepName, fn: () => Promise<boolean>): Promise<void> {
    const before = manifest.length;
    try {
      const changed = await fn();
      const stepManifest = manifest.slice(before);
      const blockedEntries = stepManifest.filter((entry) => entry.action === "blocked");
      const blocked = blockedEntries.length > 0;
      const step: KimiGlobalSyncStepReport = {
        name,
        changed: changed && !blocked,
        blocked,
        skipped: !changed,
        manifest: stepManifest,
      };
      steps.push(step);
      if (blocked) {
        skipped.push(`${name}: global write blocked for ${blockedEntries.map((entry) => entry.path).join(", ")}`);
      } else if (changed) {
        actions.push(`${name}: synced`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!options.quiet) {
        console.warn(`⚠️  ${name} global sync failed:`, message);
      }
      errors.push(`${name}: ${message}`);
      steps.push({
        name,
        changed: false,
        blocked: false,
        skipped: true,
        error: message,
        manifest: manifest.slice(before),
      });
    }
  }

  const configFile = getOmkPath("kimi.config.toml");
  if (await pathExists(configFile)) {
    await runStep("hooks", () => mergeKimiHooks(configFile, { ...options, manifest }));
  } else {
    steps.push({ name: "hooks", changed: false, blocked: false, skipped: true, manifest: [] });
  }

  await runStep("mcp", () => syncKimiMcpGlobal({ ...options, manifest }));
  await runStep("skills", () => syncKimiSkillsGlobal({ ...options, manifest }));
  await runStep("memory", () => syncKimiMemoryGlobal({ ...options, manifest }));

  return {
    changed: actions.length > 0,
    blocked: steps.some((step) => step.blocked),
    steps,
    actions,
    skipped,
    errors,
    manifest,
  };
}
