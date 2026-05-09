import { runShell, checkCommand } from "../util/shell.js";
import { getProjectRoot, pathExists, writeFileSafe, readTextFile } from "../util/fs.js";
import { dirname, isAbsolute, join, resolve } from "path";
import { mkdir, readdir, rm } from "fs/promises";
import { readFileSync } from "fs";
import { style, header, status } from "../util/theme.js";
import { t } from "../util/i18n.js";

const GITHUB_API_URL = "https://api.github.com/repos/voltagent/awesome-design-md/contents/design-md";
const DESIGN_MD_RAW_URL = (name: string) => `https://getdesign.md/design-md/${name}/DESIGN.md`;
const OPEN_DESIGN_REPO_URL = "https://github.com/nexu-io/open-design.git";
const OPEN_DESIGN_DEFAULT_WEB_PORT = "5175";
const OPEN_DESIGN_DEFAULT_DAEMON_PORT = "7457";

interface GitHubContentItem {
  name: string;
  type: string;
}

export interface DesignOpenDesignOptions {
  branch?: string;
  daemonPort?: string | number;
  dir?: string;
  foreground?: boolean;
  install?: boolean;
  open?: boolean;
  printOnly?: boolean;
  update?: boolean;
  webPort?: string | number;
}

interface OpenDesignResolvedOptions {
  branch: string;
  daemonPort: string;
  dir: string;
  foreground: boolean;
  install: boolean;
  open: boolean;
  printOnly: boolean;
  update: boolean;
  webPort: string;
}

export interface OpenDesignBrowserOpener {
  command: string;
  args: string[];
}

