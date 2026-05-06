#!/usr/bin/env node
import { Command } from "commander";
import { style, status as themeStatus, kimicatCliHero } from "./util/theme.js";
import { formatOmkVersionFooter, getOmkVersionSync } from "./util/version.js";
import { t, initI18n } from "./util/i18n.js";
import { buildCustomHelp } from "./util/help-text.js";
import { CliError, applyExitCode } from "./util/cli-contract.js";

const OMK_VERSION = getOmkVersionSync();
const OMK_VERSION_FOOTER = formatOmkVersionFooter(OMK_VERSION);


const program = new Command();

program
  .name("omk")
  .description(t("cli.description"))
  .usage("[options] [command]")
  .version(OMK_VERSION)
  .option("-r, --run-id <id>", t("cli.runIdOption"))
  .option("--workers <n>", t("cmd.parallelWorkersOption"), "auto")
  .option("--sudo", t("cli.sudoOption"))
  .addHelpText("before", buildCustomHelp)
  .addHelpText("afterAll", `\n  ${style.gray(OMK_VERSION_FOOTER)}\n`)
  .configureOutput({
    writeErr: (str) => process.stderr.write(style.red(str)),
    outputError: (str, write) => write(style.red(`✖ ${str}`)),
  })
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.sudo) {
      process.env.OMK_SUDO = "1";
    }
  })
  .allowUnknownOption(false)
  .argument("[command]", "subcommand to run")
  .action(async (command?: string) => {
    await initI18n();
    const customHelp = buildCustomHelp();
    if (command) {
      console.error(t("cli.unknownCommand", command));
      console.log(customHelp);
      process.exit(1);
    }
    const globalOpts = program.opts();
    const hasTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);

    // Render HUD and check updates concurrently
    const hudPromise = (async () => {
      try {
        const { renderHudDashboard } = await import("./commands/hud.js");
        const hud = await renderHudDashboard({
          runId: globalOpts.runId,
          terminalWidth: process.stdout.columns || 120,
        });
        const lines = hud.split("\n");
        // Use terminal height to show as much HUD as possible (reserve 6 lines for mode selector + prompt)
        const termRows = process.stdout.rows || 24;
        const maxLines = Math.max(10, termRows - 6);
        return lines.slice(0, Math.min(lines.length, maxLines)).join("\n");
      } catch {
        return kimicatCliHero();
      }
    })();

    const updatePromise = (async () => {
      try {
        const { checkUpdates } = await import("./util/update-check.js");
        const updateStatus = await checkUpdates();
        let banner = "";
        if (updateStatus.omk.outdated) {
          banner += `\n  ${style.orange("!")} omk ${updateStatus.omk.current} → ${updateStatus.omk.latest}  |  ${style.gray(updateStatus.omk.installCmd)}`;
        }
        if (updateStatus.kimi.outdated) {
          banner += `\n  ${style.orange("!")} kimi ${updateStatus.kimi.installed} → ${updateStatus.kimi.latest}  |  ${style.gray("omk update kimi")}`;
        }
        return { banner, status: updateStatus };
      } catch {
        return { banner: "", status: null };
      }
    })();

    console.log(await hudPromise);

    const { banner: updateBanner, status } = await updatePromise;
    if (updateBanner) console.log(updateBanner);

    if (!hasTty) {
      const c = (k: string) => t(k).replace(/^.*? — /, "");
      console.log(style.gray(`
  💡 omk chat  — ${c("cli.suggestionChat")}`));
      console.log(style.gray(`  💡 omk hud   — ${c("cli.suggestionHud")}`));
      console.log(style.gray(`  💡 omk menu  — Show interactive menu`));
      console.log(style.gray(`  💡 omk --help — ${c("cli.suggestionHelp")}`));
      return;
    }

    // Interactive update prompt when omk is outdated
    if (status && status.omk.outdated) {
      try {
        const { select } = await import("@inquirer/prompts");
        const answer = await select(
          {
            message: `A new version of oh-my-kimi is available (${status.omk.current} → ${status.omk.latest}). Update now?`,
            choices: [
              { name: `YES — run ${status.omk.installCmd}`, value: "yes" },
              { name: "NO — skip this update", value: "no" },
            ],
          },
          { signal: AbortSignal.timeout(30_000) }
        );
        if (answer === "yes") {
          console.log(style.gray("Running update…"));
          const { runShell } = await import("./util/shell.js");
          const updateResult = await runShell("npm", ["i", "-g", "@oh-my-kimi/cli"], { timeout: 120_000 });
          if (updateResult.failed) {
            console.log(style.red(`✖ Update failed: ${updateResult.stderr.trim() || updateResult.stdout.trim()}`));
            process.exit(1);
          } else {
            console.log(themeStatus.success("Update completed successfully. Restart your terminal to use the new version."));
            process.exit(0);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") {
          console.log(style.gray("Update prompt cancelled."));
          process.exit(0);
        }
        // Non-TTY or timeout — silently continue to chat
      }
    }

    // ── Mode selector: Tab to cycle, Enter to confirm ──
    const { promptModeCycle } = await import("./util/mode-selector.js");
    const selectedMode = await promptModeCycle();

    const { getModePreset } = await import("./util/mode-preset.js");
    const preset = getModePreset(selectedMode);
    const launchCmd = preset?.launchCommand ?? "chat";

    const { spawnSync } = await import("child_process");

    if (launchCmd === "menu") {
      const menuArgs = [process.argv[1]!, "menu"];
      if (globalOpts.runId) menuArgs.push("--run-id", globalOpts.runId);
      if (globalOpts.workers) menuArgs.push("--workers", globalOpts.workers);
      const result = spawnSync(process.execPath, menuArgs, { stdio: "inherit" });
      if (result.status && result.status !== 0) {
        process.exitCode = result.status;
      }
    } else if (launchCmd === "chat") {
      const chatArgs = [process.argv[1]!, "chat", "--layout", "auto", "--brand", "kimicat"];
      if (globalOpts.runId) chatArgs.push("--run-id", globalOpts.runId);
      if (globalOpts.workers) chatArgs.push("--workers", globalOpts.workers);
      chatArgs.push("--mode", selectedMode);
      const result = spawnSync(process.execPath, chatArgs, { stdio: "inherit" });
      if (result.status && result.status !== 0) {
        process.exitCode = result.status;
      }
    } else if (launchCmd === "review") {
      const reviewArgs = [process.argv[1]!, "review"];
      if (globalOpts.runId) reviewArgs.push("--run-id", globalOpts.runId);
      const result = spawnSync(process.execPath, reviewArgs, { stdio: "inherit" });
      if (result.status && result.status !== 0) {
        process.exitCode = result.status;
      }
    } else if (launchCmd === "doctor") {
      const doctorArgs = [process.argv[1]!, "doctor"];
      const result = spawnSync(process.execPath, doctorArgs, { stdio: "inherit" });
      if (result.status && result.status !== 0) {
        process.exitCode = result.status;
      }
    }
  });

