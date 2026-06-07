import type { Command } from "commander";
import { style } from "../util/theme.js";
import { t, initI18n } from "../util/i18n.js";
import { buildCustomHelp } from "../util/help-text.js";
const OMK_ENTRY_BRAND = "neon-grid";
const OMK_ENTRY_UI = "neon-grid";

interface RootChatLaunchArgsOptions {
  readonly cliPath: string;
  readonly runId?: string;
  readonly workers?: string;
  readonly mode: string;
}

export function buildRootChatLaunchArgs(options: RootChatLaunchArgsOptions): string[] {
  const chatArgs = [
    options.cliPath,
    "chat",
    "--layout",
    "auto",
    "--brand",
    OMK_ENTRY_BRAND,
    "--ui",
    OMK_ENTRY_UI,
  ];
  if (options.runId) chatArgs.push("--run-id", options.runId);
  if (options.workers) chatArgs.push("--workers", options.workers);
  chatArgs.push("--mode", options.mode);
  if (options.mode !== "chat") chatArgs.push("--execution", "ask");
  return chatArgs;
}


export function configureRootProgram(program: Command, OMK_VERSION: string, OMK_VERSION_FOOTER: string): void {
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
        process.env.OMK_CLI_SUDO_REQUEST = "1";
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

      // Check updates before entering the root mode.
      const updatePromise = (async () => {
        try {
          const { checkUpdates, formatStartupUpdateBanner } = await import("../util/update-check.js");
          const updateStatus = await checkUpdates();
          const banner = formatStartupUpdateBanner(updateStatus);
          return { banner, status: updateStatus };
        } catch {
          return { banner: "", status: null };
        }
      })();
      const { banner: updateBanner, status } = await updatePromise;
      if (updateBanner) console.log(updateBanner);

      // Interactive update prompt when omk is outdated
      if (status && status.omk.outdated) {
        const { maybePromptForOmkUpdate } = await import("../util/update-check.js");
        const result = await maybePromptForOmkUpdate({ status, isTTY: hasTty, source: "root" });
        if (result.shouldExit) process.exit(result.exitCode ?? 0);
      }

      const { getCurrentMode } = await import("../util/mode-preset.js");
      const selectedMode = await getCurrentMode();
      const { spawnSync } = await import("child_process");
      const chatArgs = buildRootChatLaunchArgs({
        cliPath: process.argv[1]!,
        runId: globalOpts.runId,
        workers: globalOpts.workers,
        mode: selectedMode,
      });
      const childEnv = {
        ...process.env,
        OMK_ENTRY_SURFACE: "pi-omk",
      };
      const result = spawnSync(process.execPath, chatArgs, { stdio: "inherit", env: childEnv });
      if (result.status && result.status !== 0) {
        process.exitCode = result.status;
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
      const { maybeAskForGitHubStarAfterCommand } = await import("../util/first-run-star.js");
      await maybeAskForGitHubStarAfterCommand({
        version: OMK_VERSION,
        commandName: actionCommand.name(),
      });
    } catch {
      // Swallow star prompt errors so original command success is preserved.
    }
  });
}
