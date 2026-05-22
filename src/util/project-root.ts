import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { execSync } from "child_process";
import { execa } from "execa";

export type ProjectRootSource =
  | "env"
  | "default-env"
  | "default-config"
  | "strong-marker"
  | "home-git-fallback"
  | "git"
  | "cwd";

export interface ProjectRootResolution {
  root: string;
  source: ProjectRootSource;
  cwd: string;
  home: string;
  gitRoot?: string;
  marker?: string;
  configuredDefaultProjectRoot?: string;
  defaultProjectRootError?: string;
  isHomeRoot: boolean;
  homeIsGitRepo: boolean;
  warning?: string;
  recommendation?: string;
}

export interface ResolveProjectRootOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  allowHomeGitRoot?: boolean;
}

interface DefaultProjectRootCandidate {
  value?: string;
  source?: "default-env" | "default-config";
  error?: string;
}

const STRONG_PROJECT_MARKERS = [
  ".omk/agents/root.yaml",
  ".omk/runtime-preset.json",
  ".omk/config.toml",
  ".omk/prompts/root.md",
  ".kimi/AGENTS.md",
] as const;

const HOME_ROOT_WARNING = "effective OMK project root is HOME; set OMK_PROJECT_ROOT or OMK_DEFAULT_PROJECT_ROOT to the intended project";
const HOME_GIT_WARNING = "git root resolves to HOME and is not used as the default OMK project root";

function normalizeHome(env: NodeJS.ProcessEnv, explicitHome?: string): string {
  return resolve(explicitHome ?? env.OMK_ORIGINAL_HOME ?? env.HOME ?? env.USERPROFILE ?? homedir());
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isSamePath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return comparablePath(left) === comparablePath(right);
}

function canonicalizePath(value: string): string {
  const resolved = resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function comparablePath(value: string): string {
  const canonical = canonicalizePath(value);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function projectRootRecommendation(): string {
  return "Run with OMK_PROJECT_ROOT=/path/to/project or set OMK_DEFAULT_PROJECT_ROOT for shells launched from HOME.";
}

function markerAt(directory: string): string | undefined {
  for (const marker of STRONG_PROJECT_MARKERS) {
    if (existsSync(join(directory, marker))) return marker;
  }
  return undefined;
}

function findStrongMarkerRoot(cwd: string, home: string): { root: string; marker: string } | undefined {
  let current = resolve(cwd);
  const resolvedHome = resolve(home);
  while (true) {
    if (!isSamePath(current, resolvedHome)) {
      const marker = markerAt(current);
      if (marker) return { root: current, marker };
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readDefaultProjectRootFromUserConfig(home: string): string | undefined {
  try {
    const raw = readFileSync(join(home, ".omk", "config.toml"), "utf-8");
    let section = "";
    for (const originalLine of raw.split(/\r?\n/)) {
      const line = stripTomlComment(originalLine).trim();
      if (!line) continue;
      const sectionMatch = /^\[([^\]]+)]$/.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1].trim();
        continue;
      }
      const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
      if (!kv) continue;
      const key = section ? `${section}.${kv[1].trim()}` : kv[1].trim();
      if (key === "default_project_root" || key === "runtime.default_project_root") {
        return normalizeTomlValue(kv[2].trim());
      }
    }
  } catch {
    // Missing or unreadable user config is expected.
  }
  return undefined;
}

function stripTomlComment(line: string): string {
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

function validateDefaultProjectRoot(value: string | undefined): { root?: string; error?: string } {
  if (!value) return {};
  if (hasControlChars(value)) return { error: "configured default_project_root contains control characters" };
  const resolved = resolve(value);
  try {
    const info = statSync(resolved);
    if (!info.isDirectory()) return { error: "configured default_project_root is not a directory" };
    return { root: resolved };
  } catch {
    return { error: "configured default_project_root does not exist" };
  }
}

function defaultProjectRootCandidate(env: NodeJS.ProcessEnv, home: string): DefaultProjectRootCandidate {
  if (env.OMK_DEFAULT_PROJECT_ROOT) {
    const checked = validateDefaultProjectRoot(env.OMK_DEFAULT_PROJECT_ROOT);
    return {
      value: checked.root,
      source: checked.root ? "default-env" : undefined,
      error: checked.error,
    };
  }

  const configured = readDefaultProjectRootFromUserConfig(home);
  const checked = validateDefaultProjectRoot(configured);
  return {
    value: checked.root,
    source: checked.root ? "default-config" : undefined,
    error: checked.error,
  };
}

function gitRootSync(cwd: string): string | undefined {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    return gitRoot ? resolve(gitRoot) : undefined;
  } catch {
    return undefined;
  }
}

async function gitRootAsync(cwd: string): Promise<string | undefined> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 3000,
    });
    const gitRoot = result.stdout.trim();
    return gitRoot ? resolve(gitRoot) : undefined;
  } catch {
    return undefined;
  }
}

