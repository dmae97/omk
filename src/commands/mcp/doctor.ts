import { join, isAbsolute } from "path";
import { which } from "../../util/shell.js";
import {
  collectMcpConfigs,
  diagnoseRuntimeMcpServer,
  pathExists,
  getUserHome,
  preflightRuntimeMcpServers,
  resolveRuntimeMcpPreflightOptions,
} from "../../util/fs.js";
import { getOmkResourceSettings } from "../../util/resource-profile.js";
import { style, header, status, label } from "../../util/theme.js";
import { maskSensitiveText } from "../../util/secret-mask.js";
import {
  basenameOfCommand,
  collectServers,
  isHttpUrl,
  isRailwayMcpServer,
  isSupabaseMcpServer,
  normalizeMcpEnv,
  RAILWAY_REMOTE_MCP_URL,
  resolveAllConfigs,
  sanitizeMcpUrlForDisplay,
  selectEffectiveServer,
  serverTargetText,
  validateRemoteMcpUrl,
  type McpServerConfig,
} from "./shared.js";
import { repairMcpDoctorIssues, type McpDoctorFixReport } from "./doctor-fix.js";

export interface McpDoctorOptions {
  json?: boolean;
  fix?: boolean;
  dryRun?: boolean;
  global?: boolean;
}

type McpDoctorSeverity = "ok" | "info" | "warn" | "error";

export interface McpDoctorCheck {
  severity: McpDoctorSeverity;
  kind: string;
  message: string;
}

export interface McpDoctorSourceReport {
  path: string;
  exists: boolean;
  active: boolean;
  parsed: boolean;
  status: "ok" | "empty" | "error";
  serverCount: number;
  error?: string;
}

export interface McpDoctorServerReport {
  name: string;
  status: "ok" | "warn" | "error";
  active: boolean;
  sources: string[];
  activeSources: string[];
  transport: "remote" | "stdio" | "invalid";
  url?: string;
  command?: string;
  resolvedCommand?: string;
  timeoutSec?: number;
  checks: McpDoctorCheck[];
}

export interface McpDoctorReport {
  ok: boolean;
  command: "mcp doctor";
  checkedAt: string;
  activeScope: string;
  issueCount: number;
  errors: string[];
  warnings: string[];
  fixes?: McpDoctorFixReport;
  sources: McpDoctorSourceReport[];
  servers: McpDoctorServerReport[];
  data: {
    activeScope: string;
    sourceCount: number;
    serverCount: number;
  };
}

export async function mcpDoctorCommand(options: McpDoctorOptions = {}): Promise<void> {
  const fixes = options.fix
    ? await repairMcpDoctorIssues({
        dryRun: Boolean(options.dryRun),
        global: Boolean(options.global),
      })
    : undefined;
  const report = await buildMcpDoctorReport();
  if (fixes) report.fixes = fixes;

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  emitMcpDoctorText(report);
  if (!report.ok) process.exitCode = 1;
}

