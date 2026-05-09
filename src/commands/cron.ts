import { readFile } from "fs/promises";
import { extname, isAbsolute, join } from "path";
import { getOmkPath, getProjectRoot, getRunsDir, pathExists, sanitizeRunId } from "../util/fs.js";
import { style, status, label, header } from "../util/theme.js";
import { loadCronJobs, createCronEngine, validateCronJobName } from "../util/cron-engine.js";
import { createDag, type DagNodeDefinition } from "../orchestration/dag.js";
import { createExecutor } from "../orchestration/executor.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { createOmkSessionEnv } from "../util/session.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { createProviderBackedTaskRunner } from "../providers/provider-runtime.js";
import type { ApprovalPolicy, CronJob, TaskRunner } from "../contracts/orchestration.js";

export interface CronDagExecutionOptions {
  approvalPolicy?: ApprovalPolicy;
  root?: string;
  runId?: string;
  runner?: TaskRunner;
  workers?: number;
}

export async function cronListCommand(): Promise<void> {
  const jobs = await loadCronJobs();
  if (jobs.length === 0) {
    console.log(style.gray("No cron jobs configured. Add jobs to .omk/cron.yml"));
    return;
  }
  console.log(header("Cron Jobs"));
  for (const job of jobs) {
    const jobState = job.enabled ? style.mint("enabled") : style.red("disabled");
    const next = job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : style.gray("—");
    const last = job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : style.gray("—");
    console.log(`  ${job.name}  ${jobState}  schedule: ${job.schedule}`);
    console.log(`    last: ${last}  next: ${next}  concurrency: ${job.concurrencyPolicy}`);
  }
}

export async function cronRunCommand(jobName: string, options: { dagFile?: string }): Promise<void> {
  const safeJobName = validateCronJobName(jobName);
  const jobs = await loadCronJobs();
  let job = jobs.find((j) => j.name === safeJobName);
  if (!job) {
    // Allow ad-hoc runs by creating an ephemeral job
    if (!options.dagFile) {
      console.error(status.error(`Job not found: ${safeJobName}. Provide --dag-file for ad-hoc runs.`));
      process.exit(1);
    }
    job = {
      name: safeJobName,
      schedule: "@manual",
      dagFile: options.dagFile,
      concurrencyPolicy: "allow",
      enabled: true,
      catchup: false,
    };
  }

  console.log(header(`Running cron job: ${job.name}`));
  const engine = createCronEngine(async (j) => {
    console.log(`  Executing DAG: ${j.dagFile}`);
    await executeCronDag(j);
    console.log(`  ${status.ok("DAG execution complete")}`);
  }, { jobs: [job] });

  const run = await engine.runJobNow(job.name);
  if (run) {
    console.log(label("Run ID", run.runId));
    console.log(label("Success", run.success ? "yes" : "no"));
    if (run.error) console.log(label("Error", run.error));
    console.log(label("Log", run.logPath));
    if (!run.success) process.exitCode = 1;
  } else {
    console.error(status.error(`Job not found: ${job.name}`));
    process.exitCode = 1;
  }
}

