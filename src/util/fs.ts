import {
  mkdir,
  writeFile,
  readFile,
  access,
  constants,
  readdir,
  symlink,
  rm,
  unlink,
  lstat,
  copyFile,
} from "fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { GLOBAL_MEMORY_CONFIG_TOML, getGlobalMemoryConfigPath } from "../memory/memory-config.js";
import { SyncManifestEntry, sha256, simpleDiff } from "./sync-manifest.js";
import { getOmkResourceSettings, type OmkRuntimeScope } from "./resource-profile.js";
import { getKimiCapabilities } from "../kimi/capability.js";
import { resolveRuntimeProfile, buildProfileArgs } from "./runtime-profile.js";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeFileSafe(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf-8");
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isGlobalWriteAllowed(): boolean {
  return process.env.OMK_MCP_ALLOW_WRITE_CONFIG === "1";
}

function shouldRewriteMcpArgPath(server: Record<string, unknown>, arg: unknown, index: number): arg is string {
  if (typeof arg !== "string") return false;
  if (arg.startsWith("/") || arg.startsWith("http") || arg.startsWith("-")) return false;
  if (isShellInlineMcpArg(server, index)) return false;
  if (/[\s;"'|&<>]/.test(arg)) return false;
  return true;
}

function isShellInlineMcpArg(server: Record<string, unknown>, index: number): boolean {
  const command = typeof server.command === "string" ? server.command : "";
  const commandName = command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
  if (!["bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd", "cmd.exe"].includes(commandName)) {
    return false;
  }
  const args = Array.isArray(server.args) ? server.args : [];
  const previous = args[index - 1];
  return previous === "-c" || previous === "-lc" || previous === "/c" || previous === "--command";
}

export function getManifestPath(): string {
  return getOmkPath("sync-manifest.json");
}

export function getBackupDir(timestamp: string): string {
  return getOmkPath(join("sync-backups", timestamp));
}

export async function readManifest(): Promise<SyncManifestEntry[]> {
  const path = getManifestPath();
  if (!(await pathExists(path))) return [];
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as SyncManifestEntry[];
  } catch {
    // ignore invalid manifest
  }
  return [];
}

export async function writeManifest(entries: SyncManifestEntry[]): Promise<void> {
  const path = getManifestPath();
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(entries, null, 2) + "\n", "utf-8");
}

export async function backupFile(sourcePath: string, backupDir: string, relativePath: string): Promise<string> {
  const dest = join(backupDir, relativePath);
  await ensureDir(dirname(dest));
  await copyFile(sourcePath, dest);
  return dest;
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(path: string, defaultValue = ""): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return defaultValue;
  }
}

export function getProjectRoot(): string {
  if (process.env.OMK_PROJECT_ROOT) return resolve(process.env.OMK_PROJECT_ROOT);
  // Git 저장소 루트를 우선 찾고, 실패 시 cwd 폴백
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    if (gitRoot) return gitRoot;
  } catch {
    // ignore — git 없거나非저장소
  }
  return process.cwd();
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
} from "./run-store.js";

export function getKimiConfigPath(): string {
  return join(getUserHome(), ".kimi", "config.toml");
}

const OMK_START_MARKER = "# >>> omk managed hooks — do not edit manually";
const OMK_END_MARKER = "# >>> end omk managed hooks";

/**
 * .omk/kimi.config.toml 의 hooks 를 ~/.kimi/config.toml 에 병합.
 * 상대 경로를 절대 경로로 변환하여 어디서 실행돼도 작동하도록 함.
 */