export async function buildMcpDoctorReport(): Promise<McpDoctorReport> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);
  const resources = await getOmkResourceSettings();
  const activePathOrder = await collectMcpConfigs(resources.mcpScope);
  const activePaths = new Set(activePathOrder);
  const globalMcpPath = join(getUserHome(), ".kimi", "mcp.json");
  const preflightEntriesByName = new Map<string, {
    status: string;
    reason?: string;
    detail?: string;
    packageSpec?: string;
  }>();
  const preflightOptions = resolveRuntimeMcpPreflightOptions();
  if (preflightOptions.mode !== "off") {
    const activeServersForPreflight: Record<string, unknown> = {};
    for (const [name, info] of servers) {
      const activeSources = info.sources.filter((source) => activePaths.has(source));
      if (activeSources.length === 0) continue;
      activeServersForPreflight[name] = selectEffectiveServer(info, activePathOrder);
    }
    const preflight = await preflightRuntimeMcpServers(activeServersForPreflight, preflightOptions);
    for (const entry of preflight.entries) {
      preflightEntriesByName.set(entry.name, entry);
    }
  }

  const sourceReports: McpDoctorSourceReport[] = sources.map((src) => {
    const serverCount = src.parsed ? Object.keys(src.config.mcpServers ?? {}).length : 0;
      const sourceReport: McpDoctorSourceReport = {
        path: src.path,
        exists: src.exists,
        active: activePaths.has(src.path),
        parsed: src.parsed,
        status: !src.parsed ? "error" : !src.exists || serverCount === 0 ? "empty" : "ok",
        serverCount,
        error: src.error ? maskSensitiveText(src.error) : undefined,
    };
    return sourceReport;
  });

  const serverReports: McpDoctorServerReport[] = [];
  for (const [name, info] of servers) {
    const server = selectEffectiveServer(info, activePathOrder);
    const checks: McpDoctorCheck[] = [];
    const activeSources = info.sources.filter((source) => activePaths.has(source));
    const active = activeSources.length > 0;
    let resolvedCommand: string | undefined;

    if (activeSources.length > 1) {
      if (name === "omk-project") {
        checks.push({
          severity: "info",
          kind: "managed-duplicate",
          message: `managed omk-project mirror duplicate: ${activeSources.join(", ")} (expected; remove one manually if desired)`,
        });
      } else if (activeSources.includes(globalMcpPath) && activeSources.some((source) => source !== globalMcpPath)) {
        checks.push({
          severity: "info",
          kind: "project-overrides-global",
          message: `active duplicate spans global/project; project override is effective: ${activeSources.join(", ")}`,
        });
      } else {
        checks.push({
          severity: "error",
          kind: "active-duplicate",
          message: `active duplicate definition in: ${activeSources.join(", ")} — run \`omk mcp remove ${name}\` to delete the local copy, or edit the files manually`,
        });
      }
    } else if (info.sources.length > 1) {
      checks.push({
        severity: "info",
        kind: "inactive-duplicate",
        message: `duplicate mirror outside active scope: ${info.sources.join(", ")} (only the active scope config is used)`,
      });
    }

    if (!active) {
      serverReports.push({
        name,
        status: "ok",
        active,
        sources: info.sources,
        activeSources,
        transport: server.url ? "remote" : server.command ? "stdio" : "invalid",
        url: server.url ? sanitizeMcpUrlForDisplay(server.url) : undefined,
        command: server.command ? maskSensitiveText(server.command) : undefined,
        resolvedCommand,
        timeoutSec: server.startup_timeout_sec,
        checks,
      });
      continue;
    }

    if (server.url) {
      const urlCheck = validateRemoteMcpUrl(server.url);
      if (urlCheck.ok) {
        checks.push({ severity: "ok", kind: "url", message: `url: ${sanitizeMcpUrlForDisplay(server.url)}` });
      } else {
        checks.push({ severity: "error", kind: "invalid-url", message: `invalid url: ${maskSensitiveText(urlCheck.message)}` });
      }
    } else if (!server.command) {
      checks.push({ severity: "error", kind: "missing-command", message: "missing command" });
    } else {
      const resolved = await which(server.command);
      if (resolved.failed) {
        checks.push({ severity: "error", kind: "command-not-found", message: `command not found: ${maskSensitiveText(server.command)}` });
      } else {
        resolvedCommand = resolved.stdout.trim();
        checks.push({ severity: "ok", kind: "command", message: `command: ${maskSensitiveText(resolvedCommand)}` });
      }
    }

    if (!server.url && server.args) {
      for (const [index, arg] of server.args.entries()) {
        if (!shouldValidateArgPath(server, arg, index)) continue;
        if (!isAbsolute(arg) && !arg.includes("/") && !arg.includes("\\")) continue;
        const exists = await pathExists(arg);
        const displayArg = maskSensitiveText(arg);
        checks.push(exists
          ? { severity: "ok", kind: "arg-path", message: `arg path: ${displayArg}` }
          : { severity: "error", kind: "arg-path-not-found", message: `arg path not found: ${displayArg}` });
      }
    }

    const env = normalizeMcpEnv(server.env);
    for (const [key, value] of Object.entries(env)) {
      if (value.startsWith("${") && value.endsWith("}")) {
        const envName = value.slice(2, -1);
        if (!process.env[envName]) {
          checks.push({ severity: "warn", kind: "env-reference-undefined", message: `env reference undefined: ${key} → ${envName}` });
        }
      }
    }

    for (const check of stdioProtocolChecksForServer(server)) {
      checks.push(check);
    }

    const runtimeDiagnostics = await diagnoseRuntimeMcpServer(name, server);
    for (const diagnostic of runtimeDiagnostics) {
      if (["missing-command", "command-path-not-found", "arg-path-not-found"].includes(diagnostic.kind)) continue;
      checks.push({
        severity: diagnostic.kind === "disabled-server" ? "info" : "error",
        kind: `runtime-${diagnostic.kind}`,
        message: `runtime startup blocker: ${diagnostic.message}`,
      });
    }

    const stabilityHints = stabilityHintsForServer(name, server);
    for (const hint of stabilityHints) {
      checks.push({ severity: "info", kind: "stability", message: `stability: ${hint}` });
    }

    const preflightEntry = preflightEntriesByName.get(name);
    if (preflightEntry?.status === "failed") {
      checks.push(...preflightChecksForDoctor(preflightEntry));
    }

    const hasError = checks.some((check) => check.severity === "error");
    const hasWarn = checks.some((check) => check.severity === "warn");

    serverReports.push({
      name,
      status: hasError ? "error" : hasWarn ? "warn" : "ok",
      active,
      sources: info.sources,
      activeSources,
      transport: server.url ? "remote" : server.command ? "stdio" : "invalid",
      url: server.url ? sanitizeMcpUrlForDisplay(server.url) : undefined,
      command: server.command ? maskSensitiveText(server.command) : undefined,
      resolvedCommand,
      timeoutSec: server.startup_timeout_sec,
      checks,
    });
  }

  if (resources.mcpScope !== "none" && !servers.has("omk-project")) {
    serverReports.push({
      name: "omk-project",
      status: "ok",
      active: true,
      sources: ["runtime:auto-injected"],
      activeSources: ["runtime:auto-injected"],
      transport: "stdio",
      command: "omk mcp serve omk-project",
      checks: [{
        severity: "info",
        kind: "virtual-runtime-injected",
        message: "virtual runtime MCP injected; not stored in .kimi/mcp.json or .omk/mcp.json",
      }],
    });
  }

  const errors = [
    ...sourceReports
      .filter((source) => source.status === "error" && activePaths.has(source.path))
      .map((source) => maskSensitiveText(`${source.path}: ${source.error ?? "invalid MCP config"}`)),
    ...serverReports.flatMap((server) =>
      server.checks
        .filter((check) => check.severity === "error")
        .map((check) => maskSensitiveText(`${server.name}: ${check.message}`))
    ),
  ];
  const warnings = serverReports.flatMap((server) =>
    server.checks
      .filter((check) => check.severity === "warn")
      .map((check) => maskSensitiveText(`${server.name}: ${check.message}`))
  );

  return {
    ok: errors.length === 0,
    command: "mcp doctor",
    checkedAt: new Date().toISOString(),
    activeScope: resources.mcpScope,
    issueCount: errors.length,
    errors,
    warnings,
    sources: sourceReports,
    servers: serverReports,
    data: {
      activeScope: resources.mcpScope,
      sourceCount: sourceReports.length,
      serverCount: serverReports.length,
    },
  };
}