program.hook("preAction", async (_thisCommand, _actionCommand) => {
  const globalOpts = program.opts();
  if (globalOpts.runId) {
    process.env.OMK_RUN_ID = globalOpts.runId;
  }
});

program.hook("postAction", async (_thisCommand, actionCommand) => {
  try {
    const { maybeAskForGitHubStarAfterCommand } = await import("./util/first-run-star.js");
    await maybeAskForGitHubStarAfterCommand({
      version: OMK_VERSION,
      commandName: actionCommand.name(),
    });
  } catch {
    // Swallow star prompt errors so original command success is preserved.
  }
});

program
  .command("star")
  .description(t("cmd.starDesc"))
  .option("--status", "Show local star prompt state")
  .action(async (options) => {
    const { starCommand } = await import("./commands/star.js");
    await starCommand(options);
  });

program
  .command("menu")
  .description("Show interactive OMK main menu")
  .action(async () => {
    const globalOpts = program.opts();
    const { menuCommand } = await import("./commands/menu.js");
    await menuCommand({ runId: globalOpts.runId, workers: globalOpts.workers });
  });

program
  .command("mode [preset]")
  .description(t("cmd.modeDesc"))
  .option("-l, --list", t("cmd.modeListDesc"))
  .action(async (preset, options) => {
    const { modeCommand } = await import("./commands/mode.js");
    await modeCommand(preset, { list: Boolean(options.list) });
  });

program
  .command("update")
  .description("Check or run OMK and Kimi CLI updates")
  .argument("[action]", "check (default) | omk | kimi")
  .option("--json", "Output update status as JSON")
  .option("--refresh", "Force refresh update cache")
  .option("--yes", "Skip confirmation prompt")
  .option("--install-script", "Print official Kimi install script (no execution)")
  .action(async (action, options) => {
    const { checkUpdates } = await import("./util/update-check.js");
    const actionMode = action ?? "check";
    if (actionMode === "check") {
      const status = await checkUpdates(Boolean(options.refresh));
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      const kimiLabel = status.kimi.installed
        ? (status.kimi.outdated
          ? `${status.kimi.installed} → ${style.orange(status.kimi.latest ?? "?")}`
          : `${status.kimi.installed} ${style.gray("(latest)")}`)
        : style.red("not installed");
      console.log(`  kimi: ${kimiLabel}`);
      if (status.kimi.outdated) console.log(`  ℹ️  ${style.gray(status.kimi.installCmd)}`);
      if (status.omk.error) console.log(style.gray(`  omk error: ${status.omk.error}`));
      if (status.kimi.error) console.log(style.gray(`  kimi error: ${status.kimi.error}`));
      if (status.cacheHit) console.log(style.gray(`
  (cached, checked ${status.checkedAt})`));
      console.log("");
      return;
    }

      // install-script handled inside actionMode === "kimi" block

    const isInstallScript = actionMode === "kimi" && options.installScript;
    if (!process.stdout.isTTY && !options.yes && !isInstallScript) {
      console.error("Interactive update requires a TTY. Use --yes to skip confirmation.");
      process.exit(1);
    }
    if (actionMode === "omk") {
      if (!options.yes) {
        console.log("Upgrade omk via: npm i -g @oh-my-kimi/cli");
        console.log("Press Enter to continue or Ctrl+C to cancel...");
        const rl = (await import("readline")).createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>((resolve) => rl.question("", () => { rl.close(); resolve(); }));
      }
      const { runShell } = await import("./util/shell.js");
      const result = await runShell("npm", ["i", "-g", "@oh-my-kimi/cli"], { stdio: "inherit", timeout: 120_000 });
      process.exit(result.failed ? (result.exitCode ?? 1) : 0);
    }
    if (actionMode === "kimi") {
      // --install-script is safe without TTY
      if (options.installScript) {
        const st = await checkUpdates();
        console.log(st.kimi.installScript);
        return;
      }

      const { runShell } = await import("./util/shell.js");
      const kimiCheck = await runShell("kimi", ["--version"], { timeout: 10000 });
      const needsInstall = kimiCheck.failed;

      if (!options.yes && !needsInstall) {
        console.log("Upgrade kimi-cli via: uv tool upgrade kimi-cli --no-cache");
        console.log("Press Enter to continue or Ctrl+C to cancel...");
        const rl = (await import("readline")).createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>((resolve) => rl.question("", () => { rl.close(); resolve(); }));
      }

      if (needsInstall) {
        const script = process.platform === "win32"
          ? "Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression"
          : "curl -LsSf https://code.kimi.com/install.sh | bash";
        console.log(`Kimi CLI not found. Installing via official script...`);
        if (process.platform === "win32") {
          console.error("Please run the following in PowerShell:");
          console.log(script);
          process.exit(1);
        }
        const result = await runShell("bash", ["-c", script], { stdio: "inherit", timeout: 300_000 });
        process.exit(result.failed ? (result.exitCode ?? 1) : 0);
      }

      const result = await runShell("uv", ["tool", "upgrade", "kimi-cli", "--no-cache"], { stdio: "inherit", timeout: 120_000 });
      if (result.failed) {
        console.error("uv tool upgrade failed. Is uv installed? (pip install uv)");
        console.error("Fallback: try the official install script:");
        console.error(process.platform === "win32"
          ? "Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression"
          : "curl -LsSf https://code.kimi.com/install.sh | bash");
      }
      process.exit(result.failed ? (result.exitCode ?? 1) : 0);
    }
    console.error(`Unknown update action: ${actionMode}`);
    process.exit(1);
  });

