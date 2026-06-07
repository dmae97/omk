import type { Command } from "commander";
import { t } from "../../util/i18n.js";

export function registerToolingCommands(program: Command): void {
  const webBridge = program.command("web-bridge").description("Manage the local OMK Chrome Web Bridge");
  webBridge
    .command("doctor")
    .description("Check Chrome extension/native-host/MCP readiness")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { webBridgeDoctorCommand } = await import("../../commands/web-bridge.js");
      await webBridgeDoctorCommand({ json: Boolean(options.json) });
    });
  webBridge
    .command("status")
    .description("Show Web Bridge status for harness/cockpit visibility")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { webBridgeStatusCommand } = await import("../../commands/web-bridge.js");
      await webBridgeStatusCommand({ json: Boolean(options.json) });
    });
  webBridge
    .command("install-host")
    .description("Print or write local Chrome native messaging host setup")
    .option("--json", "Output JSON")
    .option("--extension-id <id>", "Chrome extension ID to allow in the native-host manifest")
    .option("--browser <chrome|chromium|brave>", "Native host browser target", "chrome")
    .option("--write", "Write the local wrapper and native-host manifest")
    .action(async (options) => {
      const { webBridgeInstallHostCommand } = await import("../../commands/web-bridge.js");
      await webBridgeInstallHostCommand({
        json: Boolean(options.json),
        extensionId: options.extensionId,
        browser: options.browser,
        write: Boolean(options.write),
      });
    });
  webBridge
    .command("native-host")
    .description("Run the OMK Web Bridge Chrome native messaging host over stdio")
    .action(async () => {
      const { webBridgeNativeHostCommand } = await import("../../commands/web-bridge.js");
      await webBridgeNativeHostCommand();
    });

  program
    .command("index")
    .description(t("cmd.indexDesc"))
    .option("--changed", t("cmd.indexChangedOption"))
    .option("--symbols", t("cmd.indexSymbolsOption"))
    .action(async (options) => {
      const { indexCommand } = await import("../../commands/project-index.js");
      await indexCommand({ ...options, symbols: Boolean(options.symbols) });
    });

  program
    .command("index-show")
    .description(t("cmd.indexShowDesc"))
    .action(async () => {
      const { indexShowCommand } = await import("../../commands/project-index.js");
      await indexShowCommand();
    });

  const skill = program.command("skill").description(t("cmd.skillDesc"));
  skill
    .command("pack")
    .description(t("cmd.skillPackDesc"))
    .action(async () => {
      const { skillPackCommand } = await import("../../commands/skill.js");
      await skillPackCommand();
    });
  skill
    .command("catalog")
    .description("Show machine-readable skill catalog/status")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { skillCatalogCommand } = await import("../../commands/skill.js");
      await skillCatalogCommand(options);
    });
  skill
    .command("install <pack>")
    .description(t("cmd.skillInstallDesc"))
    .action(async (pack) => {
      const { skillInstallCommand } = await import("../../commands/skill.js");
      await skillInstallCommand(pack);
    });
  skill
    .command("sync")
    .description(t("cmd.skillSyncDesc"))
    .action(async () => {
      const { skillSyncCommand } = await import("../../commands/skill.js");
      await skillSyncCommand();
    });

  program
    .command("summary")
    .description(t("cmd.summaryDesc"))
    .option("--json", "Output the latest run summary as a JSON envelope")
    .action(async (options) => {
      const { summaryLatestCommand } = await import("../../commands/summary.js");
      await summaryLatestCommand(options);
    });

  program
    .command("summary-show [run-id]")
    .description(t("cmd.summaryShowDesc"))
    .action(async (runId) => {
      const { summaryShowCommand } = await import("../../commands/summary.js");
      await summaryShowCommand(runId);
    });

  program
    .command("diff-runs <run-a> <run-b>")
    .description("Compare two runs structurally (DAG, policy, decisions, tokens, context, evidence)")
    .option("--json", "Output diff report as JSON")
    .action(async (runA, runB, options) => {
      const { diffRunsCommand } = await import("../../commands/diff-runs.js");
      await diffRunsCommand(runA, runB, { json: Boolean(options.json) });
    });
}
