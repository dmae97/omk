import { runShell, checkCommand } from "../util/shell.js";
import { getProjectRoot, pathExists, writeFileSafe, readTextFile } from "../util/fs.js";
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "path";
import { chmod, lstat, mkdir, readdir, rm } from "fs/promises";
import { existsSync, readFileSync, readdirSync } from "fs";
import { createServer } from "net";
import { style, header, status } from "../util/theme.js";
import { BRAND_HEX } from "../brand/palette.js";
import { DESIGN_SCAFFOLD } from "../theme/extended-palette.js";
import { t } from "../util/i18n.js";

const GITHUB_API_URL = "https://api.github.com/repos/voltagent/awesome-design-md/contents/design-md";
const DESIGN_MD_RAW_URL = (name: string) => `https://getdesign.md/design-md/${name}/DESIGN.md`;
const OPEN_DESIGN_REPO_URL = "https://github.com/nexu-io/open-design.git";
export const OPEN_DESIGN_TESTED_REF = "3f7a05e7462f097bf38b7cbac0d4a4593deecd80";
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
  doctor?: boolean;
  foreground?: boolean;
  install?: boolean;
  json?: boolean;
  open?: boolean;
  printOnly?: boolean;
  ref?: string;
  update?: boolean;
  webPort?: string | number;
}

interface OpenDesignResolvedOptions {
  branch: string;
  daemonPort: string;
  dir: string;
  ref: string;
  foreground: boolean;
  install: boolean;
  open: boolean;
  printOnly: boolean;
  update: boolean;
  webPort: string;
}

interface OpenDesignNodeRuntime {
  corepackCommand: string;
  env?: Record<string, string>;
  nodeCommand?: string;
}

interface OpenDesignNodeRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  nodeVersion?: string;
  pathExistsSync?: (path: string) => boolean;
  platform?: NodeJS.Platform;
  readDirSync?: (path: string) => string[];
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
  const branch = String(options.branch ?? "main");
  return {
    branch,
    daemonPort: normalizeOpenDesignPort(options.daemonPort, OPEN_DESIGN_DEFAULT_DAEMON_PORT, "--daemon-port"),
    dir: resolveOpenDesignDir(options.dir),
    ref: String(options.ref ?? process.env.OMK_OPEN_DESIGN_REF ?? branch),
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

function parseNodeMajor(version: string): number | null {
  const match = /^v?(\d+)/.exec(version.trim());
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

function nodeBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "node.exe" : "node";
}

function corepackBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "corepack.cmd" : "corepack";
}

function buildOpenDesignNodeRuntime(nodeCommand: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): OpenDesignNodeRuntime {
  const pathModule = platform === "win32" ? win32 : posix;
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const binDir = pathModule.dirname(nodeCommand);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = env[pathKey] ?? "";
  return {
    corepackCommand: pathModule.join(binDir, corepackBinaryName(platform)),
    env: {
      [pathKey]: currentPath ? `${binDir}${pathDelimiter}${currentPath}` : binDir,
    },
    nodeCommand,
  };
}

function findNvmNode24(options: Required<Pick<OpenDesignNodeRuntimeOptions, "env" | "home" | "pathExistsSync" | "platform" | "readDirSync">>): string | null {
  const nvmDir = options.env.NVM_DIR ?? join(options.home, ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  let entries: string[];
  try {
    entries = options.readDirSync(versionsDir);
  } catch {
    return null;
  }

  const nodeName = nodeBinaryName(options.platform);
  const candidates = entries
    .filter((entry) => parseNodeMajor(entry) === 24)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const entry of candidates) {
    const nodeCommand = join(versionsDir, entry, "bin", nodeName);
    if (options.pathExistsSync(nodeCommand)) return nodeCommand;
  }
  return null;
}

