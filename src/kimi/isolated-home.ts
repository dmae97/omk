import { lstat, mkdtemp, mkdir, symlink, rm, writeFile, readFile } from "fs/promises";
import { dirname, isAbsolute, join } from "path";
import { tmpdir } from "os";
import { pathExists, getProjectRoot, getUserHome, extractHooksBlocks, getRunPath, sanitizeRunId } from "../util/fs.js";

type RuntimeScope = "all" | "project" | "none";

export interface IsolatedKimiHomeOptions {
  originalHome?: string;
  projectRoot?: string;
  inheritLocalAuth?: boolean;
  skillsScope?: RuntimeScope;
  hooksScope?: RuntimeScope;
  persistentHome?: boolean;
  homeLabel?: string;
  env?: NodeJS.ProcessEnv;
}

export interface IsolatedKimiHomeCleanupOptions {
  preserve?: boolean;
  reason?: string;
}

export interface IsolatedKimiHomeCleanupResult {
  path: string;
  removed: boolean;
  retained: boolean;
  markerPath?: string;
}

const KIMI_BASE_INHERITED_DIRS = ["credentials", "agents", "logs"] as const;

/**
 * Local agent/OMK auth paths that should remain visible when OMK gives Kimi a
 * sanitized temporary HOME. Keep this default intentionally narrow for public
 * installs: broad OS/cloud credentials require explicit trusted-local opt-in.
 */
const DEFAULT_LOCAL_TERMINAL_AUTH_PATHS = [
  ".codex",
  ".opencode",
  ".claude",
  ".gemini",
  ".railway",
  ".config/gh",
  ".config/omk",
  ".config/github-copilot",
  ".config/railway",
] as const;

const TRUSTED_LOCAL_TERMINAL_AUTH_PATHS = [
  ...DEFAULT_LOCAL_TERMINAL_AUTH_PATHS,
  ".ssh",
  ".aws",
  ".azure",
  ".docker",
  ".kube",
  ".gnupg",
  ".config/gcloud",
  ".config/vercel",
  ".config/netlify",
  ".config/heroku",
  ".config/hub",
  ".gitconfig",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".yarnrc",
  ".yarnrc.yml",
] as const;

/**
 * Create a temporary HOME directory while preserving Kimi auth and local agent
 * credentials. MCP configs are intentionally *not* synthesized inside this
 * temporary HOME: OMK runtime passes explicit --mcp-config-file arguments that
 * point at the real project .kimi/mcp.json and, for all-scope runs, the real
 * user ~/.kimi/mcp.json through OMK_ORIGINAL_HOME. This keeps Kimi from
 * reporting or depending on disposable /tmp MCP config paths.
 */
export async function prepareIsolatedKimiHome(options: IsolatedKimiHomeOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const originalHome = options.originalHome ?? resolveOriginalHome(env);
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const tmpHome = await resolveIsolatedKimiHomePath({
    projectRoot,
    env,
    persistentHome: options.persistentHome,
    homeLabel: options.homeLabel,
  });
  const originalKimi = join(originalHome, ".kimi");
  const tmpKimi = join(tmpHome, ".kimi");
  const skillsScope = normalizeRuntimeScope(options.skillsScope ?? env.OMK_SKILLS_SCOPE, "project");
  const hooksScope = normalizeRuntimeScope(options.hooksScope ?? env.OMK_HOOKS_SCOPE, "project");
  await mkdir(tmpKimi, { recursive: true });

  // Symlink only scoped global directories. Skills/hooks are intentionally not
  // inherited for project/none scopes; explicit --skills-dir and merged hook
  // config below are the source of truth for those capabilities.
  const inheritedDirs = [
    ...KIMI_BASE_INHERITED_DIRS,
    ...(skillsScope === "all" ? ["skills"] : []),
    ...(hooksScope === "all" ? ["hooks"] : []),
  ];
  for (const name of inheritedDirs) {
    const src = join(originalKimi, name);
    const dst = join(tmpKimi, name);
    if (await pathExists(src)) {
      if (await pathExists(dst)) continue;
      if (name === "credentials") {
        try {
          await symlink(src, dst, "dir");
        } catch (err) {
          throw new Error(`[omk] Fatal: failed to symlink ~/.kimi/credentials to isolated HOME: ${(err as Error).message ?? err}`);
        }
      } else {
        await symlink(src, dst, "dir").catch((err) => {
          console.warn(`[omk] Failed to symlink ~/.kimi/${name} to isolated HOME: ${(err as Error).message ?? err}`);
        });
      }
    }
  }

  if (shouldInheritLocalAuth(options.inheritLocalAuth, env)) {
    await inheritLocalTerminalAuth(originalHome, tmpHome, env);
  }

  await ensureNoSyntheticTmpMcpConfig(tmpKimi, projectRoot);

  // Merge hooks from project config into isolated HOME config.toml so that
  // project-specific hooks are active even when the global config hasn't been
  // synced yet. We copy (not symlink) so we can append missing hooks safely.
  const originalConfig = join(originalKimi, "config.toml");
  const tmpConfig = join(tmpKimi, "config.toml");
  const projectHookConfigs = [
    join(projectRoot, ".omk", "kimi.config.toml"),
    join(projectRoot, ".kimi", "kimi.config.toml"),
  ];
  const originalConfigContent = await pathExists(originalConfig)
    ? await readFile(originalConfig, "utf-8").catch(() => "")
    : "";
  const globalConfigContent = hooksScope === "all"
    ? originalConfigContent
    : stripHooksBlocks(originalConfigContent);
  const missingHookBlocks: string[] = [];
  if (hooksScope !== "none") {
    for (const projectHookConfig of projectHookConfigs) {
      if (!(await pathExists(projectHookConfig))) continue;
      const content = await readFile(projectHookConfig, "utf-8").catch(() => "");
      const hooksBlock = rewriteProjectHookCommands(extractHooksBlocks(content), projectRoot);
      if (hooksBlock && !globalConfigContent.includes(hooksBlock.trim())) {
        missingHookBlocks.push(hooksBlock);
      }
    }
  }
  try {
    if (globalConfigContent || missingHookBlocks.length > 0) {
      const mergedConfig = [globalConfigContent.trimEnd(), ...missingHookBlocks].filter(Boolean).join("\n\n") + "\n";
      await writeFile(tmpConfig, mergedConfig, { mode: 0o600 });
    }
  } catch (err) {
    console.warn(`[omk] Failed to write merged config.toml to isolated HOME: ${(err as Error).message ?? err}`);
  }

  // Shell profile bridging can re-export arbitrary local secrets. Keep it off
  // by default and require a trusted-local opt-in.
  if (shouldBridgeShellProfiles(env)) {
    const SHELL_PROFILES = [".bashrc", ".bash_profile", ".profile", ".zshrc", ".zprofile"];
    for (const name of SHELL_PROFILES) {
      const src = join(originalHome, name);
      const dst = join(tmpHome, name);
      if (await pathExists(src)) {
        await writeIsolatedShellProfileBridge(src, dst, originalHome, name);
      }
    }
  }

  return tmpHome;
}