function emitMcpDoctorText(report: McpDoctorReport): void {
  console.log(header("MCP Doctor"));
  console.log(style.gray(`Active MCP scope: ${report.activeScope}`));

  for (const src of report.sources) {
    if (src.status === "error") {
      const line = `${src.path}: ${src.error}`;
      console.log(src.active ? status.error(line) : style.gray(`${line} (inactive)`));
    } else if (src.status === "empty") {
      const suffix = !src.exists ? "not found" : "no mcpServers defined";
      console.log(style.gray(`${src.path}: ${suffix}${src.active ? "" : " (inactive)"}`));
    } else {
      console.log(src.active ? status.ok(`${src.path}`) : style.gray(`${src.path} (inactive)`));
    }
  }

  if (report.servers.length === 0) {
    console.log("\n" + style.gray("No servers to diagnose."));
  } else {
    console.log("");
    for (const server of report.servers) {
      console.log(label("Server", server.name));
      for (const check of server.checks) {
        console.log(`  ${formatMcpDoctorCheck(check)}`);
      }
    }
  }

  if (report.fixes) {
    console.log("");
    console.log(label("Fix mode", report.fixes.dryRun ? "dry-run" : report.fixes.global ? "project+global" : "project-local"));
    for (const action of report.fixes.actions) {
      console.log(`  ${report.fixes.dryRun ? style.skin("•") : style.mint("✓")} ${action}`);
    }
    for (const backup of report.fixes.backups) {
      console.log(`  ${style.gray("backup:")} ${backup}`);
    }
    for (const item of report.fixes.skipped) {
      console.log(`  ${style.gray("skipped:")} ${item}`);
    }
  }

  console.log("");
  if (report.ok) {
    console.log(status.ok("All checks passed"));
  } else {
    console.log(status.error(`${report.issueCount} issue(s) found`));
    console.log(style.gray("To resolve duplicates: run `omk mcp remove <server>` to delete a local copy, or edit the config files directly."));
  }
}

function formatMcpDoctorCheck(check: McpDoctorCheck): string {
  switch (check.severity) {
    case "ok":
      return `${style.mint("✓")} ${check.message}`;
    case "warn":
      return `${style.skin("⚠")} ${check.message}`;
    case "error":
      return `${style.pink("✗")} ${check.message}`;
    default:
      return `${style.gray("ℹ")} ${check.message}`;
  }
}

