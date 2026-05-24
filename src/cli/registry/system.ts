import type { Command } from "commander";
import { style } from "../../util/theme.js";
import { t } from "../../util/i18n.js";

export function registerSystemCommands(program: Command): void {
  program
    .command("update")
    .description("Check or run OMK package and optional provider adapter updates")
    .argument("[action]", "check (default) | omk | kimi-adapter")
    .option("--json", "Output update status as JSON")
    .option("--refresh", "Force refresh update cache")
    .option("--yes", "Skip confirmation prompt")
    .option("--install-script", "Print official primary CLI install script (no execution)")
    .action(async (action, options) => {
      const { checkUpdates, OMK_NPM_PACKAGE_NAME } = await import("../../util/update-check.js");
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
        console.log(`  cli: ${kimiLabel}`);
        if (status.kimi.outdated) console.log(`  ℹ️  ${style.gray(status.kimi.installCmd)}`);
        if (status.omk.error) console.log(style.gray(`  omk error: ${status.omk.error}`));
        if (status.kimi.error) console.log(style.gray(`  cli error: ${status.kimi.error}`));
        if (status.cacheHit) console.log(style.gray(`
    (cached, checked ${status.checkedAt})`));
        console.log("");
        return;
      }

        // install-script handled inside actionMode === "kimi" block

      const isKimiAdapterAction = actionMode === "kimi-adapter" || actionMode === "kimi";
      const isInstallScript = isKimiAdapterAction && options.installScript;
      if (!process.stdout.isTTY && !options.yes && !isInstallScript) {
        console.error("Interactive update requires a TTY. Use --yes to skip confirmation.");
        process.exit(1);
      }
      if (actionMode === "omk") {
        if (!options.yes) {
          console.log(`Upgrade omk via: npm i -g ${OMK_NPM_PACKAGE_NAME}`);
          console.log("Press Enter to continue or Ctrl+C to cancel...");
          const rl = (await import("readline")).createInterface({ input: process.stdin, output: process.stdout });
          await new Promise<void>((resolve) => rl.question("", () => { rl.close(); resolve(); }));
        }
        const { runShell } = await import("../../util/shell.js");
        const result = await runShell("npm", ["i", "-g", OMK_NPM_PACKAGE_NAME], { stdio: "inherit", timeout: 120_000 });
        process.exit(result.failed ? (result.exitCode ?? 1) : 0);
      }
      if (isKimiAdapterAction) {
        // --install-script is safe without TTY
        if (options.installScript) {
          const st = await checkUpdates();
          console.log(st.kimi.installScript);
          return;
        }

        const { runShell } = await import("../../util/shell.js");
        const kimiCheck = await runShell("kimi", ["--version"], { timeout: 10000 });
        const needsInstall = kimiCheck.failed;

        if (!options.yes && !needsInstall) {
          console.log("Upgrade Kimi adapter CLI via: uv tool upgrade kimi-cli --no-cache");
          console.log("Press Enter to continue or Ctrl+C to cancel...");
          const rl = (await import("readline")).createInterface({ input: process.stdin, output: process.stdout });
          await new Promise<void>((resolve) => rl.question("", () => { rl.close(); resolve(); }));
        }

        if (needsInstall) {
          const script = process.platform === "win32"
            ? "Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression"
            : "curl -LsSf https://code.kimi.com/install.sh | bash";
          console.log("Kimi adapter CLI not found. Installing via official script...");
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
    .command("init")
    .description(t("cmd.initDesc"))
    .option("--profile <profile>", t("cmd.initProfileOption"), "fullstack")
    .option("--no-interactive-setup", t("cmd.initNoInteractiveSetupOption"))
    .option("--local-user", "Use global ~/.kimi MCP/skills at runtime without copying personal files into the project")
    .option("--home-dir <path>", "Trusted local home, ~/.kimi/mcp.json, or ~/.kimi/skills path")
    .option("--import-user-skills", "Import personal/global skills into this project (trusted local use only)")
    .action(async (options) => {
      const { initCommand } = await import("../../commands/init.js");
      await initCommand(options);
    });

  program
    .command("doctor")
    .description(t("cmd.doctorDesc"))
    .option("--json", t("cmd.doctorJsonOption"))
    .option("--soft", "Soft mode: do not fail on missing tools")
    .option("--fix", "Apply safe local repairs before reporting")
    .option("--global", "With --fix, also attempt explicit global CLI/git repairs")
    .option("--dry-run", "Preview doctor fixes without writing")
    .option("--fix-level <level>", "Doctor fix safety level: safe | recommended | aggressive", "safe")
    .option("--verify-fix", "Run doctor checks again after applying fixes", true)
    .option("--no-verify-fix", "Skip post-fix doctor verification")
    .option("--set-default-project-root <path>", "With --fix, set user default_project_root for HOME shell launches")
    .action(async (options) => {
      const { doctorCommand } = await import("../../commands/doctor.js");
      await doctorCommand(options);
    });
}
