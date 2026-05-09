import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runShell } from "./shell.js";

export type NativeSafetySource = "env" | "bundled" | "target-release" | "target-debug" | "missing";
export type NativeSafetyStatus = "ok" | "warn" | "info";

export interface NativeSafetyResolution {
  ok: boolean;
  source: NativeSafetySource;
  path: string | null;
  platformArch: string;
  builtFromSource: boolean;
  message: string;
}

export interface NativeSafetySelfTest extends NativeSafetyResolution {
  status: NativeSafetyStatus;
  checks: number | null;
}

export interface NativeSafetyOptions {
  root?: string;
  packageRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | string;
  arch?: string;
  timeoutMs?: number;
}

interface NativeSafetyCandidate {
  source: Exclude<NativeSafetySource, "missing">;
  path: string;
  builtFromSource: boolean;
}

const SUPPORTED_PLATFORMS = new Set(["linux", "darwin", "win32"]);
const SUPPORTED_ARCHES = new Set(["x64", "arm64"]);

export function getNativePlatformArchKey(platform: NodeJS.Platform | string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

export function getOmkSafetyBinaryName(platform: NodeJS.Platform | string = process.platform): string {
  return platform === "win32" ? "omk-safety.exe" : "omk-safety";
}

export function getOmkPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function getBundledOmkSafetyBinaryPath(
  packageRoot = getOmkPackageRoot(),
  platform: NodeJS.Platform | string = process.platform,
  arch: string = process.arch
): string {
  return join(packageRoot, "dist", "native", getNativePlatformArchKey(platform, arch), getOmkSafetyBinaryName(platform));
}

function isSupportedPlatformArch(platform: NodeJS.Platform | string, arch: string): boolean {
  return SUPPORTED_PLATFORMS.has(platform) && SUPPORTED_ARCHES.has(arch);
}

function normalizeEnvPath(rawPath: string): string {
  return isAbsolute(rawPath) ? rawPath : join(process.cwd(), rawPath);
}

function getNativeSafetyCandidates(options: NativeSafetyOptions = {}): NativeSafetyCandidate[] {
  const env = options.env ?? process.env;
  const packageRoot = options.packageRoot ?? getOmkPackageRoot();
  const root = options.root ?? packageRoot;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const binaryName = getOmkSafetyBinaryName(platform);
  const candidates: NativeSafetyCandidate[] = [];

  if (env.OMK_SAFETY_BIN) {
    candidates.push({ source: "env", path: normalizeEnvPath(env.OMK_SAFETY_BIN), builtFromSource: false });
  }

  if (isSupportedPlatformArch(platform, arch)) {
    candidates.push({ source: "bundled", path: getBundledOmkSafetyBinaryPath(packageRoot, platform, arch), builtFromSource: false });
  }

  candidates.push({ source: "target-release", path: join(root, "target", "release", binaryName), builtFromSource: true });
  candidates.push({ source: "target-debug", path: join(root, "target", "debug", binaryName), builtFromSource: true });

  return candidates;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveOmkSafetyNative(options: NativeSafetyOptions = {}): Promise<NativeSafetyResolution> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const platformArch = getNativePlatformArchKey(platform, arch);

  for (const candidate of getNativeSafetyCandidates(options)) {
    if (await fileExists(candidate.path)) {
      return {
        ok: true,
        source: candidate.source,
        path: candidate.path,
        platformArch,
        builtFromSource: candidate.builtFromSource,
        message: `native omk-safety resolved via ${candidate.source}: ${candidate.path}`,
      };
    }
  }

  return {
    ok: false,
    source: "missing",
    path: null,
    platformArch,
    builtFromSource: false,
    message: `native omk-safety binary not bundled for ${platformArch} — run npm run native:build or use TS fallback`,
  };
}

export async function runOmkSafetySelfTest(options: NativeSafetyOptions = {}): Promise<NativeSafetySelfTest> {
  const resolution = await resolveOmkSafetyNative(options);
  if (!resolution.path) {
    return { ...resolution, status: "info", checks: null };
  }

  const result = await runShell(resolution.path, ["self-test"], {
    cwd: options.root ?? options.packageRoot ?? getOmkPackageRoot(),
    timeout: options.timeoutMs ?? 5000,
  });
  if (result.failed) {
    return {
      ...resolution,
      ok: false,
      status: "warn",
      checks: null,
      message: `self-test failed for ${resolution.path}`,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as { ok?: unknown; checks?: unknown };
    if (parsed.ok === true && typeof parsed.checks === "number") {
      const prefix = resolution.builtFromSource ? "self-test passed from source build" : "self-test passed";
      return {
        ...resolution,
        status: "ok",
        checks: parsed.checks,
        message: `${prefix} (${parsed.checks} checks): ${resolution.path}`,
      };
    }
  } catch {
    // fall through to warning below
  }

  return {
    ...resolution,
    ok: false,
    status: "warn",
    checks: null,
    message: `self-test returned unexpected output for ${resolution.path}`,
  };
}
