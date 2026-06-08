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
    .command("interview [input]")
    .description("[Alpha] Run a deep interview to reduce goal uncertainty before planning")
    .option("--goal-id <id>", "Existing goal id to refine")
    .option("--mode <create|refine>", "Interview mode (create | refine)", "create")
    .option("--depth <light|standard|deep>", "Interview depth (omit to auto-select by ambiguity)")
    .option("--max-questions <n>", "Maximum number of questions")
    .option("--answers <file>", "Answers JSON file: { \"answers\": [{ \"questionId\", \"answer\" }] }")
    .option("--write-spec", "Create or update the goal spec from interview answers")
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (input, options) => {
      const { goalInterviewCommand } = await import("../commands/goal-interview.js");
      try {
        await goalInterviewCommand(input, options);
      } catch (err) {
        if (err instanceof CliError) {
          if (process.exitCode === undefined) process.exitCode = err.exitCode;
          return;
        }
        throw err;
      }
    });
  goal
    .command("refine <goal-id>")
    .description("[Alpha] Apply the latest interview spec delta to a goal and optionally replan")
    .option("--from-interview <id>", "Interview session id (default: latest)", "latest")
    .option("--plan", "Rebuild the plan after applying the interview delta")
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { goalRefineCommand } = await import("../commands/goal-interview.js");
      try {
        await goalRefineCommand(goalId, options);
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
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
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
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
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
  goal
    .command("auto [goal-id]")
    .description("Automatically continue/replan a goal within bounded iterations")
    .option("--workers <n>", "Worker count", "auto")
    .option("--run-id <id>", "Run ID")
    .option("--from-run-id <id>", "Run ID to read as continuation context")
    .option("--mcp-scope <all|project|none>", "MCP scope for this goal auto DAG (all | project | none)")
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
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
  goal
    .command("watch <goal-id>")
    .description("Start the in-process goal daemon for a goal")
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
    .option("--approval-policy <policy>", t("cmd.parallelApprovalOption"), "interactive")
    .option("--interval-ms <ms>", "Daemon loop interval in milliseconds")
    .option("--max-iterations <n>", "Maximum daemon iterations")
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { defaultGoalDaemon } = await import("../goal/goal-daemon.js");
      const { goalVerifyCommand, goalContinueCommand, goalBlockCommand } = await import("../commands/goal.js");
      const started = defaultGoalDaemon.start(goalId, {
        provider: options.provider,
        approvalPolicy: options.approvalPolicy,
        intervalMs: options.intervalMs ? Number.parseInt(options.intervalMs, 10) : undefined,
        maxIterations: options.maxIterations ? Number.parseInt(options.maxIterations, 10) : undefined,
        onVerify: async (id) => { await goalVerifyCommand(id, { json: true }); },
        onContinue: async (id, runOptions) => { await goalContinueCommand(id, runOptions); },
        onBlock: async (id, reason) => { await goalBlockCommand(id, { reason, json: true }); },
      });
      const payload = { goalId, running: started };
      if (options.json) console.log(JSON.stringify(payload, null, 2));
      else console.log(started ? `Goal daemon started for ${goalId}` : `Goal daemon already running for ${goalId}`);
    });
  goal
    .command("wake <goal-id>")
    .description("Wake a sleeping goal daemon")
    .option("--reason <text>", "Wake reason")
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { defaultGoalDaemon } = await import("../goal/goal-daemon.js");
      const ok = defaultGoalDaemon.wake(goalId, options.reason);
      const payload = { goalId, woken: ok };
      if (options.json) console.log(JSON.stringify(payload, null, 2));
      else console.log(ok ? `Goal daemon woken for ${goalId}` : `No sleeping daemon for ${goalId}`);
    });
  goal
    .command("sleep <goal-id>")
    .description("Pause a running goal daemon until it is woken")
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { defaultGoalDaemon } = await import("../goal/goal-daemon.js");
      const ok = defaultGoalDaemon.sleep(goalId);
      const payload = { goalId, sleeping: ok };
      if (options.json) console.log(JSON.stringify(payload, null, 2));
      else console.log(ok ? `Goal daemon sleeping for ${goalId}` : `No running daemon for ${goalId}`);
    });
  goal
    .command("daemon [goal-id]")
    .description("Show goal daemon status")
    .option("--json", t("cmd.goalJsonOption"))
    .action(async (goalId, options) => {
      const { defaultGoalDaemon } = await import("../goal/goal-daemon.js");
      const payload = goalId
        ? { goalId, status: defaultGoalDaemon.getStatus(goalId) }
        : { running: defaultGoalDaemon.listRunning() };
      if (options.json) console.log(JSON.stringify(payload, null, 2));
      else console.log(JSON.stringify(payload, null, 2));
    });
}