export function resolveOpenDesignNodeRuntime(options: OpenDesignNodeRuntimeOptions = {}): OpenDesignNodeRuntime | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.version;
  if (parseNodeMajor(nodeVersion) === 24) {
    return { corepackCommand: "corepack" };
  }

  const pathExists = options.pathExistsSync ?? existsSync;
  const explicitNode = env.OMK_OPEN_DESIGN_NODE24;
  if (explicitNode && pathExists(explicitNode)) {
    return buildOpenDesignNodeRuntime(explicitNode, env, platform);
  }

  const nodeCommand = findNvmNode24({
    env,
    home: options.home ?? process.env.HOME ?? "",
    pathExistsSync: pathExists,
    platform,
    readDirSync: options.readDirSync ?? readdirSync,
  });
  return nodeCommand ? buildOpenDesignNodeRuntime(nodeCommand, env, platform) : null;
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
    buildArgs: (prompt, imagePaths, _extra, options = {}, runtimeContext = {}) => {
      const args = ['open-design-agent', '--stdio'];
      if (runtimeContext.cwd) {
        args.push('--cwd', runtimeContext.cwd);
      }
      for (const imagePath of imagePaths || []) {
        if (imagePath) args.push('--image', String(imagePath));
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

const OPEN_DESIGN_OMK_RUNTIME_AGENT_DEF = `import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const omkAgentDef = {
    id: 'omk',
    name: 'OMK CLI',
    bin: 'omk',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'kimi-k2.6', label: 'Kimi K2.6 via OMK' },
      { id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview via OMK' },
    ],
    buildArgs: (prompt, imagePaths, _extra, options = {}, runtimeContext = {}) => {
      const args = ['open-design-agent', '--stdio'];
      if (runtimeContext.cwd) {
        args.push('--cwd', runtimeContext.cwd);
      }
      for (const imagePath of imagePaths || []) {
        if (imagePath) args.push('--image', String(imagePath));
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
} satisfies RuntimeAgentDef;
`;

const OPEN_DESIGN_OMK_SETTINGS_FIELD = `  {
    agentId: 'omk',
    envKey: 'OMK_BIN',
    labelKey: 'settings.cliEnvOmkBin',
    placeholder: '/absolute/path/to/omk',
  },
`;

const OPEN_DESIGN_OMK_VISUAL_MARKER = "OMK — Control-plane neon-grid bridge.";
const OPEN_DESIGN_OMK_VISUAL_BLOCK_RE = /[ ]{2}\/\/ OMK — (?:Control-plane neon-grid bridge\.|Kimicat purple\/mint bridge\.)\n[ ]{2}omk: \{\n[ ]{4}bg: '[^']+',\n[ ]{4}fg: '[^']+',\n[ ]{4}glyph: \(s\) => star4\(s, '[^']+'\),\n[ ]{2}\},\n/;

const OPEN_DESIGN_OMK_VISUAL = `  // ${OPEN_DESIGN_OMK_VISUAL_MARKER}
  omk: {
    bg: 'linear-gradient(135deg, ${BRAND_HEX.dark} 0%, ${BRAND_HEX.cyan} 45%, ${BRAND_HEX.magenta} 100%)',
    fg: '${BRAND_HEX.cream}',
    glyph: (s) => star4(s, '${BRAND_HEX.cream}'),
  },
`;

const OPEN_DESIGN_OMK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="OMK">
  <defs>
    <linearGradient id="omk" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="${BRAND_HEX.dark}"/>
      <stop offset=".45" stop-color="${BRAND_HEX.cyan}"/>
      <stop offset="1" stop-color="${BRAND_HEX.magenta}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="18" fill="url(#omk)"/>
  <path d="M20 35c0-8 5-14 12-14s12 6 12 14v7h-6v-7c0-5-2-8-6-8s-6 3-6 8v7h-6v-7Z" fill="${BRAND_HEX.cream}"/>
  <path d="M17 20l4 3 4-3-3 5 3 5-4-3-4 3 3-5-3-5Zm25 0 4 3 4-3-3 5 3 5-4-3-4 3 3-5-3-5Z" fill="${BRAND_HEX.amber}"/>
</svg>
`;

interface OpenDesignOmkBridgeResult {
  changedFiles: string[];
  appConfigPath: string;
  omkBin: string | null;
  compatibilityProfiles: OpenDesignCompatibilityProfile[];
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
  if (source.includes(marker)) {
    return source.replace(marker, `${marker}\n  ['omk', new Set(['OMK_BIN'])],`);
  }
  const codexAllowListLine = /^(\s*\['codex', new Set\(\[[^\n]+\]\)],)$/m;
  if (!codexAllowListLine.test(source)) {
    throw new Error("Open Design app-config.ts agent env allow-list changed; cannot allow OMK_BIN safely.");
  }
  return source.replace(codexAllowListLine, "$1\n  ['omk', new Set(['OMK_BIN'])],");
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
      const codexBinField = /(\s*\{\n\s*agentId: 'codex',\n\s*envKey: 'CODEX_BIN',\n\s*labelKey: 'settings\.cliEnvCodexBin',\n\s*placeholder: '\/absolute\/path\/to\/codex',\n\s*\},\n)/;
      if (!codexBinField.test(next)) {
        throw new Error("Open Design SettingsDialog.tsx CLI env field layout changed; cannot add OMK_BIN field safely.");
      }
      next = next.replace(codexBinField, `$1${OPEN_DESIGN_OMK_SETTINGS_FIELD}`);
    } else {
      next = next.replace(marker, `${marker}${OPEN_DESIGN_OMK_SETTINGS_FIELD}`);
    }
  }
  return next;
}

function patchOpenDesignAgentLabelsSource(source: string): string {
  let next = source;
  if (!next.includes("omk: 'OMK'")) {
    if (!next.includes("  codex: 'Codex',")) {
      throw new Error("Open Design agentLabels.ts label layout changed; cannot add OMK label safely.");
    }
    next = next.replace("  codex: 'Codex',", "  codex: 'Codex',\n  omk: 'OMK',");
  }
  if (!next.includes("'omk cli': 'omk'")) {
    if (!next.includes("  'codex cli': 'codex',")) {
      throw new Error("Open Design agentLabels.ts alias layout changed; cannot add OMK alias safely.");
    }
    next = next.replace("  'codex cli': 'codex',", "  'codex cli': 'codex',\n  'omk cli': 'omk',");
  }
  return next;
}

function patchOpenDesignAgentIconSource(source: string): string {
  if (source.includes(OPEN_DESIGN_OMK_VISUAL)) return source;
  if (OPEN_DESIGN_OMK_VISUAL_BLOCK_RE.test(source)) {
    return source.replace(OPEN_DESIGN_OMK_VISUAL_BLOCK_RE, OPEN_DESIGN_OMK_VISUAL);
  }
  if (source.includes("const ICON_EXT: Record<string, 'svg' | 'png'>")) {
    if (source.includes("omk: 'svg'")) return source;
    const marker = "  kimi: 'svg',";
    const emptyIconExt = /(const ICON_EXT: Record<string, 'svg' \| 'png'> = \{)\s*(\};)/m;
    if (!source.includes(marker) && emptyIconExt.test(source)) {
      return source.replace(emptyIconExt, "$1\n  omk: 'svg',\n$2");
    }
    if (!source.includes(marker)) {
      throw new Error("Open Design AgentIcon.tsx ICON_EXT layout changed; cannot add OMK icon safely.");
    }
    return source.replace(marker, `${marker}\n  omk: 'svg',`);
  }
  const marker = "  // Gemini — Google blue/purple with diamond spark.";
  if (!source.includes(marker)) {
    throw new Error("Open Design AgentIcon.tsx visual marker changed; cannot add OMK visual safely.");
  }
  return source.replace(marker, `${OPEN_DESIGN_OMK_VISUAL}${marker}`);
}

function patchOpenDesignRuntimeRegistrySource(source: string): string {
  let next = source;
  if (!next.includes("omkAgentDef")) {
    const importMarker = "import { codexAgentDef } from './defs/codex.js';";
    if (!next.includes(importMarker)) {
      throw new Error("Open Design runtime registry import layout changed; cannot register OMK adapter safely.");
    }
    next = next.replace(importMarker, `${importMarker}\nimport { omkAgentDef } from './defs/omk.js';`);
  }
  if (!next.includes("  omkAgentDef,")) {
    const defMarker = "  codexAgentDef,";
    if (!next.includes(defMarker)) {
      throw new Error("Open Design runtime registry agent list changed; cannot register OMK adapter safely.");
    }
    next = next.replace(defMarker, `${defMarker}\n  omkAgentDef,`);
  }
  return next;
}

function patchOpenDesignRuntimeExecutablesSource(source: string): string {
  if (source.includes("['omk', 'OMK_BIN']")) return source;
  const marker = "  ['codex', 'CODEX_BIN'],";
  if (!source.includes(marker)) {
    throw new Error("Open Design runtime executables env-key layout changed; cannot register OMK_BIN safely.");
  }
  return source.replace(marker, `${marker}\n  ['omk', 'OMK_BIN'],`);
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

function isContainedPath(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || Boolean(rel && !rel.startsWith("..") && !isAbsolute(rel));
}

async function assertNoExistingSymlinkInOpenDesignPath(checkoutDir: string, target: string): Promise<void> {
  const root = resolve(checkoutDir);
  const resolvedTarget = resolve(target);
  if (!isContainedPath(root, resolvedTarget)) {
    throw new Error(`Refusing to write outside Open Design checkout: ${target}`);
  }

  const rel = relative(root, resolvedTarget);
  const parts = rel.split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (!(await pathExists(current))) continue;
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(`Refusing to follow symlink inside Open Design checkout: ${relative(root, current)}`);
    }
  }
}

async function patchOpenDesignFile(
  checkoutDir: string,
  relativePath: string,
  patcher: (source: string) => string,
  changedFiles: string[]
): Promise<void> {
  const target = join(checkoutDir, relativePath);
  if (!(await pathExists(target))) return;
  await assertNoExistingSymlinkInOpenDesignPath(checkoutDir, target);
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
  await assertNoExistingSymlinkInOpenDesignPath(checkoutDir, target);
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

async function ensureOpenDesignOmkIcon(checkoutDir: string, changedFiles: string[]): Promise<void> {
  await writeOpenDesignRelativeFileIfChanged(
    checkoutDir,
    "apps/web/public/agent-icons/omk.svg",
    OPEN_DESIGN_OMK_ICON_SVG,
    changedFiles
  );
}

async function ensureOpenDesignRuntimeRegistry(checkoutDir: string, changedFiles: string[]): Promise<boolean> {
  const registryPath = join(checkoutDir, "apps/daemon/src/runtimes/registry.ts");
  if (!(await pathExists(registryPath))) return false;

  await writeOpenDesignRelativeFileIfChanged(
    checkoutDir,
    "apps/daemon/src/runtimes/defs/omk.ts",
    OPEN_DESIGN_OMK_RUNTIME_AGENT_DEF,
    changedFiles
  );
  await patchOpenDesignFile(
    checkoutDir,
    "apps/daemon/src/runtimes/registry.ts",
    patchOpenDesignRuntimeRegistrySource,
    changedFiles
  );
  await patchOpenDesignFile(
    checkoutDir,
    "apps/daemon/src/runtimes/executables.ts",
    patchOpenDesignRuntimeExecutablesSource,
    changedFiles
  );
  return true;
}

type OpenDesignCompatibilityProfile = "runtime-registry" | "legacy-agents" | "route-shell";

async function verifyPatchCompatibility(
  checkoutDir: string,
  relativePath: string,
  patcher: (source: string) => string
): Promise<boolean> {
  const target = join(checkoutDir, relativePath);
  if (!(await pathExists(target))) return false;
  await assertNoExistingSymlinkInOpenDesignPath(checkoutDir, target);
  patcher(await readTextFile(target));
  return true;
}

async function requirePatchCompatibility(
  checkoutDir: string,
  relativePath: string,
  patcher: (source: string) => string
): Promise<void> {
  if (!(await verifyPatchCompatibility(checkoutDir, relativePath, patcher))) {
    throw new Error(`Open Design compatibility check failed: missing required file ${relativePath}.`);
  }
}

async function assertOpenDesignCompatibility(checkoutDir: string): Promise<OpenDesignCompatibilityProfile[]> {
  const packagePath = join(checkoutDir, "package.json");
  const hasPackage = await pathExists(packagePath);
  const hasDaemon = await pathExists(join(checkoutDir, "apps/daemon"));
  if (!hasPackage && !hasDaemon) return [];

  const packageName = hasPackage ? await readPackageName(packagePath) : null;
  if (hasPackage && packageName !== "open-design") {
    throw new Error(`Open Design compatibility check failed: expected package name "open-design", found "${packageName ?? "unknown"}".`);
  }

  const profiles: OpenDesignCompatibilityProfile[] = [];
  const hasRuntimeRegistry = await verifyPatchCompatibility(
    checkoutDir,
    "apps/daemon/src/runtimes/registry.ts",
    patchOpenDesignRuntimeRegistrySource
  );
  if (hasRuntimeRegistry) {
    await requirePatchCompatibility(checkoutDir, "apps/daemon/src/runtimes/executables.ts", patchOpenDesignRuntimeExecutablesSource);
    profiles.push("runtime-registry");
  } else if (await verifyPatchCompatibility(checkoutDir, "apps/daemon/src/agents.ts", patchOpenDesignAgentsSource)) {
    profiles.push("legacy-agents");
  } else {
    throw new Error("Open Design compatibility check failed: no supported runtime registry or legacy agents layout found.");
  }

  await requirePatchCompatibility(checkoutDir, "apps/daemon/src/app-config.ts", patchOpenDesignAppConfigSource);
  await requirePatchCompatibility(checkoutDir, "apps/web/src/components/SettingsDialog.tsx", patchOpenDesignSettingsSource);
  await requirePatchCompatibility(checkoutDir, "apps/web/src/utils/agentLabels.ts", patchOpenDesignAgentLabelsSource);
  await requirePatchCompatibility(checkoutDir, "apps/web/src/components/AgentIcon.tsx", patchOpenDesignAgentIconSource);
  profiles.push("route-shell");
  return profiles;
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
    await assertNoExistingSymlinkInOpenDesignPath(checkoutDir, optionalRouteDir);
    await rm(optionalRouteDir, { recursive: true, force: true });
    changedFiles.push("apps/web/app/[[...slug]]/");
    routeChanged = true;
  }

  if (routeChanged) {
    const tmpNextDir = join(checkoutDir, ".tmp/tools-dev/default/web/next");
    if (await pathExists(tmpNextDir)) {
      await assertNoExistingSymlinkInOpenDesignPath(checkoutDir, tmpNextDir);
      await rm(tmpNextDir, { recursive: true, force: true });
    }
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
  await assertNoExistingSymlinkInOpenDesignPath(checkoutDir, configPath);
  if (before !== after) {
    await writeFileSafe(configPath, `${after}\n`);
  }
  await chmod(configPath, 0o600).catch(() => {});
  return configPath;
}

export async function ensureOpenDesignOmkBridge(checkoutDir: string): Promise<OpenDesignOmkBridgeResult> {
  const changedFiles: string[] = [];
  const compatibilityProfiles = await assertOpenDesignCompatibility(checkoutDir);
  const usesRuntimeRegistry = await ensureOpenDesignRuntimeRegistry(checkoutDir, changedFiles);
  if (!usesRuntimeRegistry) {
    await patchOpenDesignFile(checkoutDir, "apps/daemon/src/agents.ts", patchOpenDesignAgentsSource, changedFiles);
  }
  await patchOpenDesignFile(checkoutDir, "apps/daemon/src/app-config.ts", patchOpenDesignAppConfigSource, changedFiles);
  await patchOpenDesignFile(checkoutDir, "apps/web/src/components/SettingsDialog.tsx", patchOpenDesignSettingsSource, changedFiles);
  await patchOpenDesignFile(checkoutDir, "apps/web/src/utils/agentLabels.ts", patchOpenDesignAgentLabelsSource, changedFiles);
  await patchOpenDesignFile(checkoutDir, "apps/web/src/components/AgentIcon.tsx", patchOpenDesignAgentIconSource, changedFiles);
  await ensureOpenDesignOmkIcon(checkoutDir, changedFiles);
  await ensureOpenDesignSpaRoutes(checkoutDir, changedFiles);
  await patchOpenDesignI18n(checkoutDir, changedFiles);
  await ensureOpenDesignAwesomeDesignMdPromptTemplate(checkoutDir, changedFiles);
  const omkBin = await resolveCurrentOmkBin();
  const appConfigPath = await writeOpenDesignOmkAppConfig(checkoutDir, omkBin);
  return { changedFiles, appConfigPath, omkBin, compatibilityProfiles };
}

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function formatOpenDesignClonePlan(options: OpenDesignResolvedOptions): string {
  if (options.ref === options.branch) {
    return formatCommand("git", ["clone", "--depth", "1", "--branch", options.branch, OPEN_DESIGN_REPO_URL, options.dir]);
  }
  return [
    formatCommand("git", ["clone", "--depth", "1", OPEN_DESIGN_REPO_URL, options.dir]),
    formatCommand("git", ["-C", options.dir, "fetch", "--depth", "1", "origin", options.ref]),
    formatCommand("git", ["-C", options.dir, "checkout", "--detach", "FETCH_HEAD"]),
  ].join(" && ");
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

function requireOpenDesignNodeRuntime(): OpenDesignNodeRuntime {
  const runtime = resolveOpenDesignNodeRuntime();
  if (runtime) {
    if (runtime.nodeCommand) {
      console.log(status.warn(`Using Node.js 24 runtime for Open Design: ${runtime.nodeCommand}`));
    }
    return runtime;
  }

  console.error(status.error(`Open Design requires Node.js 24.x; current Node is ${process.version}.`));
  console.error(style.gray("  Example: fnm install 24 && fnm use 24"));
  console.error(style.gray("  Or set OMK_OPEN_DESIGN_NODE24=/absolute/path/to/node"));
  process.exit(1);
}

async function ensureOpenDesignCheckout(options: OpenDesignResolvedOptions): Promise<void> {
  const packagePath = join(options.dir, "package.json");
  if (await pathExists(packagePath)) {
    const checkoutStat = await lstat(options.dir);
    if (checkoutStat.isSymbolicLink()) {
      console.error(status.error(`Refusing symlinked Open Design checkout: ${options.dir}`));
      process.exit(1);
    }
    const packageName = await readPackageName(packagePath);
    if (packageName !== "open-design") {
      console.error(status.error(`Existing directory is not an Open Design checkout: ${options.dir}`));
      console.error(style.gray("  Pass --dir to an empty directory or an existing nexu-io/open-design checkout."));
      process.exit(1);
    }

    if (await pathExists(join(options.dir, ".git"))) {
      const remote = await runShell("git", ["-C", options.dir, "remote", "get-url", "origin"], { timeout: 10000 });
      if (!remote.failed && !/github\.com[:/]nexu-io\/open-design(?:\.git)?$/i.test(remote.stdout.trim())) {
        const message = "Existing Open Design checkout origin is not nexu-io/open-design.";
        console.error(process.env.OMK_OPEN_DESIGN_TRUST_CHECKOUT === "1" ? status.warn(message) : status.error(message));
        console.error(style.gray("  Pass --dir to a trusted nexu-io/open-design checkout or set OMK_OPEN_DESIGN_TRUST_CHECKOUT=1."));
        if (process.env.OMK_OPEN_DESIGN_TRUST_CHECKOUT !== "1") process.exit(1);
      }
    }

    if (options.update && await pathExists(join(options.dir, ".git"))) {
      console.log(style.gray("Updating Open Design checkout…"));
      const update = options.ref === options.branch
        ? await runShell("git", ["-C", options.dir, "pull", "--ff-only"], { timeout: 120000 })
        : await runShell("git", ["-C", options.dir, "fetch", "--depth", "1", "origin", options.ref], { timeout: 120000 });
      if (update.failed) {
        console.error(status.error("Open Design update failed."));
        console.error(update.stderr || update.stdout);
        process.exit(update.exitCode);
      }
      if (options.ref !== options.branch) {
        const checkout = await runShell("git", ["-C", options.dir, "checkout", "--detach", "FETCH_HEAD"], { timeout: 60000 });
        if (checkout.failed) {
          console.error(status.error("Open Design ref checkout failed."));
          console.error(checkout.stderr || checkout.stdout);
          process.exit(checkout.exitCode);
        }
      }
    }
    return;
  }

  await mkdir(dirname(options.dir), { recursive: true });
  console.log(style.gray(`Cloning Open Design into ${options.dir}…`));
  const cloneArgs = options.ref === options.branch
    ? ["clone", "--depth", "1", "--branch", options.branch, OPEN_DESIGN_REPO_URL, options.dir]
    : ["clone", "--depth", "1", OPEN_DESIGN_REPO_URL, options.dir];
  const clone = await runShell("git", cloneArgs, { timeout: 180000, stdio: "inherit" });
  if (clone.failed) {
    console.error(status.error("Open Design clone failed."));
    process.exit(clone.exitCode);
  }
  if (options.ref !== options.branch) {
    const fetch = await runShell("git", ["-C", options.dir, "fetch", "--depth", "1", "origin", options.ref], { timeout: 120000, stdio: "inherit" });
    if (fetch.failed) {
      console.error(status.error(`Open Design ref fetch failed: ${options.ref}`));
      process.exit(fetch.exitCode);
    }
    const checkout = await runShell("git", ["-C", options.dir, "checkout", "--detach", "FETCH_HEAD"], { timeout: 60000, stdio: "inherit" });
    if (checkout.failed) {
      console.error(status.error(`Open Design ref checkout failed: ${options.ref}`));
      process.exit(checkout.exitCode);
    }
  }
}

async function installOpenDesignDependencies(options: OpenDesignResolvedOptions, runtime: OpenDesignNodeRuntime): Promise<void> {
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
  const install = await runShell(runtime.corepackCommand, ["pnpm", "install", "--frozen-lockfile"], {
    cwd: options.dir,
    env: runtime.env,
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

interface OpenDesignDoctorCheck {
  id: string;
  ok: boolean;
  severity: "error" | "warn" | "info";
  message: string;
  fix?: string;
}

interface OpenDesignDoctorReport {
  ok: boolean;
  command: "design open-design --doctor";
  testedRef: string;
  ref: string;
  dir: string;
  webPort: string;
  daemonPort: string;
  checks: OpenDesignDoctorCheck[];
}

async function isLocalPortAvailable(port: string): Promise<boolean> {
  return await new Promise<boolean>((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(Number(port), "127.0.0.1");
  });
}

function doctorCheck(checks: OpenDesignDoctorCheck[], check: OpenDesignDoctorCheck): void {
  checks.push(check);
}

async function buildOpenDesignDoctorReport(options: OpenDesignResolvedOptions): Promise<OpenDesignDoctorReport> {
  const checks: OpenDesignDoctorCheck[] = [];
  const nodeRuntime = resolveOpenDesignNodeRuntime();
  doctorCheck(checks, {
    id: "node24",
    ok: Boolean(nodeRuntime),
    severity: "error",
    message: nodeRuntime
      ? `Node.js 24 runtime available${nodeRuntime.nodeCommand ? ` at ${nodeRuntime.nodeCommand}` : ""}.`
      : `Open Design requires Node.js 24.x; current OMK Node is ${process.version}.`,
    fix: nodeRuntime ? undefined : "Install Node 24 or set OMK_OPEN_DESIGN_NODE24=/absolute/path/to/node.",
  });

  doctorCheck(checks, {
    id: "git",
    ok: await checkCommand("git"),
    severity: "error",
    message: "git is required to clone or update nexu-io/open-design.",
    fix: "Install git and rerun omk design open-design.",
  });

  const corepackCommand = nodeRuntime?.corepackCommand ?? "corepack";
  const hasCorepack = await checkCommand(corepackCommand);
  doctorCheck(checks, {
    id: "corepack",
    ok: hasCorepack,
    severity: "error",
    message: `Corepack command ${corepackCommand} is required for pnpm.`,
    fix: "Enable Corepack with corepack enable, or use a Node 24 install that includes corepack.",
  });
  const pnpm = hasCorepack
    ? await runShell(corepackCommand, ["pnpm", "--version"], { env: nodeRuntime?.env, timeout: 15000 })
    : { failed: true, stdout: "", stderr: "", exitCode: 1 };
  doctorCheck(checks, {
    id: "pnpm",
    ok: !pnpm.failed,
    severity: "error",
    message: !pnpm.failed ? `pnpm available through Corepack (${pnpm.stdout.trim()}).` : "pnpm is not available through Corepack.",
    fix: !pnpm.failed ? undefined : "Run corepack enable, then corepack pnpm --version.",
  });

  for (const [id, port] of [["daemon-port", options.daemonPort], ["web-port", options.webPort]] as const) {
    const available = await isLocalPortAvailable(port);
    doctorCheck(checks, {
      id,
      ok: available,
      severity: "error",
      message: available ? `localhost:${port} is available.` : `localhost:${port} is already in use.`,
      fix: available ? undefined : `Pass a free --${id} value or stop the process using port ${port}.`,
    });
  }

  const packagePath = join(options.dir, "package.json");
  if (await pathExists(packagePath)) {
    const packageName = await readPackageName(packagePath);
    doctorCheck(checks, {
      id: "checkout-package",
      ok: packageName === "open-design",
      severity: "error",
      message: packageName === "open-design" ? `Open Design checkout found at ${options.dir}.` : `Checkout package name is ${packageName ?? "unknown"}.`,
      fix: packageName === "open-design" ? undefined : "Pass --dir to a nexu-io/open-design checkout or remove the invalid directory.",
    });
    try {
      const profiles = await assertOpenDesignCompatibility(options.dir);
      doctorCheck(checks, {
        id: "upstream-layout",
        ok: profiles.length > 0,
        severity: "error",
        message: profiles.length > 0 ? `Compatible layout profiles: ${profiles.join(", ")}.` : "Open Design layout not detected.",
        fix: profiles.length > 0 ? undefined : "Use a supported nexu-io/open-design ref or update OMK patch anchors.",
      });
    } catch (err) {
      doctorCheck(checks, {
        id: "upstream-layout",
        ok: false,
        severity: "error",
        message: err instanceof Error ? err.message : String(err),
        fix: `Try --ref ${OPEN_DESIGN_TESTED_REF} or update OMK Open Design compatibility anchors.`,
      });
    }
    const appConfigPath = join(options.dir, ".od", "app-config.json");
    doctorCheck(checks, {
      id: "app-config",
      ok: await pathExists(appConfigPath),
      severity: "warn",
      message: await pathExists(appConfigPath) ? "Open Design app-config exists." : "Open Design app-config has not been written yet.",
      fix: "Run omk design open-design once to register OMK in .od/app-config.json.",
    });
    const promptPath = join(options.dir, "prompt-templates/image/awesome-design-md-web-ui.json");
    doctorCheck(checks, {
      id: "prompt-template",
      ok: await pathExists(promptPath),
      severity: "warn",
      message: await pathExists(promptPath) ? "OMK prompt template exists." : "OMK prompt template is not installed yet.",
      fix: "Run omk design open-design once to install the template.",
    });
  } else {
    doctorCheck(checks, {
      id: "checkout-package",
      ok: false,
      severity: "warn",
      message: `No Open Design checkout at ${options.dir}.`,
      fix: "Run omk design open-design to clone it, or pass --dir to an existing checkout.",
    });
  }

  const omkBin = await resolveCurrentOmkBin();
  doctorCheck(checks, {
    id: "omk-bin",
    ok: Boolean(omkBin),
    severity: "error",
    message: omkBin ? `OMK_BIN resolves to ${omkBin}.` : "OMK executable could not be resolved.",
    fix: omkBin ? undefined : "Set OMK_BIN=/absolute/path/to/omk or install omk on PATH.",
  });
  if (omkBin) {
    const smoke = await runShell(omkBin, ["open-design-agent", "--smoke"], { timeout: 10000 });
    doctorCheck(checks, {
      id: "smoke-path",
      ok: !smoke.failed && smoke.stdout.trim() === "ok",
      severity: "error",
      message: !smoke.failed && smoke.stdout.trim() === "ok" ? "open-design-agent --smoke returns ok." : "open-design-agent --smoke failed.",
      fix: "Run omk open-design-agent --smoke and fix CLI installation/runtime errors.",
    });
  }

  const ok = checks.every((check) => check.ok || check.severity !== "error");
  return {
    ok,
    command: "design open-design --doctor",
    testedRef: OPEN_DESIGN_TESTED_REF,
    ref: options.ref,
    dir: options.dir,
    webPort: options.webPort,
    daemonPort: options.daemonPort,
    checks,
  };
}

async function runOpenDesignDoctor(options: OpenDesignResolvedOptions, json = false): Promise<void> {
  const report = await buildOpenDesignDoctorReport(options);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(header("Open Design bridge doctor"));
    for (const check of report.checks) {
      const line = check.ok ? status.ok(check.message) : check.severity === "warn" ? status.warn(check.message) : status.error(check.message);
      console.log(line);
      if (!check.ok && check.fix) console.log(style.gray(`  Fix: ${check.fix}`));
    }
  }
  if (!report.ok) process.exitCode = 1;
}

function printOpenDesignPlan(options: OpenDesignResolvedOptions): void {
  const args = buildOpenDesignToolsDevArgs(options);
  console.log(header("Open Design localhost"));
  console.log(style.gray("Launch plan (no changes made):"));
  console.log(`  Repo: ${options.dir}`);
  console.log(`  Ref:  ${options.ref} (tested: ${OPEN_DESIGN_TESTED_REF})`);
  console.log(`  Web:  http://localhost:${options.webPort}`);
  console.log("  Agent: OMK CLI (local bridge; avoids Kimi ACP smoke-test timeout)");
  console.log(`  Clone: ${formatOpenDesignClonePlan(options)}`);
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
  primary: "${DESIGN_SCAFFOLD.primary}"
  secondary: "${DESIGN_SCAFFOLD.secondary}"
  accent: "${DESIGN_SCAFFOLD.accent}"
  success: "${DESIGN_SCAFFOLD.success}"
  warning: "${DESIGN_SCAFFOLD.warning}"
  danger: "${DESIGN_SCAFFOLD.danger}"
  background: "${DESIGN_SCAFFOLD.background}"
  surface: "${DESIGN_SCAFFOLD.surface}"
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

  if (options.doctor) {
    await runOpenDesignDoctor(resolved, options.json === true);
    return;
  }

  if (resolved.printOnly) {
    printOpenDesignPlan(resolved);
    return;
  }

  const nodeRuntime = requireOpenDesignNodeRuntime();
  await requireCommand("git", "Install git, then rerun: omk design open-design");
  await requireCommand(nodeRuntime.corepackCommand, "Install/enable Node Corepack, then rerun: corepack enable");

  const corepack = await runShell(nodeRuntime.corepackCommand, ["enable"], { env: nodeRuntime.env, timeout: 60000 });
  if (corepack.failed) {
    console.log(status.warn("corepack enable failed; continuing because Corepack may already be active."));
  }

  await ensureOpenDesignCheckout(resolved);
  const bridge = await ensureOpenDesignOmkBridge(resolved.dir);
  await installOpenDesignDependencies(resolved, nodeRuntime);

  const webUrl = `http://localhost:${resolved.webPort}`;
  const args = buildOpenDesignToolsDevArgs(resolved);

  console.log(header("Open Design"));
  if (bridge.changedFiles.length > 0) {
    console.log(status.ok(`OMK CLI adapter registered (${bridge.changedFiles.join(", ")}).`));
  } else {
    console.log(status.ok("OMK CLI adapter already registered."));
  }
  console.log(style.gray(`Default local agent: OMK CLI${bridge.omkBin ? ` (${bridge.omkBin})` : ""}`));
  console.log(style.gray(`Open Design ref: ${resolved.ref} (tested ${OPEN_DESIGN_TESTED_REF})`));
  console.log(style.gray(`App config: ${bridge.appConfigPath}`));
  console.log(style.gray(`Starting local Open Design daemon + web at ${webUrl}…`));
  console.log(style.gray(`Command: ${formatCommand(nodeRuntime.corepackCommand, args)}`));

  const launch = await runShell(nodeRuntime.corepackCommand, args, {
    cwd: resolved.dir,
    env: nodeRuntime.env,
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
