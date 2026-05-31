import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OMK_PACKAGE_NAME,
  OMK_RELEASE_CHANNEL,
  OMK_RUNTIME_VERSION,
  OMK_SCHEMA_VERSIONS,
  OMK_VERSION_SCHEMA_VERSION,
} from "../version.js";
import type { VersionReport } from "../contracts/index.js";
import { emitJson } from "../util/cli-contract.js";
import { createOmkJsonEnvelope } from "../util/json-envelope.js";
import { getOmkVersionSync } from "../util/version.js";

export type VersionCommandOptions = {
  json?: boolean;
};

type PackageJson = {
  name?: string;
  version?: string;
};

function packageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return join(dirname(currentFile), "..", "..");
}

function readPackageJson(): PackageJson {
  try {
    return JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf-8")) as PackageJson;
  } catch {
    return {};
  }
}

function gitValue(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: packageRoot(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function gitDirty(): boolean {
  const status = gitValue(["status", "--porcelain"]);
  return status !== undefined && status.length > 0;
}

export function buildVersionReport(): VersionReport {
  const pkg = readPackageJson();
  const packageName = pkg.name ?? OMK_PACKAGE_NAME;
  const packageVersion = pkg.version ?? getOmkVersionSync();
  const mismatches = [];

  if (packageName !== OMK_PACKAGE_NAME) {
    mismatches.push({
      file: "package.json",
      expected: OMK_PACKAGE_NAME,
      actual: packageName,
    });
  }

  return {
    schemaVersion: OMK_VERSION_SCHEMA_VERSION,
    packageName,
    packageVersion,
    runtimeVersion: OMK_RUNTIME_VERSION,
    schemaVersions: [...OMK_SCHEMA_VERSIONS],
    gitCommit: gitValue(["rev-parse", "--short=12", "HEAD"]),
    gitBranch: gitValue(["branch", "--show-current"]),
    sourceTarget: gitValue(["branch", "--show-current"]),
    releaseCandidate: packageVersion.includes("-rc.") ? packageVersion : undefined,
    dirty: gitDirty(),
    consistent: mismatches.length === 0,
    mismatches,
  };
}

export async function versionCommand(options: VersionCommandOptions = {}): Promise<void> {
  const started = Date.now();
  const report = buildVersionReport();
  if (options.json) {
    emitJson(createOmkJsonEnvelope({
      command: "version",
      status: report.consistent ? "passed" : "failed",
      ok: report.consistent,
      commit: report.gitCommit,
      data: report,
      durationMs: Date.now() - started,
    }));
    return;
  }

  console.log(`${report.packageName} ${report.packageVersion}`);
  console.log(`runtime ${report.runtimeVersion} • channel ${OMK_RELEASE_CHANNEL}`);
  if (report.gitBranch || report.gitCommit) {
    console.log(`source ${report.gitBranch ?? "unknown"} ${report.gitCommit ?? ""}`.trim());
  }
}