export async function cleanupIsolatedKimiHome(tmpHome: string, options: IsolatedKimiHomeCleanupOptions = {}): Promise<IsolatedKimiHomeCleanupResult> {
  if (options.preserve) {
    const markerPath = await writeRetainedHomeMarker(tmpHome, options.reason);
    return { path: tmpHome, removed: false, retained: true, markerPath };
  }
  await rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  return { path: tmpHome, removed: true, retained: false };
}

export function resolveOriginalHome(env: NodeJS.ProcessEnv = process.env): string {
  return getUserHome(env);
}

async function inheritLocalTerminalAuth(originalHome: string, tmpHome: string, env: NodeJS.ProcessEnv): Promise<void> {
  for (const relativePath of localTerminalAuthPaths(env)) {
    const src = join(originalHome, relativePath);
    const dst = join(tmpHome, relativePath);
    await symlinkIfExists(src, dst, relativePath);
  }
}

function shouldInheritLocalAuth(optionValue: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
  if (typeof optionValue === "boolean") return optionValue;
  const value = env.OMK_ISOLATED_HOME_INHERIT_AUTH ?? env.OMK_INHERIT_LOCAL_AUTH;
  return !value || !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function shouldBridgeShellProfiles(env: NodeJS.ProcessEnv): boolean {
  const value = env.OMK_ISOLATED_HOME_BRIDGE_SHELL_PROFILES ?? env.OMK_BRIDGE_SHELL_PROFILES;
  return value ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()) : false;
}

function normalizeRuntimeScope(value: string | undefined, fallback: RuntimeScope): RuntimeScope {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "none" || normalized === "off" || normalized === "disabled") return "none";
  if (normalized === "all" || normalized === "global" || normalized === "local-user" || normalized === "local_user" || normalized === "personal" || normalized === "user") return "all";
  if (normalized === "project" || normalized === "local") return "project";
  return fallback;
}

async function resolveIsolatedKimiHomePath(options: {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  persistentHome?: boolean;
  homeLabel?: string;
}): Promise<string> {
  const runId = options.env.OMK_RUN_ID ?? options.env.OMK_SESSION_ID ?? options.env.KIMI_SESSION_ID;
  const persistentEnabled = shouldUsePersistentHome(options.persistentHome, options.env);
  if (!persistentEnabled || !runId) {
    return await mkdtemp(join(tmpdir(), "omk-home-"));
  }

  const safeRunId = sanitizeRunId(runId, "run");
  const rawLabel = options.homeLabel ?? options.env.OMK_NODE_ID ?? options.env.OMK_ROLE ?? "chat";
  const safeLabel = sanitizeRunId(rawLabel, "kimi-home");
  const persistentHome = join(getRunPath(safeRunId, undefined, options.projectRoot), "kimi-home", safeLabel);
  await mkdir(persistentHome, { recursive: true });
  return persistentHome;
}

