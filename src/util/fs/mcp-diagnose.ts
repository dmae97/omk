import { homedir } from "os";
import { join } from "path";
import type { OmkRuntimeScope } from "../resource-profile.js";
import { pathExists } from "./core.js";
import { getProjectRoot, getProjectRootAsync, getUserHome } from "./paths.js";
import {
  basenameOfRuntimeCommand,
  hasHttpTransportMismatch,
  isRecord,
  isShellInlineMcpArg,
  runtimeShellInlineScripts,
} from "./internal.js";

export interface RuntimeMcpPruneDiagnostic {
  name: string;
  kind: string;
  message: string;
}

export interface RuntimeMcpNormalization {
  name: string;
  kind: string;
  message: string;
}

/** Canonical OMK MCP config collection with project `.kimi/mcp.json` compatibility. */
export async function collectMcpConfigs(scope: OmkRuntimeScope = "project"): Promise<string[]> {
  const configs: string[] = [];
  if (scope === "none") return configs;

  const root = await getProjectRootAsync();
  const home = getUserHome();
  const projectOmkMcp = join(root, ".omk", "mcp.json");
  const projectKimiMcp = join(root, ".kimi", "mcp.json");
  const globalAgentMcp = join(home, ".omk", "agent", "mcp.json");
  const globalOmkMcp = join(home, ".omk", "mcp.json");
  const globalKimiMcp = join(home, ".kimi", "mcp.json");

  // Precedence is left-to-right with later files winning during runtime merge:
  // global first, project second. Project `.kimi/mcp.json` is the active
  // compatibility surface; `.omk/mcp.json` is used only as a project fallback
  // when the `.kimi` companion does not exist.
  if (scope === "all") {
    for (const candidate of [globalAgentMcp, globalOmkMcp, globalKimiMcp]) {
      if (await pathExists(candidate)) configs.push(candidate);
    }
  }

  if (await pathExists(projectKimiMcp)) {
    configs.push(projectKimiMcp);
  } else if (await pathExists(projectOmkMcp)) {
    configs.push(projectOmkMcp);
  }

  return [...new Set(configs)];
}

const SHELL_BUILTIN_MCP_COMMANDS = new Set([
  "set",
  "source",
  "export",
  "alias",
  "cd",
  "copy",
  "del",
  "dir",
  "move",
  "start",
]);

const WINDOWS_SYSTEM32_SET_RE = /(?:^|\/)mnt\/[a-z]\/windows\/system32\/set(?:\.exe)?(?:\s|$|[;&|])/i;
const POSIX_HOME_REF_RE = /\/home\/([A-Za-z0-9._-]+)(?:\/|$)/g;

const HOST_HOME = homedir();

export const STALE_PACKAGE_NAMES: Record<string, string> = {
  "@supabase/mcp-server@latest": "@supabase/mcp-server-supabase@latest",
};

function isRuntimePathLike(value: string): boolean {
  return value.startsWith("/")
    || value.startsWith("~/")
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith("\\\\");
}

function expandRuntimeUserPath(value: string): string {
  if (value === "~") return getUserHome();
  if (value.startsWith("~/")) return join(getUserHome(), value.slice(2));
  return value;
}