export interface OpenDesignBrowserOpenerOptions {
  commandExists?: (command: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  procVersionText?: string;
}

function normalizeOpenDesignPort(value: string | number | undefined, fallback: string, labelName: string): string {
  const raw = String(value ?? fallback).trim();
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${labelName} must be an integer between 1 and 65535`);
  }
  return String(parsed);
}

export function resolveOpenDesignDir(rawDir?: string, projectRoot = getProjectRoot()): string {
  const configuredDir = rawDir ?? process.env.OMK_OPEN_DESIGN_DIR ?? join(projectRoot, ".omk", "open-design");
  return isAbsolute(configuredDir) ? configuredDir : resolve(projectRoot, configuredDir);
}

export function resolveOpenDesignOptions(options: DesignOpenDesignOptions = {}): OpenDesignResolvedOptions {
  return {
    branch: String(options.branch ?? "main"),
    daemonPort: normalizeOpenDesignPort(options.daemonPort, OPEN_DESIGN_DEFAULT_DAEMON_PORT, "--daemon-port"),
    dir: resolveOpenDesignDir(options.dir),
    foreground: options.foreground === true,
    install: options.install !== false,
    open: options.open === true,
    printOnly: options.printOnly === true,
    update: options.update === true,
    webPort: normalizeOpenDesignPort(options.webPort, OPEN_DESIGN_DEFAULT_WEB_PORT, "--web-port"),
  };
}

export function buildOpenDesignToolsDevArgs(options: Pick<OpenDesignResolvedOptions, "daemonPort" | "foreground" | "webPort">): string[] {
  return [
    "pnpm",
    "tools-dev",
    options.foreground ? "run" : "start",
    "web",
    "--daemon-port",
    options.daemonPort,
    "--web-port",
    options.webPort,
  ];
}

const OPEN_DESIGN_OMK_AGENT_DEF = `  {
    id: 'omk',
    name: 'OMK CLI',
    bin: 'omk',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'kimi-k2.6', label: 'Kimi K2.6 via OMK' },
      { id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview via OMK' },
    ],
    buildArgs: (prompt, _imagePaths, _extra, options = {}, runtimeContext = {}) => {
      const args = ['open-design-agent', '--stdio'];
      if (runtimeContext.cwd) {
        args.push('--cwd', runtimeContext.cwd);
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      if (String(prompt || '').trim() === 'Reply with only: ok') {
        args.push('--smoke');
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'plain',
  },
`;

const OPEN_DESIGN_OMK_SETTINGS_FIELD = `  {
    agentId: 'omk',
    envKey: 'OMK_BIN',
    labelKey: 'settings.cliEnvOmkBin',
    placeholder: '/absolute/path/to/omk',
  },
`;

const OPEN_DESIGN_OMK_VISUAL = `  // OMK — Kimicat purple/mint bridge.
  omk: {
    bg: 'linear-gradient(135deg, #241C32 0%, #7B5BF5 58%, #14B8A6 100%)',
    fg: '#F3E8FF',
    glyph: (s) => star4(s, '#F3E8FF'),
  },
`;

interface OpenDesignOmkBridgeResult {
  changedFiles: string[];
  appConfigPath: string;
  omkBin: string | null;
}

function patchOpenDesignAgentsSource(source: string): string {
  let next = source;
  if (!next.includes("['omk', 'OMK_BIN']")) {
    const oldMap = "const AGENT_BIN_ENV_KEYS = new Map([['codex', 'CODEX_BIN']]);";
    const newMap = "const AGENT_BIN_ENV_KEYS = new Map([['codex', 'CODEX_BIN'], ['omk', 'OMK_BIN']]);";
    if (!next.includes(oldMap)) {
      throw new Error("Open Design agents.ts AGENT_BIN_ENV_KEYS layout changed; cannot register OMK_BIN safely.");
    }
    next = next.replace(oldMap, newMap);
  }
  if (!next.includes("id: 'omk'")) {
    const kimiMarker = "  {\n    id: 'kimi',";
    if (!next.includes(kimiMarker)) {
      throw new Error("Open Design agents.ts Kimi adapter marker changed; cannot insert OMK adapter safely.");
    }
    next = next.replace(kimiMarker, `${OPEN_DESIGN_OMK_AGENT_DEF}${kimiMarker}`);
  }
  return next;
}

function patchOpenDesignAppConfigSource(source: string): string {
  if (source.includes("['omk', new Set(['OMK_BIN'])]")) return source;
  const marker = "  ['codex', new Set(['CODEX_HOME', 'CODEX_BIN'])],";
  if (!source.includes(marker)) {
    throw new Error("Open Design app-config.ts agent env allow-list changed; cannot allow OMK_BIN safely.");
  }
  return source.replace(marker, `${marker}\n  ['omk', new Set(['OMK_BIN'])],`);
}

function patchOpenDesignSettingsSource(source: string): string {
  let next = source;
  if (!next.includes("settings.cliEnvOmkBin")) {
    const marker = `  {
    agentId: 'codex',
    envKey: 'CODEX_BIN',
    labelKey: 'settings.cliEnvCodexBin',
    placeholder: '/absolute/path/to/codex',
  },
`;
    if (!next.includes(marker)) {
      throw new Error("Open Design SettingsDialog.tsx CLI env field layout changed; cannot add OMK_BIN field safely.");
    }
    next = next.replace(marker, `${marker}${OPEN_DESIGN_OMK_SETTINGS_FIELD}`);
  }
  return next;
}

function patchOpenDesignAgentLabelsSource(source: string): string {
  let next = source;
  if (!next.includes("omk: 'OMK'")) {
    next = next.replace("  codex: 'Codex',", "  codex: 'Codex',\n  omk: 'OMK',");
  }
  if (!next.includes("'omk cli': 'omk'")) {
    next = next.replace("  'codex cli': 'codex',", "  'codex cli': 'codex',\n  'omk cli': 'omk',");
  }
  return next;
}

function patchOpenDesignAgentIconSource(source: string): string {
  if (source.includes("OMK — Kimicat")) return source;
  const marker = "  // Gemini — Google blue/purple with diamond spark.";
  if (!source.includes(marker)) {
    throw new Error("Open Design AgentIcon.tsx visual marker changed; cannot add OMK visual safely.");
  }
  return source.replace(marker, `${OPEN_DESIGN_OMK_VISUAL}${marker}`);
}

const OPEN_DESIGN_ROOT_PAGE_SOURCE = `import { ClientApp } from './[...slug]/client-app';

export default function Page() {
  return <ClientApp />;
}
`;

const OPEN_DESIGN_AWESOME_DESIGN_MD_PROMPT_TEMPLATE = {
  id: "awesome-design-md-web-ui",
  surface: "image",
  title: "Awesome DESIGN.md Web UI Reference (OMK)",
  summary: "OMK prompt template that turns a VoltAgent awesome-design-md catalog entry into an adapted web UI or prototype direction.",
  category: "Design Systems",
  tags: ["awesome-design-md", "design-md", "omk", "web-ui", "prototype"],
  model: "omk",
  aspect: "16:9",
  prompt: `Use VoltAgent awesome-design-md as the design-system reference for this Open Design task.

Inputs:
- DESIGN.md catalog name: {argument name="design-md name" default="vercel"}
- Product or page context: {argument name="product context" default="AI agent operations dashboard"}
- Artifact to create: {argument name="artifact" default="responsive landing page hero, feature cards, and CTA section"}

OMK instructions:
1. Read the workspace DESIGN.md first if it exists.
2. If a catalog style is requested, use "omk design search <name>" to confirm the entry.
3. Use "omk design apply <name>" only when the user wants the workspace DESIGN.md replaced; otherwise create or describe a DESIGN.next.md adaptation.
4. Adapt the selected template's palette, typography, spacing, density, components, and responsive rules to the local product.
5. Do not clone trademarks, logos, proprietary copy, private data, or exact brand pages. Treat the catalog entry as a reference system.
6. Produce concrete file changes or an artifact prompt, then report selected template, files touched, and checks run.`,
  source: {
    repo: "VoltAgent/awesome-design-md",
    license: "MIT",
    author: "VoltAgent",
    url: "https://github.com/voltagent/awesome-design-md",
  },
} as const;

const OPEN_DESIGN_FALLBACK_ROUTE_PAGE_SOURCE = `import { ClientApp } from './client-app';

export default function Page() {
  return <ClientApp />;
}
`;

function patchOpenDesignSpaRoutePageSource(source: string): string {
  return source
    .replace(/\n?export const dynamicParams = true;\n*/g, "\n")
    .replace(
      /\n?export function generateStaticParams\(\) \{\n {2}return \[\{ slug: \[\] as string\[\] \}\];\n\}\n*/g,
      "\n"
    )
    .replace("single optional\n// catch-all", "single catch-all")
    .replace("this single optional\n// catch-all", "this single catch-all");
}

function patchOpenDesignI18nLocaleSource(source: string): string {
  if (source.includes("'settings.cliEnvOmkBin'")) return source;
  const marker = /^ {2}'settings\.cliEnvCodexBin': .+,/m;
  if (!marker.test(source)) return source;
  return source.replace(marker, (line) => "  'settings.cliEnvOmkBin': 'OMK executable path',\n" + line);
}

function patchOpenDesignI18nTypesSource(source: string): string {
  if (source.includes("'settings.cliEnvOmkBin': string;")) return source;
  const marker = "  'settings.cliEnvCodexBin': string;";
  if (!source.includes(marker)) return source;
  return source.replace(marker, "  'settings.cliEnvOmkBin': string;\n" + marker);
}

async function patchOpenDesignFile(
  checkoutDir: string,
  relativePath: string,
  patcher: (source: string) => string,
  changedFiles: string[]
): Promise<void> {
  const target = join(checkoutDir, relativePath);
  if (!(await pathExists(target))) return;
  const original = await readTextFile(target);
  const next = patcher(original);
  if (next !== original) {
    await writeFileSafe(target, next);
    changedFiles.push(relativePath);
  }
}

async function patchOpenDesignI18n(checkoutDir: string, changedFiles: string[]): Promise<void> {
  await patchOpenDesignFile(checkoutDir, "apps/web/src/i18n/types.ts", patchOpenDesignI18nTypesSource, changedFiles);
  const localeDir = join(checkoutDir, "apps/web/src/i18n/locales");
  if (!(await pathExists(localeDir))) return;
  const entries = await readdir(localeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    await patchOpenDesignFile(
      checkoutDir,
      join("apps/web/src/i18n/locales", entry.name),
      patchOpenDesignI18nLocaleSource,
      changedFiles
    );
  }
}

async function writeOpenDesignRelativeFileIfChanged(
  checkoutDir: string,
  relativePath: string,
  contents: string,
  changedFiles: string[]
): Promise<boolean> {
  const target = join(checkoutDir, relativePath);
  const original = await pathExists(target) ? await readTextFile(target) : null;
  if (original === contents) return false;
  await writeFileSafe(target, contents);
  changedFiles.push(relativePath);
  return true;
}

async function ensureOpenDesignAwesomeDesignMdPromptTemplate(checkoutDir: string, changedFiles: string[]): Promise<void> {
  await writeOpenDesignRelativeFileIfChanged(
    checkoutDir,
    "prompt-templates/image/awesome-design-md-web-ui.json",
    `${JSON.stringify(OPEN_DESIGN_AWESOME_DESIGN_MD_PROMPT_TEMPLATE, null, 2)}\n`,
    changedFiles
  );
}

async function ensureOpenDesignSpaRoutes(checkoutDir: string, changedFiles: string[]): Promise<void> {
  const optionalRouteDir = join(checkoutDir, "apps/web/app/[[...slug]]");
  const optionalClientPath = join(optionalRouteDir, "client-app.tsx");
  const optionalPagePath = join(optionalRouteDir, "page.tsx");
  const requiredClientPath = join(checkoutDir, "apps/web/app/[...slug]/client-app.tsx");
  const requiredPageRelativePath = "apps/web/app/[...slug]/page.tsx";
  const requiredClientRelativePath = "apps/web/app/[...slug]/client-app.tsx";
  let routeChanged = false;

  if (!(await pathExists(requiredClientPath)) && await pathExists(optionalClientPath)) {
    const clientSource = await readTextFile(optionalClientPath);
    routeChanged = await writeOpenDesignRelativeFileIfChanged(
      checkoutDir,
      requiredClientRelativePath,
      clientSource,
      changedFiles
    ) || routeChanged;
  }

  const pageSource = await pathExists(optionalPagePath)
    ? patchOpenDesignSpaRoutePageSource(await readTextFile(optionalPagePath))
    : OPEN_DESIGN_FALLBACK_ROUTE_PAGE_SOURCE;
  routeChanged = await writeOpenDesignRelativeFileIfChanged(
    checkoutDir,
    requiredPageRelativePath,
    pageSource,
    changedFiles
  ) || routeChanged;
  routeChanged = await writeOpenDesignRelativeFileIfChanged(
    checkoutDir,
    "apps/web/app/page.tsx",
    OPEN_DESIGN_ROOT_PAGE_SOURCE,
    changedFiles
  ) || routeChanged;

  if (await pathExists(optionalRouteDir)) {
    await rm(optionalRouteDir, { recursive: true, force: true });
    changedFiles.push("apps/web/app/[[...slug]]/");
    routeChanged = true;
  }

  if (routeChanged) {
    await rm(join(checkoutDir, ".tmp/tools-dev/default/web/next"), { recursive: true, force: true });
  }
}

async function resolveCurrentOmkBin(): Promise<string | null> {
  const candidates = [
    process.env.OMK_BIN,
    process.argv[1],
  ].filter((candidate): candidate is string => {
    const trimmed = candidate?.trim();
    return Boolean(trimmed && trimmed !== "-" && trimmed !== "[eval]");
  });
  for (const candidate of candidates) {
    const resolved = isAbsolute(candidate) ? candidate : resolve(candidate);
    if (await pathExists(resolved)) return resolved;
  }
  const which = await runShell("sh", ["-c", "command -v omk"], { timeout: 5000 });
  const resolved = which.stdout.trim().split("\n")[0];
  return !which.failed && resolved ? resolved : null;
}

async function writeOpenDesignOmkAppConfig(checkoutDir: string, omkBin: string | null): Promise<string> {
  const configPath = join(checkoutDir, ".od", "app-config.json");
  let existing: Record<string, unknown> = {};
  if (await pathExists(configPath)) {
    try {
      const parsed: unknown = JSON.parse(await readTextFile(configPath, "{}"));
      if (isRecord(parsed)) existing = parsed;
    } catch {
      existing = {};
    }
  }

  const next: Record<string, unknown> = { ...existing };
  const currentAgent = typeof existing.agentId === "string" ? existing.agentId : null;
  if (!currentAgent || currentAgent === "kimi") {
    next.agentId = "omk";
  }
  if (omkBin) {
    const existingCliEnv = isRecord(existing.agentCliEnv) ? existing.agentCliEnv : {};
    const existingOmkEnv = isRecord(existingCliEnv.omk) ? existingCliEnv.omk : {};
    next.agentCliEnv = {
      ...existingCliEnv,
      omk: {
        ...existingOmkEnv,
        OMK_BIN: omkBin,
      },
    };
  }

  const before = JSON.stringify(existing, null, 2);
  const after = JSON.stringify(next, null, 2);
  if (before !== after) {
    await writeFileSafe(configPath, `${after}\n`);
  }
  return configPath;
}

export async function ensureOpenDesignOmkBridge(checkoutDir: string): Promise<OpenDesignOmkBridgeResult> {
  const changedFiles: string[] = [];
  await patchOpenDesignFile(checkoutDir, "apps/daemon/src/agents.ts", patchOpenDesignAgentsSource, changedFiles);
  await patchOpenDesignFile(checkoutDir, "apps/daemon/src/app-config.ts", patchOpenDesignAppConfigSource, changedFiles);
  await patchOpenDesignFile(checkoutDir, "apps/web/src/components/SettingsDialog.tsx", patchOpenDesignSettingsSource, changedFiles);
  await patchOpenDesignFile(checkoutDir, "apps/web/src/utils/agentLabels.ts", patchOpenDesignAgentLabelsSource, changedFiles);
  await patchOpenDesignFile(checkoutDir, "apps/web/src/components/AgentIcon.tsx", patchOpenDesignAgentIconSource, changedFiles);
  await ensureOpenDesignSpaRoutes(checkoutDir, changedFiles);
  await patchOpenDesignI18n(checkoutDir, changedFiles);
  await ensureOpenDesignAwesomeDesignMdPromptTemplate(checkoutDir, changedFiles);
  const omkBin = await resolveCurrentOmkBin();
  const appConfigPath = await writeOpenDesignOmkAppConfig(checkoutDir, omkBin);
  return { changedFiles, appConfigPath, omkBin };
}

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readPackageName(packagePath: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readTextFile(packagePath, "{}"));
    if (!isRecord(parsed)) return null;
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

async function requireCommand(command: string, hint: string): Promise<void> {
  if (await checkCommand(command)) return;
  console.error(status.error(`${command} is required for Open Design.`));
  console.error(style.gray(`  ${hint}`));
  process.exit(1);
}

function requireNode24(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (major === 24) return;
  console.error(status.error(`Open Design requires Node.js 24.x; current Node is ${process.version}.`));
  console.error(style.gray("  Example: fnm install 24 && fnm use 24"));
  process.exit(1);
}

async function ensureOpenDesignCheckout(options: OpenDesignResolvedOptions): Promise<void> {
  const packagePath = join(options.dir, "package.json");
  if (await pathExists(packagePath)) {
    const packageName = await readPackageName(packagePath);
    if (packageName !== "open-design") {
      console.error(status.error(`Existing directory is not an Open Design checkout: ${options.dir}`));
      console.error(style.gray("  Pass --dir to an empty directory or an existing nexu-io/open-design checkout."));
      process.exit(1);
    }

    if (options.update && await pathExists(join(options.dir, ".git"))) {
      console.log(style.gray("Updating Open Design checkout…"));
      const pull = await runShell("git", ["-C", options.dir, "pull", "--ff-only"], { timeout: 120000 });
      if (pull.failed) {
        console.error(status.error("Open Design update failed."));
        console.error(pull.stderr || pull.stdout);
        process.exit(pull.exitCode);
      }
    }
    return;
  }

  await mkdir(dirname(options.dir), { recursive: true });
  console.log(style.gray(`Cloning Open Design into ${options.dir}…`));
  const clone = await runShell("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    options.branch,
    OPEN_DESIGN_REPO_URL,
    options.dir,
  ], { timeout: 180000, stdio: "inherit" });
  if (clone.failed) {
    console.error(status.error("Open Design clone failed."));
    process.exit(clone.exitCode);
  }
}

async function installOpenDesignDependencies(options: OpenDesignResolvedOptions): Promise<void> {
  if (!options.install) {
    console.log(status.warn("Skipping pnpm install because --no-install was passed."));
    return;
  }

  const installedMarker = join(options.dir, "node_modules", ".modules.yaml");
  if (await pathExists(installedMarker)) {
    console.log(status.ok("Open Design dependencies already installed."));
    return;
  }

  console.log(style.gray("Installing Open Design dependencies with Corepack/pnpm…"));
  const install = await runShell("corepack", ["pnpm", "install", "--frozen-lockfile"], {
    cwd: options.dir,
    timeout: 900000,
    stdio: "inherit",
  });
  if (install.failed) {
    console.error(status.error("Open Design dependency install failed."));
    process.exit(install.exitCode);
  }
}

async function waitForLocalhost(url: string, timeoutMs = 45000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 1500);
    try {
      const response = await fetch(url, { method: "GET", signal: ac.signal });
      if (response.status < 500) return true;
    } catch {
      // keep waiting
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  return false;
}

export function isWslRuntime(options: Pick<OpenDesignBrowserOpenerOptions, "env" | "platform" | "procVersionText"> = {}): boolean {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") return false;

  const env = options.env ?? process.env;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;

  try {
    const version = options.procVersionText ?? readFileSync("/proc/version", "utf-8");
    return /microsoft|wsl/i.test(version);
  } catch {
    return false;
  }
}

export async function resolveOpenDesignBrowserOpener(
  url: string,
  options: OpenDesignBrowserOpenerOptions = {}
): Promise<OpenDesignBrowserOpener> {
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  const commandExists = options.commandExists ?? checkCommand;
  if (isWslRuntime(options)) {
    if (await commandExists("wslview")) {
      return { command: "wslview", args: [url] };
    }
    if (await commandExists("cmd.exe")) {
      return { command: "cmd.exe", args: ["/c", "start", "", url] };
    }
  }

  return { command: "xdg-open", args: [url] };
}

async function openBrowser(url: string): Promise<void> {
  const opener = await resolveOpenDesignBrowserOpener(url);
  const result = await runShell(opener.command, opener.args, { timeout: 10000 });
  if (result.failed) {
    console.log(status.warn(`Browser open failed. Open manually: ${url}`));
  }
}

function printOpenDesignPlan(options: OpenDesignResolvedOptions): void {
  const args = buildOpenDesignToolsDevArgs(options);
  console.log(header("Open Design localhost"));
  console.log(style.gray("Launch plan (no changes made):"));
  console.log(`  Repo: ${options.dir}`);
  console.log(`  Web:  http://localhost:${options.webPort}`);
  console.log("  Agent: OMK CLI (local bridge; avoids Kimi ACP smoke-test timeout)");
  console.log(`  Clone: ${formatCommand("git", ["clone", "--depth", "1", "--branch", options.branch, OPEN_DESIGN_REPO_URL, options.dir])}`);
  console.log(`  Install: ${formatCommand("corepack", ["pnpm", "install", "--frozen-lockfile"])}`);
  console.log(`  Start: ${formatCommand("corepack", args)}`);
}

async function fetchDesignList(): Promise<string[]> {
  try {
    const result = await runShell("curl", ["-sL", "-H", "Accept: application/vnd.github.v3+json", GITHUB_API_URL], { timeout: 15000 });
    if (result.failed) return [];
    const parsed: GitHubContentItem[] = JSON.parse(result.stdout);
    return parsed.filter((item) => item.type === "dir").map((item) => item.name);
  } catch {
    return [];
  }
}

async function fetchDesignMd(name: string): Promise<string | null> {
  try {
    const result = await runShell("curl", ["-sL", DESIGN_MD_RAW_URL(name)], { timeout: 15000 });
    const out = result.stdout.trim().toLowerCase();
    if (result.failed || out.startsWith("<!doctype") || out.startsWith("<html")) {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}

export async function designInitCommand(): Promise<void> {
  const root = getProjectRoot();
  const designPath = join(root, "DESIGN.md");
  if (await pathExists(designPath)) {
    console.log(status.info("DESIGN.md already exists."));
    return;
  }
  await writeFileSafe(designPath, `---
version: "alpha"
name: "my-project"
description: "Project design system"
colors:
  primary: "#111827"
  secondary: "#4B5563"
  accent: "#7C3AED"
  success: "#059669"
  warning: "#D97706"
  danger: "#DC2626"
  background: "#F9FAFB"
  surface: "#FFFFFF"
typography:
  h1:
    fontFamily: "Inter"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: "2.5rem"
  body:
    fontFamily: "Inter"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
rounded:
  sm: "0.375rem"
  md: "0.75rem"
  lg: "1rem"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
---

## Overview

Describe your project's visual identity here.
`);
  console.log(status.ok("DESIGN.md created."));
}

export async function designListCommand(): Promise<void> {
  console.log(header(t("design.listHeader")));
  const list = await fetchDesignList();
  if (list.length === 0) {
    console.error(status.error(t("design.listFetchFailed")));
    process.exit(1);
  }

  // Category classification (hardcoded metadata)
  const categories: Record<string, string[]> = {
    "AI & LLM": ["claude", "cohere", "elevenlabs", "minimax", "mistral.ai", "ollama", "opencode.ai", "replicate", "runwayml", "together.ai", "voltagent", "x.ai"],
    "Developer Tools": ["cursor", "expo", "lovable", "raycast", "superhuman", "vercel", "warp"],
    "Backend & DevOps": ["clickhouse", "composio", "hashicorp", "mongodb", "posthog", "sanity", "sentry", "supabase"],
    "Productivity & SaaS": ["cal", "intercom", "linear.app", "mintlify", "notion", "resend", "zapier"],
    "Design & Creative": ["airtable", "clay", "figma", "framer", "miro", "webflow"],
    "Fintech & Crypto": ["binance", "coinbase", "kraken", "mastercard", "revolut", "stripe", "wise"],
    "E-commerce & Retail": ["airbnb", "meta", "pinterest", "semrush", "spotify", "tesla", "uber"],
    "Automotive": ["bmw", "ferrari", "lamborghini", "renault"],
  };

  const categorized = new Set<string>();
  for (const [cat, names] of Object.entries(categories)) {
    const matched = list.filter((n) => names.includes(n));
    if (matched.length === 0) continue;
    matched.forEach((n) => categorized.add(n));
    console.log(style.pinkBold(`\n## ${cat}`));
    for (const name of matched) {
      console.log(style.gray(`  ${name}`));
    }
  }

  const others = list.filter((n) => !categorized.has(n));
  if (others.length > 0) {
    console.log(style.pinkBold("\n## " + t("design.categoryOthers")));
    for (const name of others) {
      console.log(style.gray(`  ${name}`));
    }
  }

  console.log("\n" + status.success(t("design.totalFound", list.length)));
  console.log(style.gray("\n" + t("design.usageApply")));
  console.log(style.gray(t("design.exampleApply")));
}

export async function designApplyCommand(name: string): Promise<void> {
  if (!name) {
    console.error(status.error(t("design.nameRequired")));
    process.exit(1);
  }

  console.log(style.purple(t("design.downloading", name)));
  const content = await fetchDesignMd(name);
  if (!content) {
    console.error(status.error(t("design.notFound", name)));
    console.error(style.gray(t("design.checkList")));
    process.exit(1);
  }

  const root = getProjectRoot();
  const designPath = join(root, "DESIGN.md");
  const backupPath = join(root, "DESIGN.md.bak");

  // Backup existing file
  if (await pathExists(designPath)) {
    const existing = await readTextFile(designPath, "");
    if (existing.trim()) {
      await writeFileSafe(backupPath, existing);
      console.log(style.orange(t("design.backupExisting")));
    }
  }

  await writeFileSafe(designPath, content);
  console.log(status.success(t("design.applyComplete", name)));
  console.log(style.gray(t("design.source", name)));
}

export async function designSearchCommand(keyword: string): Promise<void> {
  if (!keyword) {
    console.error(status.error(t("design.keywordRequired")));
    process.exit(1);
  }

  console.log(style.purple(t("design.searching", keyword)));
  const list = await fetchDesignList();
  const matched = list.filter((n) => n.toLowerCase().includes(keyword.toLowerCase()));

  if (matched.length === 0) {
    console.log(status.warn(t("design.noResults")));
    console.log(style.gray(t("design.seeFullList")));
    process.exit(1);
  }

  console.log(status.success(t("design.resultsCount", matched.length)));
  for (const name of matched) {
    console.log(`  ${name}`);
  }
  console.log(style.gray("\n" + t("design.usageApply")));
}

export async function designOpenDesignCommand(options: DesignOpenDesignOptions = {}): Promise<void> {
  let resolved: OpenDesignResolvedOptions;
  try {
    resolved = resolveOpenDesignOptions(options);
  } catch (err) {
    console.error(status.error(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  if (resolved.printOnly) {
    printOpenDesignPlan(resolved);
    return;
  }

  requireNode24();
  await requireCommand("git", "Install git, then rerun: omk design open-design");
  await requireCommand("corepack", "Install/enable Node Corepack, then rerun: corepack enable");

  const corepack = await runShell("corepack", ["enable"], { timeout: 60000 });
  if (corepack.failed) {
    console.log(status.warn("corepack enable failed; continuing because Corepack may already be active."));
  }

  await ensureOpenDesignCheckout(resolved);
  const bridge = await ensureOpenDesignOmkBridge(resolved.dir);
  await installOpenDesignDependencies(resolved);

  const webUrl = `http://localhost:${resolved.webPort}`;
  const args = buildOpenDesignToolsDevArgs(resolved);

  console.log(header("Open Design"));
  if (bridge.changedFiles.length > 0) {
    console.log(status.ok(`OMK CLI adapter registered (${bridge.changedFiles.join(", ")}).`));
  } else {
    console.log(status.ok("OMK CLI adapter already registered."));
  }
  console.log(style.gray(`Default local agent: OMK CLI${bridge.omkBin ? ` (${bridge.omkBin})` : ""}`));
  console.log(style.gray(`App config: ${bridge.appConfigPath}`));
  console.log(style.gray(`Starting local Open Design daemon + web at ${webUrl}…`));
  console.log(style.gray(`Command: ${formatCommand("corepack", args)}`));

  const launch = await runShell("corepack", args, {
    cwd: resolved.dir,
    timeout: resolved.foreground ? 0 : 180000,
    stdio: resolved.foreground ? "inherit" : "pipe",
  });

  if (launch.failed) {
    console.error(status.error("Open Design launch failed."));
    console.error(launch.stderr || launch.stdout);
    process.exit(launch.exitCode);
  }

  if (!resolved.foreground) {
    if (launch.stdout.trim()) console.log(launch.stdout.trim());
    if (launch.stderr.trim()) console.error(launch.stderr.trim());

    const reachable = await waitForLocalhost(webUrl);
    if (reachable) {
      console.log(status.success("Open Design localhost is ready."));
      console.log(`  ${style.mint("Web")}    ${webUrl}`);
      console.log(`  ${style.mint("Repo")}   ${resolved.dir}`);
      console.log(style.gray("  In the Open Design UI, use OMK CLI. Kimi CLI ACP smoke tests are intentionally bypassed."));
      if (resolved.open) await openBrowser(webUrl);
      return;
    }

    console.log(status.warn(`Open Design start command completed, but ${webUrl} was not reachable yet.`));
    console.log(style.gray(`  Check status: cd ${shellQuote(resolved.dir)} && corepack pnpm tools-dev status`));
    console.log(style.gray(`  Check logs:   cd ${shellQuote(resolved.dir)} && corepack pnpm tools-dev logs`));
  }
}

export async function designLintCommand(file?: string): Promise<void> {
  const target = file ?? "DESIGN.md";
  const result = await runShell("npx", ["-y", "@google/design.md", "lint", target], { timeout: 60000 });
  console.log(result.stdout || result.stderr);
  if (result.failed) process.exit(result.exitCode);
}

export async function designDiffCommand(from?: string, to?: string): Promise<void> {
  const a = from ?? "DESIGN.md";
  const b = to ?? "DESIGN.next.md";
  const result = await runShell("npx", ["-y", "@google/design.md", "diff", a, b], { timeout: 60000 });
  console.log(result.stdout || result.stderr);
  if (result.failed) process.exit(result.exitCode);
}

export async function designExportCommand(format: string, file?: string): Promise<void> {
  const target = file ?? "DESIGN.md";
  const result = await runShell("npx", ["-y", "@google/design.md", "export", "--format", format, target], { timeout: 60000 });
  console.log(result.stdout || result.stderr);
  if (result.failed) process.exit(result.exitCode);
}