program
  .command("runs")
  .description(t("cmd.runsDesc"))
  .option("-n, --limit <n>", t("cmd.runsLimitOption"), "20")
  .option("-w, --watch", t("cmd.runsWatchOption"))
  .option("--refresh <ms>", t("cmd.runsRefreshOption"), "3000")
  .option("--status <status>", t("cmd.runsStatusOption"))
  .option("--search <keyword>", t("cmd.runsSearchOption"))
  .option("--since <iso-date>", t("cmd.runsSinceOption"))
  .option("--until <iso-date>", t("cmd.runsUntilOption"))
  .option("--stats", "Show aggregate statistics instead of list")
  .option("--insights", "Show parallel-computed insights (longest, most complex, failure hotspots, activity)")
  .option("--export <path>", t("cmd.runsExportOption"))
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const { runsCommand } = await import("./commands/runs.js");
    await runsCommand({
      limit: Number.parseInt(options.limit, 10),
      watch: Boolean(options.watch),
      refreshMs: Number.parseInt(options.refresh, 10),
      json: Boolean(options.json),
      statusFilter: options.status,
      searchKeyword: options.search,
      sinceMs: options.since ? Date.parse(options.since) : undefined,
      untilMs: options.until ? Date.parse(options.until) : undefined,
      stats: Boolean(options.stats),
      exportPath: options.export,
      insights: Boolean(options.insights),
    });
  });

program
  .command("history")
  .description(t("cmd.historyDesc"))
  .option("-n, --limit <n>", t("cmd.runsLimitOption"), "20")
  .option("-w, --watch", t("cmd.runsWatchOption"))
  .option("--refresh <ms>", t("cmd.runsRefreshOption"), "3000")
  .option("--status <status>", t("cmd.runsStatusOption"))
  .option("--search <keyword>", t("cmd.runsSearchOption"))
  .option("--since <iso-date>", t("cmd.runsSinceOption"))
  .option("--until <iso-date>", t("cmd.runsUntilOption"))
  .option("--stats", "Show aggregate statistics instead of list")
  .option("--insights", "Show parallel-computed insights (longest, most complex, failure hotspots, activity)")
  .option("--export <path>", t("cmd.runsExportOption"))
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const { runsCommand } = await import("./commands/runs.js");
    await runsCommand({
      limit: Number.parseInt(options.limit, 10),
      watch: Boolean(options.watch),
      refreshMs: Number.parseInt(options.refresh, 10),
      json: Boolean(options.json),
      statusFilter: options.status,
      searchKeyword: options.search,
      sinceMs: options.since ? Date.parse(options.since) : undefined,
      untilMs: options.until ? Date.parse(options.until) : undefined,
      stats: Boolean(options.stats),
      exportPath: options.export,
      insights: Boolean(options.insights),
    });
  });

program
  .command("init")
  .description(t("cmd.initDesc"))
  .option("--profile <profile>", t("cmd.initProfileOption"), "fullstack")
  .option("--no-interactive-setup", t("cmd.initNoInteractiveSetupOption"))
  .option("--local-user", "Use global ~/.kimi MCP/skills at runtime without copying personal files into the project")
  .option("--import-user-skills", "Import personal/global skills into this project (trusted local use only)")
  .action(async (options) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(options);
  });

program
  .command("doctor")
  .description(t("cmd.doctorDesc"))
  .option("--json", t("cmd.doctorJsonOption"))
  .option("--soft", "Soft mode: do not fail on missing tools")
  .action(async (options) => {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand(options);
  });

program
  .command("index")
  .description(t("cmd.indexDesc"))
  .option("--changed", t("cmd.indexChangedOption"))
  .option("--symbols", t("cmd.indexSymbolsOption"))
  .action(async (options) => {
    const { indexCommand } = await import("./commands/project-index.js");
    await indexCommand({ ...options, symbols: Boolean(options.symbols) });
  });