function createResolution(args: {
  root: string;
  source: ProjectRootSource;
  cwd: string;
  home: string;
  gitRoot?: string;
  marker?: string;
  defaultCandidate?: DefaultProjectRootCandidate;
  warning?: string;
  recommendation?: string;
}): ProjectRootResolution {
  const root = resolve(args.root);
  const home = resolve(args.home);
  const cwd = resolve(args.cwd);
  const gitRoot = args.gitRoot ? resolve(args.gitRoot) : undefined;
  return {
    root,
    source: args.source,
    cwd,
    home,
    gitRoot,
    marker: args.marker,
    configuredDefaultProjectRoot: args.defaultCandidate?.value,
    defaultProjectRootError: args.defaultCandidate?.error,
    isHomeRoot: isSamePath(root, home),
    homeIsGitRepo: isSamePath(args.gitRoot, home),
    warning: args.warning,
    recommendation: args.recommendation,
  };
}

function resolveAfterGitRoot(args: {
  cwd: string;
  home: string;
  env: NodeJS.ProcessEnv;
  gitRoot?: string;
  marker?: { root: string; marker: string };
  allowHomeGitRoot?: boolean;
}): ProjectRootResolution {
  const defaultCandidate = defaultProjectRootCandidate(args.env, args.home);

  if (args.marker) {
    return createResolution({
      root: args.marker.root,
      source: "strong-marker",
      cwd: args.cwd,
      home: args.home,
      gitRoot: args.gitRoot,
      marker: args.marker.marker,
      defaultCandidate,
    });
  }

  if (args.gitRoot && isSamePath(args.gitRoot, args.home) && !args.allowHomeGitRoot) {
    if (defaultCandidate.value && defaultCandidate.source) {
      return createResolution({
        root: defaultCandidate.value,
        source: defaultCandidate.source,
        cwd: args.cwd,
        home: args.home,
        gitRoot: args.gitRoot,
        defaultCandidate,
      });
    }
    const fallbackRoot = isSamePath(args.cwd, args.home) ? args.home : args.cwd;
    return createResolution({
      root: fallbackRoot,
      source: "home-git-fallback",
      cwd: args.cwd,
      home: args.home,
      gitRoot: args.gitRoot,
      defaultCandidate,
      warning: isSamePath(fallbackRoot, args.home) ? HOME_ROOT_WARNING : HOME_GIT_WARNING,
      recommendation: projectRootRecommendation(),
    });
  }

  if (args.gitRoot) {
    return createResolution({
      root: args.gitRoot,
      source: "git",
      cwd: args.cwd,
      home: args.home,
      gitRoot: args.gitRoot,
      defaultCandidate,
    });
  }

  if (isSamePath(args.cwd, args.home) && defaultCandidate.value && defaultCandidate.source) {
    return createResolution({
      root: defaultCandidate.value,
      source: defaultCandidate.source,
      cwd: args.cwd,
      home: args.home,
      defaultCandidate,
    });
  }

  return createResolution({
    root: args.cwd,
    source: "cwd",
    cwd: args.cwd,
    home: args.home,
    defaultCandidate,
    warning: isSamePath(args.cwd, args.home) ? HOME_ROOT_WARNING : undefined,
    recommendation: isSamePath(args.cwd, args.home) ? projectRootRecommendation() : undefined,
  });
}

export function resolveProjectRoot(options: ResolveProjectRootOptions = {}): ProjectRootResolution {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const home = normalizeHome(env, options.home);

  if (env.OMK_PROJECT_ROOT) {
    return createResolution({
      root: env.OMK_PROJECT_ROOT,
      source: "env",
      cwd,
      home,
    });
  }

  const marker = findStrongMarkerRoot(cwd, home);
  const gitRoot = gitRootSync(cwd);
  return resolveAfterGitRoot({
    cwd,
    home,
    env,
    gitRoot,
    marker,
    allowHomeGitRoot: options.allowHomeGitRoot,
  });
}

export async function resolveProjectRootAsync(options: ResolveProjectRootOptions = {}): Promise<ProjectRootResolution> {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const home = normalizeHome(env, options.home);

  if (env.OMK_PROJECT_ROOT) {
    return createResolution({
      root: env.OMK_PROJECT_ROOT,
      source: "env",
      cwd,
      home,
    });
  }

  const marker = findStrongMarkerRoot(cwd, home);
  const gitRoot = await gitRootAsync(cwd);
  return resolveAfterGitRoot({
    cwd,
    home,
    env,
    gitRoot,
    marker,
    allowHomeGitRoot: options.allowHomeGitRoot,
  });
}

export function getProjectRoot(): string {
  return resolveProjectRoot().root;
}

export async function getProjectRootAsync(): Promise<string> {
  return (await resolveProjectRootAsync()).root;
}

export function getProjectRootDiagnostics(): ProjectRootResolution {
  return resolveProjectRoot();
}

export function displayProjectRootPath(path: string | undefined, home = normalizeHome(process.env)): string | null {
  if (!path) return null;
  const resolved = resolve(path);
  const resolvedHome = resolve(home);
  if (isSamePath(resolved, resolvedHome)) return "~";
  const rel = relative(resolvedHome, resolved);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return `~/${rel.replace(/\\/g, "/")}`;
  return resolved;
}
