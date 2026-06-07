import { compileGoalToDagNodes } from "../goal/compiler.js";
import { createGoalSpec } from "../goal/intake.js";
import { createDag } from "../orchestration/dag.js";
import { ParallelOrchestrator, type ParallelOrchestrationResult } from "../orchestration/parallel-orchestrator.js";
import {
  EnhancedParallelOrchestrator,
  type EnhancedOrchestrationResult,
} from "../orchestration/enhanced-parallel-orchestrator.js";
import {
  type EnhancedMode,
  type EnhancedModeConfig,
  ALL_ENHANCED_MODES,
} from "../orchestration/enhanced-modes.js";
import { formatExecutionPlan, createExecutionPlan } from "../orchestration/execution-planner.js";
import { cpus } from "os";

export interface OrchestrateOptions {
  workers?: string;
  timeout?: string;
  dryRun?: boolean;
  output?: string;
  runId?: string;
  /** Enhanced mode: comma-separated list of think,mcp,skills,variant */
  mode?: string;
  /** Variant count when variant mode is active */
  variantCount?: string;
  /** Variant selection strategy: majority-vote, best-score, first-pass, ensemble */
  variantStrategy?: string;
  /** Thinking level: brief, normal, verbose */
  thinkingLevel?: string;
}

export async function orchestrateCommand(
  goal: string,
  options: OrchestrateOptions,
): Promise<ParallelOrchestrationResult | EnhancedOrchestrationResult | void> {
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const maxWorkers = parseWorkers(options.workers);
  const timeout = options.timeout ? parseInt(options.timeout, 10) : 600000;
  const enhancedModes = parseEnhancedModes(options.mode);

  console.log(`🎯 Orchestrating goal: ${goal}`);
  console.log(`📋 Run ID: ${runId}`);
  console.log(`👷 Max workers: ${maxWorkers}`);
  console.log(`⏱️  Timeout: ${timeout}ms`);
  if (enhancedModes.length > 0) {
    console.log(`🧠 Enhanced modes: ${enhancedModes.join(", ")}`);
  }
  console.log();

  try {
    // 1. Goal을 DAG로 컴파일
    console.log("📦 Compiling goal to DAG...");
    const dagNodes = await compileGoalToDagNodes(createGoalSpec(goal));
    const dag = createDag({ nodes: dagNodes });
    console.log(`✅ Created ${dag.nodes.length} nodes`);
    console.log();

    // 2. 실행 계획 생성
    const executionPlan = createExecutionPlan({ dag: dag.nodes, maxWorkers });
    console.log("📋 Execution Plan:");
    console.log(formatExecutionPlan(executionPlan));
    console.log();

    // 3. Dry run 모드면 여기서 종료
    if (options.dryRun) {
      console.log("🏁 Dry run complete - no execution");
      return;
    }

    // 4. Enhanced mode → EnhancedParallelOrchestrator 사용
    if (enhancedModes.length > 0) {
      return await executeEnhanced(goal, dag, executionPlan, runId, maxWorkers, timeout, enhancedModes, options);
    }

    // 5. 기본 모드 → ParallelOrchestrator 사용
    console.log("🚀 Starting parallel execution...");
    console.log("─".repeat(60));

    const orchestrator = new ParallelOrchestrator({
      dag,
      runId,
      maxWorkers,
      cwd: process.cwd(),
      timeout,
      onProgress: (state) => {
        const { completed, total, percentage } = state.progress;
        const status = state.status;
        process.stdout.write(`\r📊 Progress: ${completed}/${total} (${percentage.toFixed(1)}%) - ${status}`);
      },
      onLog: (entry) => {
        const timestamp = entry.timestamp.split("T")[1].split(".")[0];
        const prefix = `[${timestamp}] [${entry.workerId.padEnd(12)}]`;
        
        if (entry.level === "error") {
          console.error(`\n❌ ${prefix} ${entry.message}`);
        } else if (entry.level === "warn") {
          console.warn(`\n⚠️  ${prefix} ${entry.message}`);
        } else if (entry.workerId !== "orchestrator") {
          console.log(`\n${prefix} ${entry.message}`);
        }
      },
    });

    const result = await orchestrator.execute();

    console.log();
    console.log("─".repeat(60));
    printStandardResult(result);

    // 결과 파일 저장
    if (options.output) {
      const { writeFile } = await import("fs/promises");
      await writeFile(options.output, JSON.stringify(result, null, 2), "utf-8");
      console.log(`   Output: ${options.output}`);
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Orchestration failed: ${message}`);
    
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// ─── Enhanced mode helpers ──────────────────────────────────────────────

function parseEnhancedModes(mode?: string): EnhancedMode[] {
  if (!mode) return [];
  const requested = mode
    .toLowerCase()
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  // "default" → think + mcp + skills
  if (requested.includes("default")) {
    return ["think", "mcp", "skills"];
  }
  // "full" → all modes
  if (requested.includes("full")) {
    return [...ALL_ENHANCED_MODES];
  }

  const valid: EnhancedMode[] = [];
  for (const m of requested) {
    if ((ALL_ENHANCED_MODES as readonly string[]).includes(m)) {
      valid.push(m as EnhancedMode);
    }
  }
  const validStr = valid as string[];
  if (valid.length !== requested.length) {
    const invalid = requested.filter((m) => !validStr.includes(m));
    console.warn(`⚠️  Invalid modes ignored: ${invalid.join(", ")}. Valid: ${ALL_ENHANCED_MODES.join(", ")}`);
  }
  return valid;
}

async function executeEnhanced(
  goal: string,
  dag: ReturnType<typeof createDag>,
  executionPlan: ReturnType<typeof createExecutionPlan>,
  runId: string,
  maxWorkers: number,
  timeout: number,
  enhancedModes: EnhancedMode[],
  options: OrchestrateOptions,
): Promise<EnhancedOrchestrationResult> {
  const variantCount = options.variantCount ? parseInt(options.variantCount, 10) : 3;
  const thinkingLevel = parseThinkingLevel(options.thinkingLevel);
  const variantStrategy = parseVariantStrategy(options.variantStrategy);

  const modeConfig: Partial<EnhancedModeConfig> = {
    modes: enhancedModes,
    variantCount: Math.min(Math.max(1, variantCount), 5),
    variantStrategy,
    thinkingLevel,
  };

  console.log(`🧠 Enhanced mode config:`);
  console.log(`   Modes: ${enhancedModes.join(", ")}`);
  if (enhancedModes.includes("think")) console.log(`   Think level: ${thinkingLevel}`);
  if (enhancedModes.includes("variant")) {
    console.log(`   Variants: ${modeConfig.variantCount} (strategy: ${variantStrategy})`);
  }
  if (enhancedModes.includes("mcp")) console.log(`   MCP: auto-discovery`);
  if (enhancedModes.includes("skills")) console.log(`   Skills: auto-assign + evidence tracking`);
  console.log();

  console.log("🚀 Starting enhanced parallel execution...");
  console.log("─".repeat(60));

  const orchestrator = new EnhancedParallelOrchestrator({
    dag,
    runId,
    goalId: goal.slice(0, 64),
    objective: goal,
    maxWorkers,
    cwd: process.cwd(),
    timeout,
    modeConfig,
    onProgress: (state) => {
      const { completed, total, percentage } = state.progress;
      const status = state.status;
      const modes = state.activeModes?.join(",") ?? "";
      process.stdout.write(
        `\r📊 Progress: ${completed}/${total} (${percentage.toFixed(1)}%) - ${status} [${modes}]`,
      );
    },
    onLog: (entry) => {
      const timestamp = entry.timestamp.split("T")[1].split(".")[0];
      const prefix = `[${timestamp}] [${entry.workerId.padEnd(12)}]`;

      if (entry.level === "error") {
        console.error(`\n❌ ${prefix} ${entry.message}`);
      } else if (entry.level === "warn") {
        console.warn(`\n⚠️  ${prefix} ${entry.message}`);
      }
    },
    onThinking: (trace) => {
      const ts = trace.timestamp.split("T")[1].split(".")[0];
      console.log(`\n💭 [${ts}] [${trace.nodeId}] step ${trace.step}: ${trace.content.slice(0, 120)}`);
    },
  });

  const result = await orchestrator.execute();

  console.log();
  console.log("─".repeat(60));
  printEnhancedResult(result);

  // 결과 파일 저장
  if (options.output) {
    const { writeFile } = await import("fs/promises");
    await writeFile(options.output, JSON.stringify(result, null, 2), "utf-8");
    console.log(`   Output: ${options.output}`);
  }

  return result;
}

function printStandardResult(result: ParallelOrchestrationResult): void {
  if (result.success) {
    console.log("⚠️  Orchestration execution finished. Capture diff + test + log artifacts and run `omk verify --run <id> --json` before calling it done.");
  } else {
    console.log("❌ Orchestration failed");
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }

  console.log();
  console.log("📊 Summary:");
  console.log(`   Run ID: ${result.state.runId}`);
  console.log(`   Status: ${result.state.status}`);
  console.log(`   Progress: ${result.state.progress.completed}/${result.state.progress.total} (${result.state.progress.percentage.toFixed(1)}%)`);
  console.log(`   Started: ${result.state.startedAt}`);
  if (result.state.completedAt) {
    console.log(`   Completed: ${result.state.completedAt}`);
  }
}

function printEnhancedResult(result: EnhancedOrchestrationResult): void {
  if (result.success) {
    console.log("✅ Enhanced orchestration completed successfully!");
  } else {
    console.log("❌ Enhanced orchestration failed");
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }

  console.log();
  console.log("📊 Summary:");
  console.log(`   Run ID: ${result.state.runId}`);
  console.log(`   Status: ${result.state.status}`);
  console.log(`   Progress: ${result.state.progress.completed}/${result.state.progress.total} (${result.state.progress.percentage.toFixed(1)}%)`);
  console.log(`   Active modes: ${result.state.activeModes.join(", ")}`);
  console.log(`   Started: ${result.state.startedAt}`);
  if (result.state.completedAt) {
    console.log(`   Completed: ${result.state.completedAt}`);
  }

  // Thinking traces summary
  if (result.thinkingTraces.length > 0) {
    console.log();
    console.log("💭 Thinking Traces:");
    const byNode = new Map<string, number>();
    for (const t of result.thinkingTraces) {
      byNode.set(t.nodeId, (byNode.get(t.nodeId) ?? 0) + 1);
    }
    for (const [nodeId, count] of byNode) {
      console.log(`   ${nodeId}: ${count} trace(s)`);
    }
  }

  // Skill evidences summary
  if (result.skillEvidences.length > 0) {
    console.log();
    console.log("🛠️  Skill Evidences:");
    const used = result.skillEvidences.filter((e) => e.used);
    console.log(`   ${used.length}/${result.skillEvidences.length} skills used`);
  }

  // Variant selections summary
  const variantKeys = Object.keys(result.variantSelections);
  if (variantKeys.length > 0) {
    console.log();
    console.log("🔀 Variant Selections:");
    for (const [nodeId, selection] of Object.entries(result.variantSelections)) {
      console.log(`   ${nodeId}: variant ${selection.selected.variant.index} (${selection.strategy}) — ${selection.rationale.slice(0, 80)}`);
    }
  }
}

function parseThinkingLevel(level?: string): EnhancedModeConfig["thinkingLevel"] {
  if (!level) return "normal";
  const l = level.toLowerCase().trim();
  if (l === "brief" || l === "normal" || l === "verbose") return l;
  return "normal";
}

function parseVariantStrategy(
  strategy?: string,
): EnhancedModeConfig["variantStrategy"] {
  if (!strategy) return "best-score";
  const s = strategy.toLowerCase().trim();
  if (s === "majority-vote" || s === "best-score" || s === "first-pass" || s === "ensemble") {
    return s;
  }
  return "best-score";
}

function parseWorkers(workers?: string): number {
  if (!workers || workers === "auto") {
    const cpuCount = cpus().length;
    return Math.min(Math.max(2, cpuCount), 8);
  }

  const num = parseInt(workers, 10);
  if (isNaN(num) || num < 1) {
    throw new Error(`Invalid workers value: ${workers}. Must be a positive integer or "auto".`);
  }

  return num;
}