export async function mergeKimiHooks(
  omkConfigPath: string,
  options: { dryRun?: boolean; diff?: boolean; manifest?: SyncManifestEntry[]; timestamp?: string } = {}
): Promise<boolean> {
  const manifest = options.manifest ?? [];
  const timestamp = options.timestamp ?? new Date().toISOString();
  const kimiConfigPath = getKimiConfigPath();
  const omkContent = await readTextFile(omkConfigPath, "");
  if (!omkContent.trim()) return false;

  const root = getProjectRoot();
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
    console.warn(`⚠️  Skipping global write to ${kimiConfigPath} (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to allow)`);
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

function extractHooksBlocks(content: string): string {
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
  options: { dryRun?: boolean; diff?: boolean; manifest?: SyncManifestEntry[]; timestamp?: string } = {}
): Promise<boolean> {
  const manifest = options.manifest ?? [];
  const timestamp = options.timestamp ?? new Date().toISOString();
  const globalMcpPath = join(getUserHome(), ".kimi", "mcp.json");
  const projectConfigs = [getOmkPath("mcp.json"), join(getProjectRoot(), ".kimi", "mcp.json")];

  const mergedServers: Record<string, unknown> = {};
  let hasAny = false;

  for (const p of projectConfigs) {
    if (!(await pathExists(p))) continue;
    try {
      const content = await readTextFile(p, "{}");
      const parsed = JSON.parse(content);
      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        const root = getProjectRoot();
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
    console.warn(`⚠️  Skipping global write to ${globalMcpPath} (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to allow)`);
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
  options: { dryRun?: boolean; manifest?: SyncManifestEntry[]; timestamp?: string } = {}
): Promise<boolean> {
  const projectSkillsDir = join(getProjectRoot(), ".kimi", "skills");
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
    console.warn(`⚠️  Skipping global skills sync to ${globalSkillsDir} (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to allow)`);
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
  options: { dryRun?: boolean; diff?: boolean; manifest?: SyncManifestEntry[]; timestamp?: string } = {}
): Promise<boolean> {
  const manifest = options.manifest ?? [];
  const timestamp = options.timestamp ?? new Date().toISOString();
  const memoryPath = getGlobalMemoryConfigPath();
  const previousContent = await readTextFile(memoryPath, "");
  const newContent = GLOBAL_MEMORY_CONFIG_TOML;

  if (previousContent === newContent) return false;

  if (!isGlobalWriteAllowed()) {
    console.warn(`⚠️  Skipping global write to ${memoryPath} (set OMK_MCP_ALLOW_WRITE_CONFIG=1 to allow)`);
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
  options: { dryRun?: boolean; diff?: boolean; manifest?: SyncManifestEntry[]; timestamp?: string } = {}
): Promise<void> {
  const configFile = getOmkPath("kimi.config.toml");
  if (await pathExists(configFile)) {
    try {
      await mergeKimiHooks(configFile, options);
    } catch (err) {
      console.warn("⚠️  hooks sync failed:", (err as Error).message);
    }
  }

  try {
    await syncKimiMcpGlobal(options);
  } catch (err) {
    console.warn("⚠️  MCP global sync failed:", (err as Error).message);
  }

  try {
    await syncKimiSkillsGlobal(options);
  } catch (err) {
    console.warn("⚠️  skills global sync failed:", (err as Error).message);
  }

  try {
    await syncKimiMemoryGlobal(options);
  } catch (err) {
    console.warn("⚠️  local graph memory global sync failed:", (err as Error).message);
  }
}

/** Canonical .kimi/mcp.json + optional ~/.kimi/mcp.json 수집 */
export async function collectMcpConfigs(scope: OmkRuntimeScope = "project"): Promise<string[]> {
  const configs: string[] = [];
  if (scope === "none") return configs;

  const root = getProjectRoot();
  const omkMcp = join(root, ".omk", "mcp.json");
  const kimiMcp = join(root, ".kimi", "mcp.json");
  const globalMcp = join(getUserHome(), ".kimi", "mcp.json");

  if (scope === "all") {
    if (await pathExists(globalMcp)) configs.push(globalMcp);
  }

  const [kimiMcpExists, omkMcpExists] = await Promise.all([
    pathExists(kimiMcp),
    pathExists(omkMcp),
  ]);
  // .kimi/mcp.json is the Kimi-native source of truth. .omk/mcp.json remains
  // a legacy fallback for older projects that have not rerun `omk init`.
  if (kimiMcpExists) configs.push(kimiMcp);
  else if (omkMcpExists) configs.push(omkMcp);

  return [...new Set(configs)];
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

const MAX_LOGO_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_LOGO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** .omk/config.toml 에서 안전한 logo_image 경로 읽기 (상대경로는 프로젝트 루트 기준) */
export async function getOmkLogoImagePath(): Promise<string | null> {
  const configPath = getOmkPath("config.toml");
  try {
    const content = await readTextFile(configPath, "");
    const match = content.match(/^\s*logo_image\s*=\s*["']([^"']+)["']/m);
    if (!match) return null;
    const p = match[1].trim();
    const root = getProjectRoot();
    const absoluteInput = isAbsolute(p) || p.startsWith("\\") || /^[A-Za-z]:/.test(p);
    if (absoluteInput && !isTrustedLocalFlag(process.env.OMK_TRUST_ABSOLUTE_LOGO_PATH)) {
      return null;
    }
    const candidate = absoluteInput ? resolve(p) : resolve(root, p);
    if (!absoluteInput && isOutsideRoot(root, candidate)) {
      return null;
    }
    return await isSafeLogoImage(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function isTrustedLocalFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function isOutsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith(`..${"\\"}`) || isAbsolute(rel);
}

async function isSafeLogoImage(path: string): Promise<boolean> {
  const ext = extname(path).toLowerCase();
  if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) return false;

  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_LOGO_IMAGE_BYTES) {
    return false;
  }

  const bytes = await readFile(path);
  return hasAllowedImageMagic(bytes);
}

function hasAllowedImageMagic(bytes: Uint8Array): boolean {
  return isPng(bytes) || isJpeg(bytes) || isGif(bytes) || isWebp(bytes);
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const header = String.fromCharCode(...bytes.slice(0, 6));
  return header === "GIF87a" || header === "GIF89a";
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  return riff === "RIFF" && webp === "WEBP";
}

/** Kimi CLI 실행 인자에 model + MCP + Skills 주입 (전역 동기화는 별도) */
export async function injectKimiGlobals(
  args: string[],
  options: { mcpScope?: OmkRuntimeScope; skillsScope?: OmkRuntimeScope; role?: string } = {}
): Promise<void> {
  const resources = await getOmkResourceSettings();
  const mcpScope = options.mcpScope ?? resources.mcpScope;
  const skillsScope = options.skillsScope ?? resources.skillsScope;

  // Resolve role-based runtime profile and inject supported flags
  let injectedModel: string | undefined;
  if (options.role) {
    const profile = await resolveRuntimeProfile(options.role);
    const caps = getKimiCapabilities();
    const profileArgs = buildProfileArgs(profile, caps);
    args.push(...profileArgs);
    injectedModel = profile.model;

    // maxOutputMb is not a native CLI flag; map to env hint if present
    if (profile.maxOutputMb !== undefined && !process.env.OMK_MAX_OUTPUT_MB) {
      // Handled downstream by resource-profile.ts / shell runners
    }
  }

  // default_model이 있으면 주입 (agent-file 사용 시 model이 unset 될 수 있음)
  // Profile model takes precedence; skip duplicate injection.
  if (!injectedModel) {
    const defaultModel = await getKimiDefaultModel();
    if (defaultModel) {
      args.push("--model", defaultModel);
    }
  }

  for (const mcp of await collectMcpConfigs(mcpScope)) {
    args.push("--mcp-config-file", mcp);
  }

  const globalSkillsDir = join(getUserHome(), ".kimi", "skills");
  const projectSkillsDir = getKimiSkillsDir();
  const [globalSkillsExists, projectSkillsExists] = await Promise.all([
    skillsScope === "all" ? pathExists(globalSkillsDir) : Promise.resolve(false),
    skillsScope !== "none" ? pathExists(projectSkillsDir) : Promise.resolve(false),
  ]);
  if (globalSkillsExists) args.push("--skills-dir", globalSkillsDir);
  if (projectSkillsExists) args.push("--skills-dir", projectSkillsDir);

  if (process.env.OMK_DEBUG === "1") {
    const mcpFiles = await collectMcpConfigs(mcpScope);
    const skillDirs: string[] = [];
    if (globalSkillsExists) skillDirs.push(globalSkillsDir);
    if (projectSkillsExists) skillDirs.push(projectSkillsDir);
    const modelIdx = args.indexOf("--model");
    const effectiveModel = modelIdx >= 0 ? args[modelIdx + 1] : null;
    console.error("[OMK_DEBUG] injectKimiGlobals:", {
      role: options.role ?? null,
      model: effectiveModel,
      mcpFiles,
      skillDirs,
      mcpScope,
      skillsScope,
    });
  }
}