program
  .command("index-show")
  .description(t("cmd.indexShowDesc"))
  .action(async () => {
    const { indexShowCommand } = await import("./commands/project-index.js");
    await indexShowCommand();
  });

const skill = program.command("skill").description(t("cmd.skillDesc"));
skill
  .command("pack")
  .description(t("cmd.skillPackDesc"))
  .action(async () => {
    const { skillPackCommand } = await import("./commands/skill.js");
    await skillPackCommand();
  });
skill
  .command("install <pack>")
  .description(t("cmd.skillInstallDesc"))
  .action(async (pack) => {
    const { skillInstallCommand } = await import("./commands/skill.js");
    await skillInstallCommand(pack);
  });
skill
  .command("sync")
  .description(t("cmd.skillSyncDesc"))
  .action(async () => {
    const { skillSyncCommand } = await import("./commands/skill.js");
    await skillSyncCommand();
  });

program
  .command("summary")
  .description(t("cmd.summaryDesc"))
  .action(async () => {
    const { summaryLatestCommand } = await import("./commands/summary.js");
    await summaryLatestCommand();
  });

program
  .command("summary-show [run-id]")
  .description(t("cmd.summaryShowDesc"))
  .action(async (runId) => {
    const { summaryShowCommand } = await import("./commands/summary.js");
    await summaryShowCommand(runId);
  });

program
  .command("chat")
  .description(t("cmd.chatDesc"))
  .option("--agent-file <path>", t("cmd.chatAgentOption"))
  .option("--workers <n>", t("cmd.chatWorkersOption"), "auto")
  .option("--max-steps-per-turn <n>", t("cmd.chatMaxStepsOption"))
  .option("--layout <auto|tmux|inline|plain>", t("cmd.chatLayoutOption"), "auto")
  .option("--brand <kimicat|minimal|plain>", t("cmd.chatBrandOption"), "kimicat")
  .option("--mode <agent|plan|chat|debugging|review>", "OMK execution mode")
  .option("--cockpit-refresh <ms>", "Cockpit refresh interval in milliseconds", "2000")
  .option("--cockpit-redraw <diff|full|append>", "Cockpit redraw mode", "diff")
  .option("--cockpit-history <off|static|watch>", "Cockpit history pane mode", "static")
  .option("--cockpit-side-width <percent>", "Cockpit side pane width percentage", "40")
  .option("--cockpit-height <rows>", "Cockpit fixed height in rows", "18")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { chatCommand } = await import("./commands/chat.js");
    await chatCommand({ ...options, runId: globalOpts.runId });
  });

program
  .command("research <query>")
  .description("Run a web research query via Kimi native SearchWeb/FetchURL")
  .option("--agent-file <path>", "Custom researcher agent YAML")
  .action(async (query, options) => {
    const { researchCommand } = await import("./commands/research.js");
    await researchCommand({ query, agentFile: options.agentFile });
  });

program
  .command("cockpit")
  .description(t("cmd.cockpitDesc"))
  .option("--run-id <id>", t("cmd.cockpitRunIdOption"))
  .option("-w, --watch", t("cmd.cockpitWatchOption"))
  .option("--refresh <ms>", t("cmd.cockpitRefreshOption"), "1500")
  .option("--redraw <diff|full|append>", "Redraw mode", "diff")
  .option("--height <rows>", "Cockpit fixed height in rows", "18")
  .option("--no-clear", "Do not clear screen between refreshes")
  .option("--pause", "Start paused")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { cockpitCommand } = await import("./commands/cockpit.js");
    await cockpitCommand({
      ...options,
      runId: globalOpts.runId ?? options.runId,
      refreshMs: options.refresh ? Number.parseInt(options.refresh, 10) : undefined,
      height: options.height ? Number.parseInt(options.height, 10) : undefined,
    });
  });

