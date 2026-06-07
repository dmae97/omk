import type { Command } from "commander";
import { t } from "../util/i18n.js";
import { applyExitCode } from "../util/cli-contract.js";

export function registerWorkflowCommands(program: Command): void {
  program
    .command("plan <goal>")
    .description(t("cmd.planDesc"))
    .option("--thinking <mode>", "thinking mode (off|medium|high|xhigh|max)", "high")
    .option("--spec-kit", t("cmd.featureSpecKitOption"))
    .option("--no-spec-kit", t("cmd.featureNoSpecKitOption"))
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const { planCommand } = await import("../commands/plan.js");
      await planCommand(goal, { ...options, runId: globalOpts.runId });
    });

  program
    .command("feature <goal>")
    .description(t("cmd.featureDesc"))
    .option("--spec-kit", t("cmd.featureSpecKitOption"))
    .option("--no-spec-kit", t("cmd.featureNoSpecKitOption"))
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const { featureCommand } = await import("../commands/workflow.js");
      await featureCommand(goal, { ...options, runId: globalOpts.runId });
    });

  program
    .command("bugfix <goal>")
    .description(t("cmd.bugfixDesc"))
    .option("--spec-kit", t("cmd.bugfixSpecKitOption"))
    .option("--no-spec-kit", t("cmd.bugfixNoSpecKitOption"))
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const { bugfixCommand } = await import("../commands/workflow.js");
      await bugfixCommand(goal, { ...options, runId: globalOpts.runId });
    });

  program
    .command("refactor <goal>")
    .description(t("cmd.refactorDesc"))
    .option("--spec-kit", t("cmd.refactorSpecKitOption"))
    .option("--no-spec-kit", t("cmd.refactorNoSpecKitOption"))
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const { refactorCommand } = await import("../commands/workflow.js");
      await refactorCommand(goal, { ...options, runId: globalOpts.runId });
    });

  program
    .command("review")
    .description(t("cmd.reviewDesc"))
    .option("--ci", t("cmd.reviewCiOption"))
    .option("--soft", t("cmd.reviewSoftOption"))
    .action(async (options) => {
      const globalOpts = program.opts();
      const { reviewCommand } = await import("../commands/workflow.js");
      const result = await reviewCommand({ ...options, runId: globalOpts.runId });
      applyExitCode(result);
    });

  program
    .command("run [flow] [goal]")
    .description(t("cmd.runDesc"))
    .option("--workers <n>", t("cmd.runWorkersOption"), "auto")
    .option("--mcp-scope <all|project|none>", "MCP scope for this orchestration run (all | project | none)")
    .option("--execution <ask|auto|parallel|sequential>", "Execution selection policy (ask | auto | parallel | sequential)")
    .option("--timeout-preset <preset>", t("cmd.runTimeoutPresetOption"))
    .option("--dry-run", "Create run artifacts and execution plan without invoking provider runtimes")
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
    .option("--model <model>", "provider model or provider/model override")
    .action(async (flow, goal, options) => {
      const globalOpts = program.opts();
      const { runCommand } = await import("../commands/run.js");
      await runCommand(flow, goal, { ...options, runId: globalOpts.runId });
    });

  program
    .command("team")
    .description(t("cmd.teamDesc"))
    .option("--workers <n>", t("cmd.teamWorkersOption"), "auto")
    .action(async (options) => {
      const globalOpts = program.opts();
      const { teamCommand } = await import("../commands/team.js");
      await teamCommand({ ...options, runId: globalOpts.runId });
    });

  program
    .command("parallel [goal]")
    .description(t("cmd.parallelDesc"))
    .option("--workers <n>", t("cmd.parallelWorkersOption"), "auto")
    .option("--mcp-scope <all|project|none>", "MCP scope for this parallel DAG run (all | project | none)")
    .option("--execution <ask|auto|parallel|sequential>", "Execution selection policy (ask | auto | parallel | sequential)")
    .option("--timeout-preset <preset>", t("cmd.parallelTimeoutPresetOption"))
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
    .option("--model <model>", "provider model or provider/model override")
    .option("--approval-policy <policy>", t("cmd.parallelApprovalOption"), "interactive")
    .option("--watch", t("cmd.parallelWatchOption"))
    .option("--no-watch", t("cmd.parallelNoWatchOption"))
    .option("--view <mode>", "Display mode: cockpit | table | compact", "cockpit")
    .option("--alternate-screen", "Enter alternate screen buffer for full-screen UI")
    .option("--no-pause", "Do not wait for Enter at the end")
    .option("--compact", "Use compact single-line renderer")
    .option("--chat", t("cmd.parallelChatOption"))
    .option("--from-spec <dir>", "Run spec-kit tasks.md as a parallel DAG")
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const { parallelCommand } = await import("../commands/parallel.js");
      const result = await parallelCommand(goal, {
        ...options,
        runId: globalOpts.runId,
        watch: options.watch,
        noWatch: options.watch === false,
        view: options.view,
        alternateScreen: options.alternateScreen,
        noPause: options.pause === false,
        compact: options.compact,
      });
      if (!result.success && process.exitCode === undefined) {
        process.exitCode = 1;
      }
    });

  program
    .command("orchestrate <goal>")
    .description("Parallel agent orchestration with skill/MCP/hook assignment. Use --mode for enhanced think/mcp/skills/variant subagents.")
    .option("--workers <n>", "worker count (auto = resource profile based)", "auto")
    .option("--timeout <ms>", "orchestration timeout in milliseconds", "600000")
    .option("--dry-run", "Create the orchestration plan without executing workers")
    .option("--output <path>", "Write orchestration result JSON")
    .option("--mode <modes>", "Enhanced mode: default (think+mcp+skills), full (all), or comma-separated: think,mcp,skills,variant")
    .option("--variant-count <n>", "Number of variants when variant mode is active (1-5, default: 3)", "3")
    .option("--variant-strategy <strategy>", "Variant selection strategy: majority-vote, best-score, first-pass, ensemble (default: best-score)")
    .option("--thinking-level <level>", "Thinking trace verbosity: brief, normal, verbose (default: normal)")
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const { orchestrateCommand } = await import("../commands/orchestrate.js");
      const workers = options.workers && options.workers !== "auto" ? options.workers : globalOpts.workers;
      const result = await orchestrateCommand(goal, { ...options, workers, runId: globalOpts.runId });
      if (result && !result.success && process.exitCode === undefined) {
        process.exitCode = 1;
      }
    });

  program
    .command("parallel:interactive [goal]")
    .description("Interactive parallel subagent orchestration with skills, hooks, and MCP")
    .option("--workers <n>", "worker count (auto = resource profile based)", "auto")
    .option("--timeout <ms>", "orchestration timeout in milliseconds", "600000")
    .option("--dry-run", "Create the interactive subagent plan without executing workers")
    .option("--output <path>", "Write orchestration result JSON")
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
    .option("--model <model>", "provider model or provider/model override")
    .option("--mcp-scope <all|project|none>", "MCP scope for this interactive run (all | project | none)")
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const { interactiveParallelCommand } = await import("../commands/parallel/interactive.js");
      const result = await interactiveParallelCommand(goal, {
        ...options,
        runId: globalOpts.runId,
        workers: options.workers && options.workers !== "auto" ? options.workers : globalOpts.workers,
      });
      if (!result.success && process.exitCode === undefined) {
        process.exitCode = 1;
      }
    });
}
