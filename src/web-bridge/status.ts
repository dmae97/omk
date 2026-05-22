import { access, chmod, mkdir, readFile, writeFile } from "fs/promises";
import { constants } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getProjectRoot, getRunPath, pathExists, sanitizeRunId } from "../util/fs.js";
import {
  WEB_BRIDGE_MCP_SERVER_NAME,
  WEB_BRIDGE_NATIVE_HOST_NAME,
  WEB_BRIDGE_SCHEMA_VERSION,
  getDefaultWebBridgeCapabilities,
  sanitizeWebBridgePageSnapshot,
  type WebBridgePageSnapshot,
} from "../contracts/web-bridge.js";

export interface WebBridgeStatusReport {
  ok: boolean;
  command: "web-bridge status";
  checkedAt: string;
  schemaVersion: typeof WEB_BRIDGE_SCHEMA_VERSION;
  enabled: boolean;
  installed: boolean;
  ready: boolean;
  extension: {
    templatePath: string;
    templateExists: boolean;
    manifestPath: string;
  };
  nativeHost: {
    name: string;
    supported: boolean;
    manifestPaths: string[];
    installedPath: string | null;
    command: string;
  };
  mcp: {
    serverName: string;
    command: string;
    args: string[];
    readOnlyDefault: true;
  };
  artifacts: {
    directory: string;
    latestContextPath: string;
    latestContextExists: boolean;
  };
  permissions: {
    readOnlyDefault: true;
    mutationsRequireApproval: true;
    forbiddenData: string[];
  };
  checks: Array<{ severity: "ok" | "info" | "warn" | "error"; message: string }>;
}

export interface WebBridgeInstallInstructions {
  ok: boolean;
  command: "web-bridge install-host";
  dryRun: boolean;
  wrote: boolean;
  manifestPath: string | null;
  wrapperPath: string | null;
  manifest: Record<string, unknown> | null;
  instructions: string[];
}

export function getOmkPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function getWebBridgeTemplatePath(packageRoot = getOmkPackageRoot()): string {
  return join(packageRoot, "templates", "web-bridge", "chrome-extension");
}

export function getWebBridgeExtensionManifestPath(packageRoot = getOmkPackageRoot()): string {
  return join(getWebBridgeTemplatePath(packageRoot), "manifest.json");
}

export function getWebBridgeArtifactDir(root = getProjectRoot()): string {
  return join(root, ".omk", "web-bridge");
}

export function getLatestWebBridgeContextPath(root = getProjectRoot()): string {
  return join(getWebBridgeArtifactDir(root), "latest-page-context.json");
}

export function getNativeHostManifestPaths(home = homedir(), platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "darwin") {
    return [
      join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", `${WEB_BRIDGE_NATIVE_HOST_NAME}.json`),
      join(home, "Library", "Application Support", "Chromium", "NativeMessagingHosts", `${WEB_BRIDGE_NATIVE_HOST_NAME}.json`),
    ];
  }
  if (platform === "linux") {
    return [
      join(home, ".config", "google-chrome", "NativeMessagingHosts", `${WEB_BRIDGE_NATIVE_HOST_NAME}.json`),
      join(home, ".config", "chromium", "NativeMessagingHosts", `${WEB_BRIDGE_NATIVE_HOST_NAME}.json`),
      join(home, ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts", `${WEB_BRIDGE_NATIVE_HOST_NAME}.json`),
    ];
  }
  return [];
}

export async function getWebBridgeStatus(options: { root?: string; packageRoot?: string; env?: NodeJS.ProcessEnv } = {}): Promise<WebBridgeStatusReport> {
  const root = options.root ?? getProjectRoot();
  const packageRoot = options.packageRoot ?? getOmkPackageRoot();
  const env = options.env ?? process.env;
  const templatePath = getWebBridgeTemplatePath(packageRoot);
  const extensionManifestPath = getWebBridgeExtensionManifestPath(packageRoot);
  const manifestPaths = getNativeHostManifestPaths();
  const installedPath = await firstExistingPath(manifestPaths);
  const artifactDir = getWebBridgeArtifactDir(root);
  const latestContextPath = getLatestWebBridgeContextPath(root);
  const templateExists = await pathExists(extensionManifestPath);
  const latestContextExists = await pathExists(latestContextPath);
  const enabled = /^(?:1|true|yes|on)$/iu.test(env.OMK_WEB_BRIDGE_ENABLED ?? "");
  const capabilities = getDefaultWebBridgeCapabilities();
  const checks: WebBridgeStatusReport["checks"] = [
    templateExists
      ? { severity: "ok", message: "Chrome extension template is bundled" }
      : { severity: "error", message: "Chrome extension template is missing from package" },
    installedPath
      ? { severity: "ok", message: "Chrome native messaging host manifest found" }
      : { severity: enabled ? "warn" : "info", message: "Native messaging host is not installed; run `omk web-bridge install-host` for instructions" },
    { severity: "ok", message: "Web bridge MCP entry is read-only by default" },
    { severity: "ok", message: "Cookies, passwords, local storage, and raw secrets are forbidden from bridge payloads" },
  ];

  return {
    ok: templateExists,
    command: "web-bridge status",
    checkedAt: new Date().toISOString(),
    schemaVersion: WEB_BRIDGE_SCHEMA_VERSION,
    enabled,
    installed: Boolean(installedPath),
    ready: Boolean(templateExists && installedPath),
    extension: { templatePath, templateExists, manifestPath: extensionManifestPath },
    nativeHost: {
      name: WEB_BRIDGE_NATIVE_HOST_NAME,
      supported: manifestPaths.length > 0,
      manifestPaths,
      installedPath,
      command: "omk web-bridge native-host",
    },
    mcp: {
      serverName: WEB_BRIDGE_MCP_SERVER_NAME,
      command: "omk",
      args: ["mcp", "serve", WEB_BRIDGE_MCP_SERVER_NAME],
      readOnlyDefault: true,
    },
    artifacts: { directory: artifactDir, latestContextPath, latestContextExists },
    permissions: {
      readOnlyDefault: true,
      mutationsRequireApproval: true,
      forbiddenData: capabilities.forbiddenData,
    },
    checks,
  };
}