program
  .command("plan <goal>")
  .description(t("cmd.planDesc"))
  .option("--thinking <mode>", "thinking mode", "enabled")
  .option("--spec-kit", t("cmd.featureSpecKitOption"))
  .option("--no-spec-kit", t("cmd.featureNoSpecKitOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { planCommand } = await import("./commands/plan.js");
    await planCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("feature <goal>")
  .description(t("cmd.featureDesc"))
  .option("--spec-kit", t("cmd.featureSpecKitOption"))
  .option("--no-spec-kit", t("cmd.featureNoSpecKitOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { featureCommand } = await import("./commands/workflow.js");
    await featureCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("bugfix <goal>")
  .description(t("cmd.bugfixDesc"))
  .option("--spec-kit", t("cmd.bugfixSpecKitOption"))
  .option("--no-spec-kit", t("cmd.bugfixNoSpecKitOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { bugfixCommand } = await import("./commands/workflow.js");
    await bugfixCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("refactor <goal>")
  .description(t("cmd.refactorDesc"))
  .option("--spec-kit", t("cmd.refactorSpecKitOption"))
  .option("--no-spec-kit", t("cmd.refactorNoSpecKitOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { refactorCommand } = await import("./commands/workflow.js");
    await refactorCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("review")
  .description(t("cmd.reviewDesc"))
  .option("--ci", t("cmd.reviewCiOption"))
  .option("--soft", t("cmd.reviewSoftOption"))
  .action(async (options) => {
    const globalOpts = program.opts();
    const { reviewCommand } = await import("./commands/workflow.js");
    const result = await reviewCommand({ ...options, runId: globalOpts.runId });
    applyExitCode(result);
  });

program
  .command("run [flow] [goal]")
  .description(t("cmd.runDesc"))
  .option("--workers <n>", t("cmd.runWorkersOption"), "auto")
  .option("--timeout-preset <preset>", t("cmd.runTimeoutPresetOption"))
  .option("--provider <auto|kimi>", "provider policy (auto | kimi)", "auto")
  .action(async (flow, goal, options) => {
    const globalOpts = program.opts();
    const { runCommand } = await import("./commands/run.js");
    await runCommand(flow, goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("team")
  .description(t("cmd.teamDesc"))
  .option("--workers <n>", t("cmd.teamWorkersOption"), "auto")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { teamCommand } = await import("./commands/team.js");
    await teamCommand({ ...options, runId: globalOpts.runId });
  });

program
  .command("parallel [goal]")
  .description(t("cmd.parallelDesc"))
  .option("--workers <n>", t("cmd.parallelWorkersOption"), "auto")
  .option("--timeout-preset <preset>", t("cmd.parallelTimeoutPresetOption"))
  .option("--provider <auto|kimi>", "provider policy (auto | kimi)", "auto")
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
    const { parallelCommand } = await import("./commands/parallel.js");
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

const provider = program.command("provider").description("Provider routing and availability utilities");
provider
  .command("doctor [provider]")
  .description("Check provider availability without exposing credentials")
  .option("--json", "Output JSON")
  .option("--soft", "Do not set a failing exit code when unavailable")
  .action(async (target, options) => {
    const { providerDoctorCommand } = await import("./commands/provider.js");
    await providerDoctorCommand(target, options);
  });
const deepseekProvider = provider.command("deepseek").description("Manage DeepSeek opportunistic workers");
deepseekProvider
  .command("enable")
  .description("Enable DeepSeek opportunistic read-only workers")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { providerDeepSeekEnableCommand } = await import("./commands/provider.js");
    await providerDeepSeekEnableCommand(options);
  });
deepseekProvider
  .command("disable [reason]")
  .description("Disable DeepSeek workers and force Kimi-only fallback")
  .option("--json", "Output JSON")
  .action(async (reason, options) => {
    const { providerDeepSeekDisableCommand } = await import("./commands/provider.js");
    await providerDeepSeekDisableCommand(reason, options);
  });
deepseekProvider
  .command("set")
  .description("Save DeepSeek API key via masked prompt, stdin, or --from-env")
  .option("--from-env <name>", "Read API key from an environment variable")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { providerDeepSeekSetCommand } = await import("./commands/provider.js");
    await providerDeepSeekSetCommand(options);
  });

const deepseek = program.command("deepseek").description("Manage official DeepSeek API access and OMK provider routing");
deepseek
  .command("api")
  .alias("set")
  .description("Set the official DeepSeek API key via masked prompt, stdin, or --from-env")
  .option("--from-env <name>", "Read API key from an environment variable")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { providerDeepSeekApiCommand } = await import("./commands/provider.js");
    await providerDeepSeekApiCommand(options);
  });
deepseek
  .command("enable")
  .description("Enable DeepSeek opportunistic read-only/advisory workers")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { providerDeepSeekEnableCommand } = await import("./commands/provider.js");
    await providerDeepSeekEnableCommand(options);
  });
deepseek
  .command("disable [reason]")
  .description("Disable DeepSeek workers and force Kimi-only fallback")
  .option("--json", "Output JSON")
  .action(async (reason, options) => {
    const { providerDeepSeekDisableCommand } = await import("./commands/provider.js");
    await providerDeepSeekDisableCommand(reason, options);
  });
deepseek
  .command("doctor")
  .alias("status")
  .description("Check DeepSeek API key, enabled state, and balance without exposing credentials")
  .option("--json", "Output JSON")
  .option("--soft", "Do not set a failing exit code when unavailable")
  .action(async (options) => {
    const { providerDoctorCommand } = await import("./commands/provider.js");
    await providerDoctorCommand("deepseek", options);
  });

program
  .command("deepseekset")
  .description("Alias: save DeepSeek API key via masked prompt, stdin, or --from-env")
  .option("--from-env <name>", "Read API key from an environment variable")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { providerDeepSeekSetCommand } = await import("./commands/provider.js");
    await providerDeepSeekSetCommand(options);
  });

const graph = program.command("graph").description("Inspect OMK ontology graph");
graph
  .command("view")
  .description("Generate an HTML view for .omk/memory/graph-state.json")
  .option("--input <path>", "Input graph-state.json path")
  .option("--output <path>", "Output HTML path")
  .option("--limit <n>", "Maximum visible nodes", "900")
  .option("--type <types>", "Comma-separated node types, e.g. Memory,Decision,Task,Risk,File")
  .option("--include-memory-versions", "Include MemoryVersion nodes")
  .option("--open", "Open generated HTML in browser")
  .action(async (options) => {
    const { graphViewCommand } = await import("./commands/graph.js");
    await graphViewCommand(options);
  });

program
  .command("hud")
  .description(t("cmd.hudDesc"))
  .option("-w, --watch", t("cmd.hudWatchOption"))
  .option("--refresh <ms>", t("cmd.hudRefreshOption"), "2000")
  .option("--compact", "show compact dashboard")
  .option("--section <section>", "show only one section (run|project|resources)")
  .option("--no-clear", "do not clear screen between refreshes")
  .option("--alternate-screen", "use alternate screen buffer")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { hudCommand } = await import("./commands/hud.js");

    const validSections = ["run", "project", "resources"];
    if (options.section && !validSections.includes(options.section)) {
      console.error(`Invalid section: ${options.section}. Valid values: ${validSections.join(", ")}`);
      process.exit(1);
    }

    await hudCommand({
      runId: globalOpts.runId,
      watch: Boolean(options.watch),
      refreshMs: Number.parseInt(options.refresh, 10),
      compact: options.compact,
      section: options.section,
      noClear: options.noClear,
      alternateScreen: options.alternateScreen,
    });
  });