function preflightChecksForDoctor(entry: {
  reason?: string;
  detail?: string;
  packageSpec?: string;
}): McpDoctorCheck[] {
  const packageNote = entry.packageSpec ? ` (${maskSensitiveText(entry.packageSpec)})` : "";
  const detail = entry.detail ? `: ${maskSensitiveText(entry.detail)}` : "";
  const failureKind = entry.reason === "timeout" ? "preflight-timeout" : "preflight-package-unavailable";
  const failureMessage = entry.reason === "timeout"
    ? `warn: handshake-timeout/package preflight timed out${packageNote}; run \`omk mcp check --all\` (or \`omk mcp prewarm --all\`) to check caches`
    : `npm-family package resolution failed${packageNote}${detail}; run \`omk mcp check --all\` (or \`omk mcp prewarm --all\`) to check caches`;
  return [
    { severity: "warn", kind: failureKind, message: failureMessage },
    {
      severity: "warn",
      kind: "prewarm-needed",
      message: "preflight check recommended before chat startup; for one server run `omk mcp check <server-name>`",
    },
  ];
}

function stabilityHintsForServer(name: string, server: McpServerConfig): string[] {
  if (!server.command && !server.url) return [];
  const hints: string[] = [];
  const target = serverTargetText(server);
  if ((server.command?.includes("npx") ?? false) || (server.command?.includes("npm") ?? false)) {
    hints.push("npx-based servers may take >10s to start on first run. Consider installing globally or pinning the package.");
  }
  if (isRailwayMcpServer(name, server)) {
    if (server.url?.includes("mcp.railway.com")) {
      hints.push("Railway remote MCP uses OAuth over HTTP and avoids local npx/CLI token files; the first tool call may open browser auth.");
    } else if (target.includes("@jasontanswe/railway-mcp")) {
      hints.push("Unofficial Railway MCP uses RAILWAY_API_TOKEN and calls the GraphQL API directly (no CLI needed). If projects return empty, verify your token has project access at https://railway.app/account/tokens.");
    } else {
      hints.push("Railway CLI tokens expire periodically. Run railway login to refresh before using this server.");
      if (target.includes("@railway/mcp-server")) {
        hints.push(`Railway local MCP depends on Railway CLI auth and npx cold starts. Prefer the remote OAuth preset: omk mcp install railway or Codex: codex mcp add railway --url ${RAILWAY_REMOTE_MCP_URL}.`);
      } else {
        hints.push(`Railway MCP is most stable as a remote OAuth server at ${RAILWAY_REMOTE_MCP_URL}; avoid committing API tokens into MCP JSON.`);
      }
    }
  }
  if (isSupabaseMcpServer(name, server)) {
    hints.push("Supabase MCP requires an access token. Store it in your global MCP env (not committed) and run omk mcp doctor to verify. Tokens expire; refresh them from the Supabase account dashboard.");
  }
  if (name === "promptfoo") {
    hints.push("promptfoo can be slow to initialize. Ensure NODE_OPTIONS does not limit memory, or run 'omk mcp test promptfoo' with a longer timeout.");
  }
  if (name === "obsidian") {
    hints.push("obsidian MCP requires an active Obsidian vault and the Local REST API plugin. If the vault is closed, the server will fail.");
  }
  return hints;
}

function stdioProtocolChecksForServer(server: McpServerConfig): McpDoctorCheck[] {
  if (server.url) return [];
  const args = server.args ?? [];
  if (args.includes("@modelcontextprotocol/server-pdf") && !args.includes("--stdio")) {
    return [{
      severity: "error",
      kind: "stdio-protocol-mismatch",
      message: "@modelcontextprotocol/server-pdf defaults to HTTP and can write 'MCP server listening on .../mcp' to stdout; add --stdio or configure it as a remote URL",
    }];
  }
  return [];
}

function shouldValidateArgPath(server: McpServerConfig, arg: string, index: number): boolean {
  if (typeof arg !== "string" || arg.startsWith("-") || arg.startsWith("$")) return false;
  if (isShellInlineScript(server, index)) return false;
  if (isNpxPackageSpecifier(server, arg)) return false;
  if (isHttpUrl(arg)) return false;
  // Shell snippets, inline commands, and arguments with whitespace are not
  // standalone filesystem paths. Validating them as paths creates false MCP
  // doctor failures for commands like `bash -lc "exec node /path/server.js"`.
  if (/[\s;"'|&<>]/.test(arg)) return false;
  return true;
}

function isNpxPackageSpecifier(server: McpServerConfig, arg: string): boolean {
  const command = basenameOfCommand(server.command ?? "");
  if (!["npx", "npm", "pnpm", "yarn", "bun"].includes(command)) return false;
  if (arg.startsWith(".") || arg.startsWith("/") || arg.includes("\\") || arg.includes(":")) return false;
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9._~+-]+)?$/i.test(arg);
}

function isShellInlineScript(server: McpServerConfig, index: number): boolean {
  const command = basenameOfCommand(server.command ?? "");
  if (!["bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd", "cmd.exe"].includes(command)) {
    return false;
  }
  const previous = server.args?.[index - 1];
  return previous === "-c" || previous === "-lc" || previous === "/c" || previous === "--command";
}