export async function writeWebBridgePageContext(
  snapshot: WebBridgePageSnapshot,
  options: { root?: string; runId?: string } = {}
): Promise<{ latestPath: string; runPath?: string; snapshot: WebBridgePageSnapshot }> {
  const root = options.root ?? getProjectRoot();
  const sanitized = sanitizeWebBridgePageSnapshot(snapshot);
  const latestPath = getLatestWebBridgeContextPath(root);
  await mkdir(dirname(latestPath), { recursive: true });
  await writeFile(latestPath, `${JSON.stringify({ schemaVersion: WEB_BRIDGE_SCHEMA_VERSION, snapshot: sanitized }, null, 2)}\n`, "utf-8");

  let runPath: string | undefined;
  if (options.runId) {
    const runId = sanitizeRunId(options.runId, "web-bridge");
    runPath = getRunPath(runId, "web-bridge-page-context.json", root);
    await mkdir(dirname(runPath), { recursive: true });
    await writeFile(runPath, `${JSON.stringify({ schemaVersion: WEB_BRIDGE_SCHEMA_VERSION, snapshot: sanitized }, null, 2)}\n`, "utf-8");
  }
  return { latestPath, ...(runPath ? { runPath } : {}), snapshot: sanitized };
}

export async function readLatestWebBridgePageContext(root = getProjectRoot()): Promise<WebBridgePageSnapshot | null> {
  const latestPath = getLatestWebBridgeContextPath(root);
  try {
    const parsed = JSON.parse(await readFile(latestPath, "utf-8")) as { snapshot?: WebBridgePageSnapshot };
    return parsed.snapshot ? sanitizeWebBridgePageSnapshot(parsed.snapshot) : null;
  } catch {
    return null;
  }
}

export function buildNativeHostManifest(input: { extensionId: string; wrapperPath: string }): Record<string, unknown> {
  return {
    name: WEB_BRIDGE_NATIVE_HOST_NAME,
    description: "OMK local Web Bridge native messaging host",
    path: input.wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${input.extensionId}/`],
  };
}

export async function buildInstallHostInstructions(options: {
  extensionId?: string;
  write?: boolean;
  browser?: "chrome" | "chromium" | "brave";
  root?: string;
  home?: string;
  platform?: NodeJS.Platform;
} = {}): Promise<WebBridgeInstallInstructions> {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const root = options.root ?? getProjectRoot();
  const manifestPath = selectNativeHostManifestPath(home, platform, options.browser);
  const wrapperPath = platform === "win32" ? null : join(root, ".omk", "web-bridge", "omk-web-bridge-native-host.sh");
  const extensionId = options.extensionId?.trim();
  const manifest = extensionId && wrapperPath ? buildNativeHostManifest({ extensionId, wrapperPath }) : null;
  const instructions = [
    "1. Open chrome://extensions and enable Developer mode.",
    `2. Load unpacked extension from: ${getWebBridgeTemplatePath()}`,
    "3. Copy the extension ID Chrome assigns.",
    "4. Run: omk web-bridge install-host --extension-id <EXTENSION_ID> --write",
    "5. Verify with: omk web-bridge doctor --json",
  ];

  if (!options.write) {
    return { ok: true, command: "web-bridge install-host", dryRun: true, wrote: false, manifestPath, wrapperPath, manifest, instructions };
  }
  if (platform === "win32") {
    return {
      ok: false,
      command: "web-bridge install-host",
      dryRun: false,
      wrote: false,
      manifestPath: null,
      wrapperPath: null,
      manifest: null,
      instructions: [
        "Windows native-host registry installation is not written automatically in v1.",
        "Use `omk web-bridge install-host` output to create a native messaging host manifest and registry entry manually.",
      ],
    };
  }
  if (!extensionId || !manifest || !manifestPath || !wrapperPath) {
    return {
      ok: false,
      command: "web-bridge install-host",
      dryRun: false,
      wrote: false,
      manifestPath,
      wrapperPath,
      manifest,
      instructions: ["Missing --extension-id; Chrome native messaging requires an exact extension ID in allowed_origins."],
    };
  }

  await mkdir(dirname(wrapperPath), { recursive: true });
  await writeFile(wrapperPath, "#!/usr/bin/env sh\nexec omk web-bridge native-host\n", "utf-8");
  await chmod(wrapperPath, 0o755).catch(() => undefined);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return { ok: true, command: "web-bridge install-host", dryRun: false, wrote: true, manifestPath, wrapperPath, manifest, instructions };
}

async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path, constants.F_OK);
      return path;
    } catch {
      // keep looking
    }
  }
  return null;
}

function selectNativeHostManifestPath(home: string, platform: NodeJS.Platform, browser: "chrome" | "chromium" | "brave" = "chrome"): string | null {
  if (platform === "win32") return null;
  const candidates = getNativeHostManifestPaths(home, platform);
  if (browser === "chromium") return candidates.find((candidate) => candidate.includes("chromium")) ?? candidates[0] ?? null;
  if (browser === "brave") return candidates.find((candidate) => candidate.includes("Brave")) ?? candidates[0] ?? null;
  return candidates[0] ?? null;
}