program
  .command("merge [run-id]")
  .description(t("cmd.mergeDesc"))
  .option("--run <id>", "run ID", "latest")
  .option("--strategy <strategy>", "merge strategy (first | best)", "first")
  .option("--dry-run", "preview merge without applying")
  .action(async (runIdArg, options) => {
    const globalOpts = program.opts();
    const { mergeCommand } = await import("./commands/merge.js");
    await mergeCommand({ ...options, runId: globalOpts.runId, run: runIdArg ?? options.run });
  });

program
  .command("sync")
  .description(t("cmd.syncDesc"))
  .option("--global", t("cmd.syncGlobalOption"))
  .option("--dry-run", t("cmd.syncDryRunOption"))
  .option("--diff", t("cmd.syncDiffOption"))
  .option("--rollback", t("cmd.syncRollbackOption"))
  .action(async (options) => {
    const { syncCommand } = await import("./commands/sync.js");
    await syncCommand(options);
  });

program
  .command("lsp [server]")
  .description(t("cmd.lspDesc"))
  .option("--print-config", t("cmd.lspPrintConfigOption"))
  .option("--check", t("cmd.lspCheckOption"))
  .action(async (server, options) => {
    const { lspCommand } = await import("./commands/lsp.js");
    await lspCommand(server, options);
  });

const design = program.command("design").description(t("cmd.designDesc"));
design
  .command("init")
  .description(t("cmd.designInitDesc"))
  .action(async () => {
    const { designInitCommand } = await import("./commands/design.js");
    await designInitCommand();
  });
design
  .command("list")
  .description(t("cmd.designListDesc"))
  .action(async () => {
    const { designListCommand } = await import("./commands/design.js");
    await designListCommand();
  });
design
  .command("apply <name>")
  .description(t("cmd.designDownloadDesc"))
  .action(async (name) => {
    const { designApplyCommand } = await import("./commands/design.js");
    await designApplyCommand(name);
  });
design
  .command("search <keyword>")
  .description(t("cmd.designSearchDesc"))
  .action(async (keyword) => {
    const { designSearchCommand } = await import("./commands/design.js");
    await designSearchCommand(keyword);
  });
design
  .command("lint [file]")
  .description(t("cmd.designValidateDesc"))
  .action(async (file) => {
    const { designLintCommand } = await import("./commands/design.js");
    await designLintCommand(file);
  });
design
  .command("diff [from] [to]")
  .description("DESIGN.md diff")
  .action(async (from, to) => {
    const { designDiffCommand } = await import("./commands/design.js");
    await designDiffCommand(from, to);
  });
design
  .command("export <format> [file]")
  .description(t("cmd.designExportDesc"))
  .action(async (format, file) => {
    const { designExportCommand } = await import("./commands/design.js");
    await designExportCommand(format, file);
  });

const google = program.command("google").description(t("cmd.googleDesc"));
google
  .command("stitch-install")
  .description(t("cmd.googleSkillsDesc"))
  .action(async () => {
    const { stitchInstallCommand } = await import("./commands/google.js");
    await stitchInstallCommand();
  });

const snip = program.command("snip").description("Manage reusable code snippets");
snip
  .command("save <name>")
  .description("Save a snippet from stdin or file")
  .option("-f, --file <path>", "Read snippet content from file")
  .option("-t, --tags <tags>", "Comma-separated tags")
  .action(async (name, options) => {
    const { snipSaveCommand } = await import("./commands/snip.js");
    await snipSaveCommand(name, options);
  });
snip
  .command("get <name>")
  .description("Print a snippet")
  .action(async (name) => {
    const { snipGetCommand } = await import("./commands/snip.js");
    await snipGetCommand(name);
  });
snip
  .command("list")
  .description("List all snippets")
  .action(async () => {
    const { snipListCommand } = await import("./commands/snip.js");
    await snipListCommand();
  });
snip
  .command("search <query>")
  .description("Search snippets")
  .action(async (query) => {
    const { snipSearchCommand } = await import("./commands/snip.js");
    await snipSearchCommand(query);
  });
snip
  .command("delete <name>")
  .description("Delete a snippet")
  .action(async (name) => {
    const { snipDeleteCommand } = await import("./commands/snip.js");
    await snipDeleteCommand(name);
  });

const specify = program.command("specify").description(t("cli.specifyDesc"));
specify
  .command("init")
  .description("Initialize spec-driven development (spec-kit)")
  .option("--preset <name>", "Preset to apply")
  .action(async (options) => {
    const { specifyInitCommand } = await import("./commands/specify.js");
    await specifyInitCommand(options);
  });
const specifyWf = specify.command("workflow").description("Manage spec-kit workflows");
specifyWf
  .command("run <workflow-id>")
  .description("Run a spec-kit workflow (e.g. speckit)")
  .option("-i, --input <pairs...>", "Input key=value pairs")
  .action(async (workflowId, options) => {
    const { specifyWorkflowRunCommand } = await import("./commands/specify.js");
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
    const { specifyWorkflowListCommand } = await import("./commands/specify.js");
    await specifyWorkflowListCommand();
  });
