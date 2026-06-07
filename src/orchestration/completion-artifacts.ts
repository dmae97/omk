import { mkdir, stat, writeFile } from "fs/promises";
import { join } from "path";
import { getRunPath, pathExists } from "../util/fs.js";
import { runShell } from "../util/shell.js";

export interface CompletionArtifactPaths {
  runDir: string;
  artifactsDir: string;
  contractJson: string;
  resultJson: string;
  verifyJson: string;
  evidenceJson: string;
  diffPatch: string;
  diffStat: string;
  testLog: string;
  runLog: string;
}

export interface CompletionArtifactContract {
  schemaVersion: 1;
  runId: string;
  required: {
    diffPatch: string;
    testLog: string;
    runLog: string;
    resultJson: string;
  };
  generated: {
    verifyJson: string;
    evidenceJson: string;
    diffStat: string;
  };
}

export interface CompletionArtifactStatus {
  readonly ok: boolean;
  readonly missing: string[];
  readonly paths: CompletionArtifactPaths;
}

export function getCompletionArtifactPaths(root: string, runId: string): CompletionArtifactPaths {
  const runDir = getRunPath(runId, undefined, root);
  const artifactsDir = join(runDir, "artifacts");
  return {
    runDir,
    artifactsDir,
    contractJson: join(runDir, "completion-contract.json"),
    resultJson: join(runDir, "result.json"),
    verifyJson: join(runDir, "verify-result.json"),
    evidenceJson: join(runDir, "evidence.json"),
    diffPatch: join(artifactsDir, "generated-diff.patch"),
    diffStat: join(artifactsDir, "generated-diff.stat.txt"),
    testLog: join(artifactsDir, "test.log"),
    runLog: join(runDir, "events.jsonl"),
  };
}

export async function ensureCompletionArtifactContract(root: string, runId: string): Promise<CompletionArtifactPaths> {
  const paths = getCompletionArtifactPaths(root, runId);
  await mkdir(paths.artifactsDir, { recursive: true });
  const contract: CompletionArtifactContract = {
    schemaVersion: 1,
    runId,
    required: {
      diffPatch: paths.diffPatch,
      testLog: paths.testLog,
      runLog: paths.runLog,
      resultJson: paths.resultJson,
    },
    generated: {
      verifyJson: paths.verifyJson,
      evidenceJson: paths.evidenceJson,
      diffStat: paths.diffStat,
    },
  };
  await writeFile(paths.contractJson, `${JSON.stringify(contract, null, 2)}\n`, "utf-8");
  return paths;
}

export async function captureGitDiffArtifacts(root: string, runId: string): Promise<CompletionArtifactPaths> {
  const paths = await ensureCompletionArtifactContract(root, runId);
  const [patch, statSummary] = await Promise.all([
    runShell("git", ["diff", "--binary"], { cwd: root, timeout: 30_000 }),
    runShell("git", ["diff", "--stat"], { cwd: root, timeout: 30_000 }),
  ]);
  if (!patch.failed) {
    await writeFile(paths.diffPatch, patch.stdout, "utf-8");
  }
  if (!statSummary.failed) {
    await writeFile(paths.diffStat, statSummary.stdout, "utf-8");
  }
  return paths;
}

export async function writeTestEvidenceLog(root: string, runId: string, lines: readonly string[]): Promise<CompletionArtifactPaths> {
  const paths = await ensureCompletionArtifactContract(root, runId);
  await writeFile(paths.testLog, `${lines.join("\n")}\n`, "utf-8");
  return paths;
}

export async function getCompletionArtifactStatus(root: string, runId: string): Promise<CompletionArtifactStatus> {
  const paths = await ensureCompletionArtifactContract(root, runId);
  const missing: string[] = [];
  if (!(await hasNonEmptyFile(paths.diffPatch))) missing.push("diff artifact missing");
  if (!(await hasNonEmptyFile(paths.testLog))) missing.push("test artifact missing");
  if (!(await hasNonEmptyFile(paths.runLog))) missing.push("run log missing");
  if (!(await hasNonEmptyFile(paths.resultJson))) missing.push("result json missing");
  return { ok: missing.length === 0, missing, paths };
}

async function hasNonEmptyFile(path: string): Promise<boolean> {
  if (!(await pathExists(path))) return false;
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
