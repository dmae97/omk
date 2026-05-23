import type { Command } from "commander";
import { t } from "../../util/i18n.js";

export function registerCoreCommands(program: Command): void {
  program
    .command("star")
    .description(t("cmd.starDesc"))
    .option("--status", "Show local star prompt state")
    .action(async (options) => {
      const { starCommand } = await import("../../commands/star.js");
      await starCommand(options);
    });

  program
    .command("menu")
    .description("Show interactive OMK main menu")
    .action(async () => {
      const globalOpts = program.opts();
      const { menuCommand } = await import("../../commands/menu.js");
      await menuCommand({ runId: globalOpts.runId, workers: globalOpts.workers });
    });

  program
    .command("mode [preset]")
    .description(t("cmd.modeDesc"))
    .option("-l, --list", t("cmd.modeListDesc"))
    .action(async (preset, options) => {
      const { modeCommand } = await import("../../commands/mode.js");
      await modeCommand(preset, { list: Boolean(options.list) });
    });
}