const specifyExt = specify.command("extension").description("Manage spec-kit extensions");
specifyExt
  .command("add <name>")
  .description("Add an extension")
  .action(async (name) => {
    const { specifyExtensionAddCommand } = await import("./commands/specify.js");
    await specifyExtensionAddCommand(name);
  });
specifyExt
  .command("list")
  .description("List installed extensions")
  .action(async () => {
    const { specifyExtensionListCommand } = await import("./commands/specify.js");
    await specifyExtensionListCommand();
  });
specify
  .command("version")
  .description("Show spec-kit version")
  .action(async () => {
    const { specifyVersionCommand } = await import("./commands/specify.js");
    await specifyVersionCommand();
  });

const spec = program.command("spec").description(t("cmd.specDesc"));
spec
  .command("init")
  .description(t("cmd.specInitDesc"))
  .option("-f, --force", t("cmd.specInitForceOption"))
  .action(async (options) => {
    const { specInitCommand } = await import("./commands/spec.js");
    await specInitCommand(options);
  });
spec
  .command("status")
  .description(t("cmd.specStatusDesc"))
  .action(async () => {
    const { specStatusCommand } = await import("./commands/spec.js");
    await specStatusCommand();
  });
spec
  .command("check")
  .description(t("cmd.specCheckDesc"))
  .action(async () => {
    const { specCheckCommand } = await import("./commands/spec.js");
    await specCheckCommand();
  });
const specPreset = spec.command("preset").description("Manage spec-kit presets");
specPreset
  .command("install <name>")
  .description("Install a spec-kit preset (built-in: omk)")
  .action(async (name) => {
    const { specPresetInstallCommand } = await import("./commands/spec.js");
    await specPresetInstallCommand(name);
  });

const agent = program.command("agent").description(t("cmd.agentDesc"));
agent
  .command("list")
  .description(t("cmd.agentListDesc"))
  .action(async () => {
    const { agentListCommand } = await import("./commands/agent.js");
    await agentListCommand();
  });
agent
  .command("show <name>")
  .description(t("cmd.agentShowDesc"))
  .action(async (name) => {
    const { agentShowCommand } = await import("./commands/agent.js");
    await agentShowCommand(name);
  });
agent
  .command("create <name>")
  .description(t("cmd.agentCreateDesc"))
  .option("--from <template>", t("cmd.agentCreateFromOption"))
  .action(async (name, options) => {
    const { agentCreateCommand } = await import("./commands/agent.js");
    await agentCreateCommand(name, options);
  });
agent
  .command("doctor")
  .description(t("cmd.agentDoctorDesc"))
  .action(async () => {
    const { agentDoctorCommand } = await import("./commands/agent.js");
    await agentDoctorCommand();
  });

