import { readFile } from "fs/promises";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { getProjectRoot, pathExists, getRunPath, getRunsDir } from "../util/fs.js";
import { header, label } from "../util/theme.js";
import { createDag, getExecutionWaves } from "../orchestration/dag.js";
import type { Dag, DagNodeDefinition, DagNodeOutput, DagOutputGate } from "../orchestration/dag.js";
import { createOmkJsonEnvelope } from "../util/json-envelope.js";
import { emitJson } from "../util/cli-contract.js";

export interface ParsedTask {
  id: string;
  description: string;
  done: boolean;
  parallel: boolean;
  phase: string;
  explicitDeps: string[];
  outputs: DagNodeOutput[];
  role?: string;
  verify?: string;
  gate?: DagOutputGate;
  risk?: "low" | "medium" | "high";
}

function inferRole(description: string, explicitRole?: string): string {
  if (explicitRole) return explicitRole;
  const d = description.toLowerCase();
  if (d.includes("test") || d.includes("spec")) return "tester";
  if (d.includes("lint") || d.includes("format") || d.includes("ci") || d.includes("deploy")) return "devops";
  if (d.includes("review") || d.includes("audit")) return "reviewer";
  if (d.includes("doc")) return "writer";
  return "coder";
}

function extractOutputs(description: string, explicitGate?: DagOutputGate, verifyCmd?: string, filesLine?: string): DagNodeOutput[] {
  const outputs: DagNodeOutput[] = [];

  // Extract file paths from backticks in files metadata line
  if (filesLine) {
    const fileMatches = filesLine.matchAll(/`([^`]+\.[a-zA-Z0-9]+)`/g);
    for (const m of fileMatches) {
      const path = m[1].trim();
      if (path.includes("/") || path.includes("\\")) {
        outputs.push({ name: `file:${path}`, ref: path, gate: explicitGate ?? "file-exists" });
      }
    }
  }

  // Extract file paths from backticks in description: `src/auth/service.ts`
  const fileMatches = description.matchAll(/`([^`]+\.[a-zA-Z0-9]+)`/g);
  for (const m of fileMatches) {
    const path = m[1].trim();
    if (path.includes("/") || path.includes("\\")) {
      outputs.push({ name: `file:${path}`, ref: path, gate: explicitGate ?? "file-exists" });
    }
  }

  // Extract test commands: `npm test`, `cargo test`, etc.
  const testCmdMatches = description.matchAll(/`((?:npm|yarn|pnpm|cargo|pytest|go)\s+test[^`]*)`/g);
  for (const m of testCmdMatches) {
    outputs.push({ name: `test:${m[1]}`, ref: m[1], gate: "test-pass" });
  }

  // Add verify command as output if present
  if (verifyCmd) {
    outputs.push({ name: `verify:${verifyCmd}`, ref: verifyCmd, gate: explicitGate ?? "command-pass" });
  }

  // Deduplicate by name
  const seen = new Set<string>();
  const deduped = outputs.filter((o) => {
    if (seen.has(o.name)) return false;
    seen.add(o.name);
    return true;
  });

  // If no explicit outputs, default to summary
  if (deduped.length === 0) {
    deduped.push({ name: "complete", gate: explicitGate ?? "none" });
  }

  return deduped;
}

function extractExplicitDeps(line: string): string[] {
  const deps: string[] = [];
  // Match "Depends on: T001, T002" or "depends on: T001, T002"
  const match = line.match(/depends\s+on[:：]\s*([A-Z0-9,\s]+)/i);
  if (match) {
    const ids = match[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    deps.push(...ids);
  }
  return deps;
}

export function parseTasksMd(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = content.split("\n");
  let currentPhase = "default";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();

    // Track phase headers
    const phaseMatch = line.match(/^##\s+(?:Phase\s+\d+[:：]\s*)?(.+)$/i);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }

    // Match task lines: - [ ] T001 [P] Description
    const taskMatch = line.match(/^-\s+\[([ x])\]\s+([A-Z0-9]+)\s+(.*)$/);
    if (taskMatch) {
      const rest = taskMatch[3];
      const parallel = /^\[P\]\s+/i.test(rest);
      const description = rest.replace(/^\[P\]\s+/i, "").trim();

      // Look for OMK metadata and explicit dependencies in the next few lines
      let metaRole: string | undefined;
      let metaDeps: string | undefined;
      let metaFiles: string | undefined;
      let metaVerify: string | undefined;
      let metaGate: DagOutputGate | undefined;
      let metaRisk: "low" | "medium" | "high" | undefined;
      const explicitDeps: string[] = [];

      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const nextLineRaw = lines[j];
        const nextLine = nextLineRaw.trim();
        if (nextLine.startsWith("- [")) break; // next task
        if (nextLine.startsWith("##")) break; // next phase

        // OMK metadata lines: > role: coder
        const metaMatch = nextLine.match(/^>\s*(\w+)[:：]\s*(.*)$/);
        if (metaMatch) {
          const key = metaMatch[1].toLowerCase();
          const value = metaMatch[2].trim();
          switch (key) {
            case "role":
              metaRole = value;
              break;
            case "deps":
              metaDeps = value;
              break;
            case "files":
              metaFiles = value;
              break;
            case "verify":
              metaVerify = value;
              break;
            case "gate":
              if (["file-exists", "command-pass", "test-pass", "summary", "review-pass", "none"].includes(value)) {
                metaGate = value as DagOutputGate;
              }
              break;
            case "risk":
              if (["low", "medium", "high"].includes(value)) {
                metaRisk = value as "low" | "medium" | "high";
              }
              break;
          }
          continue;
        }

        const deps = extractExplicitDeps(nextLine);
        if (deps.length > 0) {
          explicitDeps.push(...deps);
        }
      }

      // Parse deps from metadata
      if (metaDeps && metaDeps !== "none") {
        const ids = metaDeps.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        explicitDeps.push(...ids);
      }

      // Also check inline (description) for depends on
      const inlineDeps = extractExplicitDeps(description);
      explicitDeps.push(...inlineDeps);

      tasks.push({
        id: taskMatch[2],
        description,
        done: taskMatch[1] === "x",
        parallel,
        phase: currentPhase,
        explicitDeps: [...new Set(explicitDeps)],
        outputs: extractOutputs(description, metaGate, metaVerify, metaFiles),
        role: metaRole,
        verify: metaVerify,
        gate: metaGate,
        risk: metaRisk,
      });
    }
  }

  return tasks;
}

export function buildDependencies(
  tasks: ParsedTask[],
  options: { parallel?: boolean } = {}
): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  const idToTask = new Map(tasks.map((t) => [t.id, t]));

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskDeps: string[] = [];

    // Explicit deps always win
    if (task.explicitDeps.length > 0) {
      for (const depId of task.explicitDeps) {
        if (idToTask.has(depId)) {
          taskDeps.push(depId);
        }
      }
    }

    if (options.parallel) {
      // In parallel mode, add phase boundary deps only if no explicit deps
      if (taskDeps.length === 0) {
        const samePhaseTasks = tasks.filter((t) => t.phase === task.phase);
        const idx = samePhaseTasks.findIndex((t) => t.id === task.id);
        if (!task.parallel && idx > 0) {
          // Non-parallel task depends on previous non-parallel task in same phase
          for (let k = idx - 1; k >= 0; k--) {
            if (!samePhaseTasks[k].parallel) {
              taskDeps.push(samePhaseTasks[k].id);
              break;
            }
          }
        }
        // Also depend on last task of previous phases
        for (let j = 0; j < i; j++) {
          if (tasks[j].phase !== task.phase) {
            // Only depend on the last task of each previous phase
            const lastOfPhase = tasks
              .slice(0, i)
              .filter((t) => t.phase === tasks[j].phase)
              .pop();
            if (lastOfPhase && !taskDeps.includes(lastOfPhase.id)) {
              taskDeps.push(lastOfPhase.id);
            }
          }
        }
      }
    } else {
      // Linear mode: each task depends on the previous one (unless explicit)
      if (taskDeps.length === 0 && i > 0) {
        taskDeps.push(tasks[i - 1].id);
      }
    }

    deps.set(task.id, [...new Set(taskDeps)]);
  }

  return deps;
}

export function tasksToDag(
  tasks: ParsedTask[],
  options: { parallel?: boolean } = {}
): Dag {
  const deps = buildDependencies(tasks, options);
  const nodes: DagNodeDefinition[] = tasks.map((task) => ({
    id: task.id,
    name: task.description,
    role: inferRole(task.description, task.role),
    dependsOn: deps.get(task.id) ?? [],
    maxRetries: task.risk === "high" ? 1 : 2,
    outputs: task.outputs,
  }));
  return createDag({ nodes });
}

export async function loadSpecDag(
  specDir: string,
  options: { parallel?: boolean } = {}
): Promise<Dag> {
  const tasksPath = join(specDir, "tasks.md");

  if (!(await pathExists(tasksPath))) {
    throw new Error(`tasks.md not found: ${tasksPath}`);
  }

  const content = await readFile(tasksPath, "utf-8");
  const tasks = parseTasksMd(content);

  if (tasks.length === 0) {
    throw new Error("No tasks found in tasks.md");
  }

  return tasksToDag(tasks, { parallel: options.parallel });
}

/** Machine-readable payload carried inside the `dag` omk.contract.v1 envelope. */
interface DagJsonData {
  inputId: string;
  nodes: Dag["nodes"];
  edges: Array<{ from: string; to: string }>;
  batches: string[][];
  stats: { nodes: number; edges: number; batches: number };
}

/**
 * Project the in-memory DAG artifact into the envelope `data` shape. The inner
 * dag artifact (nodes) is preserved verbatim; edges/batches/stats are derived
 * from the existing dependsOn graph (no new data sources).
 */
function buildDagJsonData(inputId: string, dag: Dag): DagJsonData {
  const edges = dag.nodes.flatMap((node) =>
    node.dependsOn.map((from) => ({ from, to: node.id }))
  );
  const batches = getExecutionWaves(dag).map((wave) => wave.map((node) => node.id));
  return {
    inputId,
    nodes: dag.nodes,
    edges,
    batches,
    stats: { nodes: dag.nodes.length, edges: edges.length, batches: batches.length },
  };
}

/**
 * JSON path for `omk dag from-spec --json`.
 * Emits EXACTLY ONE omk.contract.v1 envelope to stdout (no banner, no ANSI) and
 * never throws on a missing/empty tasks.md, so JSON stdout stays one envelope.
 */
async function emitDagFromSpecJson(
  targetDir: string,
  options: { output?: string; parallel?: boolean }
): Promise<Dag> {
  const started = Date.now();
  let dag: Dag;
  try {
    dag = await loadSpecDag(targetDir, { parallel: options.parallel });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const empty: Dag = { nodes: [] };
    emitJson(
      createOmkJsonEnvelope<DagJsonData>({
        command: "dag",
        status: "not-applicable",
        ok: false,
        data: buildDagJsonData(targetDir, empty),
        warnings: [
          { code: "RUN_ARTIFACT_MISSING", message, recoverable: true, severity: "warning" },
        ],
        durationMs: Date.now() - started,
      })
    );
    return empty;
  }

  if (options.output) {
    await mkdir(getRunsDir(getProjectRoot()), { recursive: true });
    await writeFile(options.output, JSON.stringify(dag, null, 2));
  }

  emitJson(
    createOmkJsonEnvelope<DagJsonData>({
      command: "dag",
      status: "passed",
      ok: true,
      data: buildDagJsonData(targetDir, dag),
      durationMs: Date.now() - started,
    })
  );
  return dag;
}

export async function dagFromSpecCommand(
  specDir: string,
  options: { output?: string; parallel?: boolean; runId?: string; run?: string; json?: boolean } = {}
): Promise<Dag> {
  const root = getProjectRoot();
  let targetDir = specDir;

  // Resolve --run latest
  if (options.run) {
    const runsDir = getRunsDir(root);
    if (options.run === "latest") {
      // List runs directory
      const { readdir } = await import("fs/promises");
      const entries = await readdir(runsDir).catch(() => [] as string[]);
      const sorted = entries
        .filter((e) => /^\d{4}-/.test(e))
        .sort()
        .reverse();
      if (sorted.length === 0) {
        throw new Error("No runs found in .omk/runs/");
      }
      targetDir = getRunPath(sorted[0], undefined, root);
    } else {
      targetDir = getRunPath(options.run, undefined, root);
    }
  }

  if (options.json === true || process.argv.includes("--json")) {
    return emitDagFromSpecJson(targetDir, { output: options.output, parallel: options.parallel });
  }

  const dag = await loadSpecDag(targetDir, { parallel: options.parallel });

  const dagJson = JSON.stringify(dag, null, 2);
  if (options.output) {
    await mkdir(getRunsDir(root), { recursive: true });
    await writeFile(options.output, dagJson);
    console.log(label("DAG saved", options.output));
  } else {
    console.log(header("DAG from Spec"));
    console.log(label("Tasks parsed", String(dag.nodes.length)));
    console.log(label("Nodes", String(dag.nodes.length)));
    console.log("");
    console.log(dagJson);
  }

  return dag;
}