function allowedRuntimeHomes(): string[] {
  return [
    getUserHome(),
    HOST_HOME,
    homedir(),
    posixHomeRoot(process.execPath),
    posixHomeRoot(process.argv[1]),
    posixHomeRoot(getProjectRoot()),
  ]
    .map((home) => home.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter((home, index, homes) => home.length > 0 && homes.indexOf(home) === index);
}

function posixHomeRoot(value: string | undefined): string {
  const match = value?.replace(/\\/g, "/").match(/^\/home\/[A-Za-z0-9._-]+(?:\/|$)/);
  return match ? match[0].replace(/\/$/, "") : "";
}

function containsStaleHomeReference(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  for (const match of normalized.matchAll(POSIX_HOME_REF_RE)) {
    const referencedHome = `/home/${match[1]}`;
    const allowed = allowedRuntimeHomes().some((home) => {
      const normalizedHome = home.replace(/\\/g, "/").replace(/\/+$/, "");
      return normalizedHome === referencedHome || normalizedHome.startsWith(`${referencedHome}/`);
    });
    if (!allowed) return true;
  }
  return false;
}

function shouldValidateRuntimeMcpArgPath(server: Record<string, unknown>, arg: unknown, index: number): arg is string {
  if (typeof arg !== "string") return false;
  if (!arg || arg.startsWith("-") || arg.startsWith("$") || /^https?:\/\//i.test(arg)) return false;
  if (isShellInlineMcpArg(server, index)) return false;
  if (/[ \t\r\n;"'|&<>]/.test(arg)) return false;
  return isRuntimePathLike(arg);
}

function findInlineScriptPaths(script: string): string[] {
  const paths = new Set<string>();
  const re = /(?:^|[\s"'`=:(])((?:~|\/)[^\s"'`|&;<>:]+?\.(?:cjs|mjs|js|py))(?:$|[\s"'`),;|&<>:])/gi;
  for (const match of script.matchAll(re)) {
    const candidate = match[1];
    if (!candidate || /[*?[\]{}$]/.test(candidate)) continue;
    paths.add(candidate);
  }
  return [...paths];
}

export async function diagnoseRuntimeMcpServer(
  name: string,
  server: unknown
): Promise<RuntimeMcpPruneDiagnostic[]> {
  const diagnostics: RuntimeMcpPruneDiagnostic[] = [];
  if (!isRecord(server)) {
    return [{ name, kind: "invalid-server", message: "server definition must be an object" }];
  }
  if (server.enabled === false) {
    return [{ name, kind: "disabled-server", message: "server is disabled" }];
  }
  if (typeof server.url === "string" && server.url.trim()) {
    return diagnostics;
  }

  const command = typeof server.command === "string" ? server.command.trim() : "";
  if (!command) {
    return [{ name, kind: "missing-command", message: "stdio server has no command" }];
  }

  const commandName = basenameOfRuntimeCommand(command);
  if (SHELL_BUILTIN_MCP_COMMANDS.has(commandName)) {
    diagnostics.push({
      name,
      kind: "shell-builtin-command",
      message: "shell built-in was configured as the MCP command; wrap it in a shell or move values to env",
    });
  }
  if (hasHttpTransportMismatch(name, server)) {
    diagnostics.push({
      name,
      kind: "stdio-http-transport",
      message: "stdio MCP config starts an HTTP MCP server that writes startup logs to stdout; configure it as a remote url or use stdio transport",
    });
  }

  if (isRuntimePathLike(command)) {
    const commandPath = expandRuntimeUserPath(command);
    if (containsStaleHomeReference(commandPath)) {
      diagnostics.push({ name, kind: "stale-home-reference", message: "MCP config references a different user home path" });
    }
    if (!(await pathExists(commandPath))) {
      diagnostics.push({ name, kind: "command-path-not-found", message: "configured command path does not exist" });
    }
  }

  for (const script of runtimeShellInlineScripts(server)) {
    if (containsStaleHomeReference(script)) {
      diagnostics.push({ name, kind: "stale-home-reference", message: "MCP config references a different user home path" });
    }
    if (WINDOWS_SYSTEM32_SET_RE.test(script.replace(/\\/g, "/"))) {
      diagnostics.push({
        name,
        kind: "windows-set-inline",
        message: "Windows System32 set was embedded in a shell MCP command and cannot be launched from WSL",
      });
    }
    for (const candidate of findInlineScriptPaths(script)) {
      const expanded = expandRuntimeUserPath(candidate);
      if (containsStaleHomeReference(expanded)) {
        diagnostics.push({ name, kind: "stale-home-reference", message: "MCP config references a different user home path" });
      }
      if (!(await pathExists(expanded))) {
        diagnostics.push({ name, kind: "inline-script-path-not-found", message: "inline MCP script references a missing local script" });
      }
    }
  }

  const args = Array.isArray(server.args) ? server.args : [];
  for (const [index, arg] of args.entries()) {
    if (!shouldValidateRuntimeMcpArgPath(server, arg, index)) continue;
    const argPath = expandRuntimeUserPath(arg);
    if (containsStaleHomeReference(argPath)) {
      diagnostics.push({ name, kind: "stale-home-reference", message: "MCP config references a different user home path" });
    }
    if (!(await pathExists(argPath))) {
      diagnostics.push({ name, kind: "arg-path-not-found", message: "MCP argument path does not exist" });
    }
  }

  // Detect known renamed/broken npm package names in MCP server args
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    for (const [stale, current] of Object.entries(STALE_PACKAGE_NAMES)) {
      if (arg.includes(stale)) {
        diagnostics.push({
          name,
          kind: "stale-package-name",
          message: `MCP server package was renamed: ${stale} → ${current}. Run \`omk mcp migrate\` to auto-fix, or update the config manually.`,
        });
      }
    }
  }

  return diagnostics;
}
