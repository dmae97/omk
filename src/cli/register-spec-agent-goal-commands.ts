import type { Command } from "commander";
import { t } from "../util/i18n.js";
import { CliError } from "../util/cli-contract.js";

export function registerSpecAgentGoalCommands(program: Command): void {
  const specify = program.command("specify").description(t("cli.specifyDesc"));
  specify
    .command("init")
    .description("Initialize spec-driven development (spec-kit)")
    .option("--preset <name>", "Preset to apply")
    .action(async (options) => {
      const { specifyInitCommand } = await import("../commands/specify.js");
      await specifyInitCommand(options);
    });
  const specifyWf = specify.command("workflow").description("Manage spec-kit workflows");
  specifyWf
    .command("run <workflow-id>")
    .description("Run a spec-kit workflow (e.g. speckit)")
    .option("-i, --input <pairs...>", "Input key=value pairs")
    .action(async (workflowId, options) => {
      const { specifyWorkflowRunCommand } = await import("../commands/specify.js");
      const inputs: Record<string, string> = {};
      if (options.input) {
        for (const pair of Array.isArray(options.input) ? options.input : [options.input]) {
          const [k, v] = pair.split("=");
          if (k) inputs[k] = v ?? "";
        }
      }
      await specifyWorkflowRunCommand(workflowId, inputs);
    });
  specifyWf
    .command("list")
    .description("List installed workflows")
    .action(async () => {
      const { specifyWorkflowListCommand } = await import("../commands/specify.js");
      await specifyWorkflowListCommand();
    });
  const specifyExt = specify.command("extension").description("Manage spec-kit extensions");
  specifyExt
    .command("add <name>")
    .description("Add an extension")
    .action(async (name) => {
      const { specifyExtensionAddCommand } = await import("../commands/specify.js");
      await specifyExtensionAddCommand(name);
    });
  specifyExt
    .command("list")
    .description("List installed extensions")
    .action(async () => {
      const { specifyExtensionListCommand } = await import("../commands/specify.js");
      await specifyExtensionListCommand();
    });
  specify
    .command("version")
    .description("Show spec-kit version")
    .action(async () => {
      const { specifyVersionCommand } = await import("../commands/specify.js");
      await specifyVersionCommand();
    });

  const spec = program.command("spec").description(t("cmd.specDesc"));
  spec
    .command("init")
    .description(t("cmd.specInitDesc"))
    .option("-f, --force", t("cmd.specInitForceOption"))
    .action(async (options) => {
      const { specInitCommand } = await import("../commands/spec.js");
      await specInitCommand(options);
    });
  spec
    .command("status")
    .description(t("cmd.specStatusDesc"))
    .action(async () => {
      const { specStatusCommand } = await import("../commands/spec.js");
      await specStatusCommand();
    });
  spec
    .command("check")
    .description(t("cmd.specCheckDesc"))
    .action(async () => {
      const { specCheckCommand } = await import("../commands/spec.js");
      await specCheckCommand();
    });
  const specPreset = spec.command("preset").description("Manage spec-kit presets");
  specPreset
    .command("install <name>")
    .description("Install a spec-kit preset (built-in: omk)")
    .action(async (name) => {
      const { specPresetInstallCommand } = await import("../commands/spec.js");
      await specPresetInstallCommand(name);
    });

  const agent = program.command("agent").description(t("cmd.agentDesc"));
  agent
    .command("list")
    .description(t("cmd.agentListDesc"))
    .action(async () => {
      const { agentListCommand } = await import("../commands/agent.js");
      await agentListCommand();
    });
  agent
    .command("show <name>")
    .description(t("cmd.agentShowDesc"))
    .action(async (name) => {
      const { agentShowCommand } = await import("../commands/agent.js");
      await agentShowCommand(name);
    });
  agent
    .command("create <name>")
    .description(t("cmd.agentCreateDesc"))
    .option("--from <template>", t("cmd.agentCreateFromOption"))
    .action(async (name, options) => {
      const { agentCreateCommand } = await import("../commands/agent.js");
      await agentCreateCommand(name, options);
    });
  agent
    .command("doctor")
    .description(t("cmd.agentDoctorDesc"))
    .action(async () => {
      const { agentDoctorCommand } = await import("../commands/agent.js");
      await agentDoctorCommand();
    });

  program
    .command("verify")
    .description(t("cmd.verifyDesc"))
    .option("--run <id>", t("cmd.verifyRunOption"))
    .option("--json", t("cmd.verifyJsonOption"))
    .action(async (options) => {
      const globalOpts = program.opts();
      const { verifyCommand } = await import("../commands/verify.js");
      try {
        await verifyCommand({ ...options, runId: globalOpts.runId });
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });

  const goal = program.command("goal").description(t("cmd.goalDesc"));
  goal
    .command("create <rawPrompt>")
    .description(t("cmd.goalCreateDesc"))
    .option("--json", t("cmd.goalJsonOption"))
    .option("--title <title>", t("cmd.goalTitleOption"))
    .option("--objective <text>", t("cmd.goalObjectiveOption"))
    .option("--risk <level>", t("cmd.goalRiskOption"))
    .action(async (rawPrompt, options) => {
      const { goalCreateCommand } = await import("../commands/goal.js");
      try {
        await goalCreateCommand(rawPrompt, options);
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("list")
    .description(t("cmd.goalListDesc"))
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (options) => {
      const { goalListCommand } = await import("../commands/goal.js");
      try {
        await goalListCommand(options);
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("show <goal-id>")
    .description(t("cmd.goalShowDesc"))
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { goalShowCommand } = await import("../commands/goal.js");
      try {
        await goalShowCommand(goalId, options);
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("plan <goal-id>")
    .description(t("cmd.goalPlanDesc"))
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { goalPlanCommand } = await import("../commands/goal.js");
      try {
        await goalPlanCommand(goalId, options);
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("run <goal-id>")
    .description(t("cmd.goalRunDesc"))
    .option("--workers <n>", t("cmd.goalWorkersOption"), "auto")
    .option("--run-id <id>", t("cmd.goalRunIdOption"))
    .option("--mcp-scope <all|project|none>", "MCP scope for this goal DAG run (all | project | none)")
    .option("--provider <provider>", "provider policy (auto | kimi | deepseek | codex | qwen)", "kimi")
    .option("--model <model>", "provider model or provider/model override")
    .option("--approval-policy <policy>", t("cmd.parallelApprovalOption"), "interactive")
    .option("--timeout-preset <preset>", t("cmd.runTimeoutPresetOption"))
    .option("--watch", t("cmd.parallelWatchOption"))
    .option("--no-watch", t("cmd.parallelNoWatchOption"))
    .option("--view <mode>", "Display mode: cockpit | table | compact", "cockpit")
    .option("--max-auto-continue-iterations <n>", "maximum automatic continue/replan iterations")
    .action(async (goalId, options) => {
      const globalOpts = program.opts();
      const { goalRunCommand } = await import("../commands/goal.js");
      try {
        await goalRunCommand(goalId, {
          ...options,
          runId: options.runId ?? globalOpts.runId,
          watch: options.watch,
        });
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("verify <goal-id>")
    .description(t("cmd.goalVerifyDesc"))
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { goalVerifyCommand } = await import("../commands/goal.js");
      try {
        await goalVerifyCommand(goalId, options);
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("close <goal-id>")
    .description(t("cmd.goalCloseDesc"))
    .option("--force", t("cmd.goalForceOption"))
    .option("--reason <text>", t("cmd.goalReasonOption"))
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { goalCloseCommand } = await import("../commands/goal.js");
      try {
        await goalCloseCommand(goalId, options);
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("block <goal-id>")
    .description(t("cmd.goalBlockDesc"))
    .requiredOption("--reason <text>", t("cmd.goalReasonOption"))
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { goalBlockCommand } = await import("../commands/goal.js");
      try {
        await goalBlockCommand(goalId, options);
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("continue [goal-id]")
    .description("Continue the latest active goal (or specified goal-id)")
    .option("--workers <n>", "Worker count", "auto")
    .option("--run-id <id>", "Run ID")
    .option("--from-run-id <id>", "Run ID to read as continuation context")
    .option("--mcp-scope <all|project|none>", "MCP scope for this goal continuation DAG (all | project | none)")
    .option("--provider <provider>", "provider policy (auto | kimi | deepseek | codex | qwen)", "kimi")
    .option("--model <model>", "provider model or provider/model override")
    .option("--approval-policy <policy>", t("cmd.parallelApprovalOption"), "interactive")
    .option("--timeout-preset <preset>", t("cmd.runTimeoutPresetOption"))
    .option("--watch", t("cmd.parallelWatchOption"))
    .option("--no-watch", t("cmd.parallelNoWatchOption"))
    .option("--view <mode>", "Display mode: cockpit | table | compact", "cockpit")
    .option("--max-auto-continue-iterations <n>", "maximum automatic continue/replan iterations")
    .action(async (goalId, options) => {
      const globalOpts = program.opts();
      const { goalContinueCommand } = await import("../commands/goal.js");
      try {
        await goalContinueCommand(goalId, {
          ...options,
          runId: options.runId ?? globalOpts.runId,
          watch: options.watch,
        });
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
}