export async function executeCronDag(
  job: CronJob,
  options: CronDagExecutionOptions = {}
): Promise<void> {
  const root = options.root ?? getProjectRoot();
  const dagPath = isAbsolute(job.dagFile) ? job.dagFile : join(root, job.dagFile);
  if (!(await pathExists(dagPath))) {
    throw new Error(`DAG file not found: ${dagPath}`);
  }

  const dag = createDag(await loadDagDefinition(dagPath));
  const runId = sanitizeRunId(options.runId ?? `cron-${job.name}-${Date.now()}`, "cron");
  const workers = Math.max(1, options.workers ?? 1);
  const approvalPolicy = options.approvalPolicy ?? await loadCronApprovalPolicy(root);
  const resources = await getOmkResourceSettings();
  const promptPrefix = `Cron job: ${job.name}\nDAG file: ${job.dagFile}`;
  const runner = options.runner ?? await createProviderBackedTaskRunner({
    providerPolicy: "auto",
    deepseekPromptPrefix: [
      `Kimi cron DAG context.`,
      promptPrefix,
      `DeepSeek is advisory/read-only unless selected for a low-risk read node.`,
      `Kimi keeps write, shell, merge, MCP, and final synthesis authority.`,
    ].join("\n"),
    allowDeepSeekAdvisoryFileNodes: true,
    kimi: {
      cwd: root,
      timeout: 0,
      agentFile: getOmkPath("agents/root.yaml"),
      promptPrefix,
      mcpScope: resources.mcpScope,
      skillsScope: resources.skillsScope,
      roleAgentFiles: true,
      env: {
        ...createOmkSessionEnv(root, runId),
        OMK_RUN_ID: runId,
        OMK_FLOW: "cron",
        OMK_CRON_JOB: job.name,
        OMK_DAG_FILE: dagPath,
        OMK_WORKERS: String(workers),
        OMK_DAG_ROUTING: "1",
        OMK_MCP_SCOPE: resources.mcpScope,
        OMK_SKILLS_SCOPE: resources.skillsScope,
      },
    },
  });

  const executor = createExecutor({
    persister: createStatePersister(getRunsDir(root)),
    ensemble: options.runner ? false : resources.ensembleDefaultEnabled ? {} : false,
  });

  const result = await executor.execute(dag, runner, {
    runId,
    workers,
    approvalPolicy,
    timeoutPreset: job.timeoutPreset,
  });

  if (!result.success) {
    throw new Error(`DAG execution failed for cron job: ${job.name}`);
  }
}

async function loadDagDefinition(dagPath: string): Promise<{ nodes: DagNodeDefinition[] }> {
  const content = await readFile(dagPath, "utf-8");
  let parsed: unknown;
  if ([".yaml", ".yml"].includes(extname(dagPath).toLowerCase())) {
    const yaml = await import("yaml");
    parsed = yaml.parse(content);
  } else {
    parsed = JSON.parse(content);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("DAG definition must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.nodes)) {
    throw new Error("DAG definition must have a 'nodes' array");
  }
  return { nodes: record.nodes as DagNodeDefinition[] };
}

async function loadCronApprovalPolicy(root: string): Promise<ApprovalPolicy> {
  const configPath = join(root, ".omk", "config.toml");
  try {
    const content = await readFile(configPath, "utf-8");
    const match = content.match(/^approval_policy\s*=\s*["']([^"']+)["']/m);
    const value = match?.[1]?.trim().toLowerCase();
    if (value === "interactive" || value === "auto" || value === "yolo" || value === "block") {
      return value;
    }
  } catch {
    // ignore missing config
  }
  return "auto";
}

export async function cronLogsCommand(jobName: string): Promise<void> {
  const engine = createCronEngine(async () => { /* no-op */ });
  const safeJobName = validateCronJobName(jobName);
  const runs = await engine.getRuns(safeJobName);
  if (runs.length === 0) {
    console.log(style.gray(`No runs found for job: ${safeJobName}`));
    return;
  }
  console.log(header(`Cron Runs: ${safeJobName}`));
  for (const run of runs.slice(-20)) {
    const indicator = run.success ? style.mint("✔") : style.red("✖");
    console.log(`  ${indicator} ${new Date(run.startedAt).toLocaleString()}  ${run.runId}`);
    if (run.error) console.log(`    ${style.red(run.error)}`);
  }
}

export async function cronEnableCommand(jobName: string): Promise<void> {
  const safeJobName = validateCronJobName(jobName);
  console.log(status.success(`Enabled cron job: ${safeJobName}`));
  console.log(style.gray("Note: edit .omk/cron.yml to persist this change."));
}

export async function cronDisableCommand(jobName: string): Promise<void> {
  const safeJobName = validateCronJobName(jobName);
  console.log(status.success(`Disabled cron job: ${safeJobName}`));
  console.log(style.gray("Note: edit .omk/cron.yml to persist this change."));
}
