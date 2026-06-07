#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const useSource = process.env.OMK_EXECUTION_SMOKE_SOURCE === "1";
const cli = useSource
  ? [join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"), "src/cli.ts"]
  : [process.execPath, "dist/cli.js"];

function fail(message, result) {
  console.error(`execution smoke failed: ${message}`);
  if (result?.stdout) console.error(`stdout:\n${stripAnsi(result.stdout).slice(0, 4000)}`);
  if (result?.stderr) console.error(`stderr:\n${stripAnsi(result.stderr).slice(0, 4000)}`);
  process.exit(1);
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, "");
}

if (!existsSync(cli[0])) {
  fail(`CLI launcher missing: ${cli[0]}`);
}
if (!useSource && !existsSync(join(root, "dist", "cli.js"))) {
  fail("dist/cli.js missing; run npm run build:clean first or set OMK_EXECUTION_SMOKE_SOURCE=1");
}

const home = mkdtempSync(join(tmpdir(), "omk-execution-smoke-home-"));
const env = {
  ...process.env,
  HOME: home,
  OMK_PROJECT_ROOT: root,
  OMK_MCP_PREFLIGHT: "off",
  CODEX_BIN: "/nonexistent/codex",
  OPENCODE_BIN: "/nonexistent/opencode",
  COMMANDCODE_BIN: "/nonexistent/commandcode",
  MIMO_API_KEY: "",
  KIMI_API_KEY: "",
  DEEPSEEK_API_KEY: "",
  LOCAL_LLM_BASE_URL: "",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
};

const args = [
  ...cli.slice(1),
  "run",
  "feature-dev",
  "create a tiny verified plan",
  "--dry-run",
  "--workers",
  "1",
  "--mcp-scope",
  "none",
  "--execution",
  "sequential",
  "--timeout-preset",
  "quick",
];

const result = spawnSync(cli[0], args, {
  cwd: root,
  env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  timeout: 60_000,
});

if (result.error) fail(result.error.message, result);
if (result.status !== 0) fail(`dry-run exited ${result.status}`, result);

const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
if (/No runtime supports|Parallel DAG run failed/i.test(output)) {
  fail("dry-run attempted or reported live runtime execution", result);
}

const runId = output.match(/Run ID:\s*([^\s]+)/)?.[1];
if (!runId) fail("could not parse Run ID", result);

const runDir = join(root, ".omk", "runs", runId);
const dryRunPath = join(runDir, "dry-run.json");
const statePath = join(runDir, "state.json");
if (!existsSync(dryRunPath)) fail(`missing dry-run artifact: ${dryRunPath}`, result);
if (!existsSync(statePath)) fail(`missing state artifact: ${statePath}`, result);

const dryRun = JSON.parse(readFileSync(dryRunPath, "utf8"));
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (dryRun.mode !== "dry-run" || dryRun.providerFree !== true) {
  fail("dry-run artifact does not declare provider-free dry-run", result);
}
const bootstrap = state.nodes?.find((node) => node.id === "bootstrap");
if (!bootstrap || bootstrap.status !== "done") fail("bootstrap was not completed locally", result);
if (state.nodes?.some((node) => node.status === "running")) fail("dry-run left a running node", result);
if (!state.nodes?.some((node) => node.status === "skipped")) fail("dry-run did not skip provider nodes", result);

if (process.env.OMK_EXECUTION_SMOKE_KEEP !== "1") {
  rmSync(runDir, { recursive: true, force: true });
}
rmSync(home, { recursive: true, force: true });

console.log(`execution smoke passed: run ${runId} dry-run provider-free`);