program
  .command("verify")
  .description(t("cmd.verifyDesc"))
  .option("--run <id>", t("cmd.verifyRunOption"))
  .option("--json", t("cmd.verifyJsonOption"))
  .action(async (options) => {
    const globalOpts = program.opts();
    const { verifyCommand } = await import("./commands/verify.js");
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
    const { goalCreateCommand } = await import("./commands/goal.js");
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
    const { goalListCommand } = await import("./commands/goal.js");
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
    const { goalShowCommand } = await import("./commands/goal.js");
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
  .action(async (goalId) => {
    const { goalPlanCommand } = await import("./commands/goal.js");
    try {
      await goalPlanCommand(goalId);
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
  .action(async (goalId, options) => {
    const { goalRunCommand } = await import("./commands/goal.js");
    try {
      await goalRunCommand(goalId, options);
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
    const { goalVerifyCommand } = await import("./commands/goal.js");
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
  .action(async (goalId, options) => {
    const { goalCloseCommand } = await import("./commands/goal.js");
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
  .action(async (goalId, options) => {
    const { goalBlockCommand } = await import("./commands/goal.js");
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
  .action(async (goalId, options) => {
    const { goalContinueCommand } = await import("./commands/goal.js");
    try {
      await goalContinueCommand(goalId, options);
    } catch (err) {
      if (err instanceof CliError) {
        if (process.exitCode === undefined) process.exitCode = err.exitCode;
        return;
      }
      throw err;
    }
  });

const mcp = program.command("mcp").description(t("cli.mcpDesc"));
mcp
  .command("list")
  .description(t("cmd.mcpListDesc"))
  .action(async () => {
    const { mcpListCommand } = await import("./commands/mcp.js");
    await mcpListCommand();
  });
mcp
  .command("doctor")
  .description(t("cmd.mcpDoctorDesc"))
  .action(async () => {
    const { mcpDoctorCommand } = await import("./commands/mcp.js");
    await mcpDoctorCommand();
  });
mcp
  .command("test <server>")
  .description(t("cmd.mcpTestDesc"))
  .action(async (server) => {
    const { mcpTestCommand } = await import("./commands/mcp.js");
    await mcpTestCommand(server);
  });
mcp
  .command("serve <server>")
  .description("Run a bundled MCP server over stdio")
  .action(async (server: string) => {
    if (server !== "omk-project") {
      console.error(`Unknown bundled MCP server: ${server}`);
      process.exitCode = 1;
      return;
    }
    await import("./mcp/omk-project-server.js");
  });
mcp
  .command("remove <server>")
  .description("Remove an MCP server from project-local .kimi/mcp.json or .omk/mcp.json")
  .action(async (server) => {
    const { mcpRemoveCommand } = await import("./commands/mcp.js");
    await mcpRemoveCommand(server);
  });
mcp
  .command("add <server>")
  .description("Copy an MCP server from global ~/.kimi/mcp.json into project .kimi/mcp.json")
  .action(async (server) => {
    const { mcpAddCommand } = await import("./commands/mcp.js");
    await mcpAddCommand(server);
  });
mcp
  .command("install <name> [args...]")
  .description("Install a new MCP server into project .kimi/mcp.json")
  .option("-e, --env <pair>", "Environment variable (KEY=VALUE)", (val: string, prev: string[]) => [...prev, val], [])
  .action(async (name, args, options) => {
    const { mcpInstallCommand } = await import("./commands/mcp.js");
    await mcpInstallCommand(name, args[0] ?? name, args.slice(1), { env: options.env });
  });
mcp
  .command("sync-global")
  .description("Import global Kimi MCP servers into project-local config")
  .option("--overwrite", "Overwrite existing local definitions with global ones")
  .option("--omk", "Write to .omk/mcp.json instead of .kimi/mcp.json")
  .action(async (options) => {
    const { mcpSyncGlobalCommand } = await import("./commands/mcp.js");
    await mcpSyncGlobalCommand(options);
  });

const dag = program.command("dag").description(t("cli.dagDesc"));
dag
  .command("from-spec [spec-dir]")
  .description("Convert spec-kit tasks.md to OMK DAG JSON")
  .option("-o, --output <path>", "Output JSON file path")
  .option("-p, --parallel", "Enable intra-phase parallelism")
  .option("-r, --run <id>", "Use spec from run ID (latest)")
  .action(async (specDir, options) => {
    const { dagFromSpecCommand } = await import("./commands/dag-from-spec.js");
    const root = (await import("./util/fs.js")).getProjectRoot();
    const dir = specDir ?? `${root}/specs`;
    await dagFromSpecCommand(dir, {
      output: options.output,
      parallel: Boolean(options.parallel),
      run: options.run,
    });
  });
dag
  .command("validate [file]")
  .description(t("cmd.dagValidateDesc"))
  .action(async (filePath) => {
    const { dagValidateCommand } = await import("./commands/dag.js");
    try {
      await dagValidateCommand(filePath);
    } catch {
      process.exit(1);
    }
  });
dag
  .command("show <run-id>")
  .description(t("cmd.dagShowDesc"))
  .action(async (runId) => {
    const { dagShowCommand } = await import("./commands/dag.js");
    await dagShowCommand(runId);
  });
dag
  .command("replay <run-id> [target] [subtarget]")
  .description(t("cmd.dagReplayDesc"))
  .option("--node <id>", t("cmd.dagReplayNodeOption"))
  .option("--from-failure", t("cmd.dagReplayFromFailureOption"))
  .option("--dry-run", t("cmd.dagReplayDryRunOption"))
  .option("--provider <auto|kimi>", "provider policy (auto | kimi)", "auto")
  .action(async (runId, target, subtarget, options) => {
    const { dagReplayCommand } = await import("./commands/dag.js");
    await dagReplayCommand(runId, target, subtarget, options);
  });

const cron = program.command("cron").description("Manage scheduled cron jobs");
cron
  .command("list")
  .description("List all configured cron jobs")
  .action(async () => {
    const { cronListCommand } = await import("./commands/cron.js");
    await cronListCommand();
  });
cron
  .command("run <job-name>")
  .description("Run a cron job immediately")
  .option("--dag-file <path>", "DAG file path for ad-hoc runs")
  .action(async (jobName, options) => {
    const { cronRunCommand } = await import("./commands/cron.js");
    await cronRunCommand(jobName, options);
  });
cron
  .command("logs <job-name>")
  .description("Show recent runs for a cron job")
  .action(async (jobName) => {
    const { cronLogsCommand } = await import("./commands/cron.js");
    await cronLogsCommand(jobName);
  });
cron
  .command("enable <job-name>")
  .description("Enable a cron job")
  .action(async (jobName) => {
    const { cronEnableCommand } = await import("./commands/cron.js");
    await cronEnableCommand(jobName);
  });
cron
  .command("disable <job-name>")
  .description("Disable a cron job")
  .action(async (jobName) => {
    const { cronDisableCommand } = await import("./commands/cron.js");
    await cronDisableCommand(jobName);
  });

const screenshot = program.command("screenshot").description("Manage project screenshots from clipboard");
screenshot
  .command("paste")
  .description("Paste clipboard image into .omk/screenshots/")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { screenshotPasteCommand } = await import("./commands/screenshot.js");
    await screenshotPasteCommand(options);
  });
screenshot
  .command("dir")
  .description("Print the screenshot directory path")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { screenshotDirCommand } = await import("./commands/screenshot.js");
    await screenshotDirCommand(options);
  });
screenshot
  .command("list")
  .description("List saved screenshots")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { screenshotListCommand } = await import("./commands/screenshot.js");
    await screenshotListCommand(options);
  });
screenshot
  .command("clean")
  .description("Remove screenshots older than N days")
  .option("--days <n>", "Age threshold in days", "7")
  .option("--dry-run", "Show what would be deleted without removing")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { screenshotCleanCommand } = await import("./commands/screenshot.js");
    await screenshotCleanCommand(options);
  });

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof Error && err.name === "ExitPromptError") {
    process.exit(0);
  }
  if (err instanceof CliError) {
    if (process.exitCode === undefined) {
      process.exitCode = err.exitCode;
    }
    return;
  }
  console.error("Unexpected error:", err);
  process.exit(1);
});