function shouldUsePersistentHome(optionValue: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
  if (typeof optionValue === "boolean") return optionValue;
  const value = env.OMK_PERSIST_KIMI_HOME;
  if (!value) return true;
  return !["0", "false", "no", "off", "tmp", "temporary"].includes(value.trim().toLowerCase());
}

async function writeRetainedHomeMarker(tmpHome: string, reason: string | undefined): Promise<string> {
  const markerPath = join(tmpHome, ".omk-retained-kimi-home.json");
  await mkdir(tmpHome, { recursive: true });
  await writeFile(markerPath, JSON.stringify({
    retainedAt: new Date().toISOString(),
    reason: reason ?? "preserved for recovery",
    home: tmpHome,
    kimiSessions: join(tmpHome, ".kimi", "sessions"),
  }, null, 2) + "\n", { mode: 0o600 });
  return markerPath;
}

function stripHooksBlocks(content: string): string {
  const result: string[] = [];
  let skippingHookBlock = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[[hooks]]")) {
      skippingHookBlock = true;
      continue;
    }
    if (skippingHookBlock && /^\[[^\]]+]/.test(trimmed)) {
      skippingHookBlock = false;
    }
    if (!skippingHookBlock) result.push(line);
  }
  return result.join("\n").trimEnd();
}

function rewriteProjectHookCommands(content: string, projectRoot: string): string {
  return content.replace(/^(\s*command\s*=\s*)"([^"]+)"/gm, (line, prefix: string, command: string) => {
    if (!isProjectHookCommand(command)) return line;
    const absoluteCommand = isAbsolute(command) ? command : join(projectRoot, command);
    return `${prefix}${JSON.stringify(absoluteCommand)}`;
  });
}

function isProjectHookCommand(command: string): boolean {
  return command.startsWith(".omk/hooks/") || command.startsWith(".kimi/hooks/");
}

function localTerminalAuthPaths(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const explicit = parseListEnv(env.OMK_ISOLATED_HOME_AUTH_PATHS);
  if (explicit.length > 0) return explicit;

  const scope = (env.OMK_ISOLATED_HOME_AUTH_SCOPE ?? env.OMK_INHERIT_LOCAL_AUTH_SCOPE ?? "default").toLowerCase();
  if (["trusted", "broad", "all"].includes(scope)) {
    return TRUSTED_LOCAL_TERMINAL_AUTH_PATHS;
  }
  return DEFAULT_LOCAL_TERMINAL_AUTH_PATHS;
}

async function ensureNoSyntheticTmpMcpConfig(tmpKimi: string, projectRoot: string): Promise<void> {
  const projectMcpPath = join(projectRoot, ".kimi", "mcp.json");
  if (!(await pathExists(projectMcpPath))) return;
  // Deliberately no temp mcp.json creation. Remove stale leftovers if this
  // helper is ever called with a reused temp directory in tests.
  await rm(join(tmpKimi, "mcp.json"), { force: true }).catch(() => {});
}

function parseListEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function symlinkIfExists(src: string, dst: string, label: string): Promise<void> {
  let type: "dir" | "file";
  try {
    const stat = await lstat(src);
    type = stat.isDirectory() ? "dir" : "file";
  } catch {
    return;
  }

  if (await pathExists(dst)) return;
  await mkdir(dirname(dst), { recursive: true });
  await symlink(src, dst, type).catch((err) => {
    console.warn(`[omk] Failed to symlink local auth path ${label} to isolated HOME: ${(err as Error).message ?? err}`);
  });
}

async function writeIsolatedShellProfileBridge(src: string, dst: string, originalHome: string, label: string): Promise<void> {
  await mkdir(dirname(dst), { recursive: true });
  await writeFile(
    dst,
    [
      "# OMK isolated HOME shell profile bridge.",
      "# Source the real profile with the real HOME, then restore isolated HOME.",
      "if [ \"${OMK_SHELL_PROFILE_BRIDGE_ACTIVE:-}\" = \"1\" ]; then",
      "  return 0 2>/dev/null || exit 0",
      "fi",
      `__omk_isolated_home="$HOME"`,
      `__omk_original_home=\${OMK_ORIGINAL_HOME:-${shellQuote(originalHome)}}`,
      "OMK_SHELL_PROFILE_BRIDGE_ACTIVE=1",
      "export OMK_SHELL_PROFILE_BRIDGE_ACTIVE",
      'HOME="$__omk_original_home"',
      "export HOME",
      `. ${shellQuote(src)}`,
      "__omk_bridge_status=$?",
      'HOME="$__omk_isolated_home"',
      "export HOME",
      "unset OMK_SHELL_PROFILE_BRIDGE_ACTIVE __omk_original_home __omk_isolated_home",
      "return \"$__omk_bridge_status\" 2>/dev/null || exit \"$__omk_bridge_status\"",
      "",
    ].join("\n"),
    { mode: 0o600 }
  ).catch((err) => {
    console.warn(`[omk] Failed to bridge ~/${label} into isolated HOME: ${(err as Error).message ?? err}`);
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
