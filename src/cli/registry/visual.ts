import type { Command } from "commander";
import { t } from "../../util/i18n.js";

export function registerVisualCommands(program: Command): void {
  program
    .command("open-design")
    .alias("opendesign")
    .description(t("cmd.designOpenDesignDesc"))
    .option("--dir <path>", "Open Design checkout directory (default: .omk/open-design)")
    .option("--branch <branch>", "Open Design git branch or tag", "main")
    .option("--ref <ref>", "Open Design git ref/branch/tag/SHA (or OMK_OPEN_DESIGN_REF)")
    .option("--daemon-port <port>", "Open Design daemon localhost port", "7457")
    .option("--web-port <port>", "Open Design web localhost port", "5175")
    .option("--doctor", "Check Open Design bridge readiness without cloning, installing, or starting")
    .option("--foreground", "Run tools-dev in the foreground")
    .option("--no-install", "Skip pnpm install")
    .option("--update", "Run git pull --ff-only when the checkout already exists")
    .option("--open", "Open the localhost URL in the default browser")
    .option("--print-only", "Print the launch plan without cloning, installing, or starting")
    .option("--json", "With --doctor, output machine-readable JSON")
    .action(async (options) => {
      const { designOpenDesignCommand } = await import("../../commands/design.js");
      await designOpenDesignCommand(options);
    });

  program
    .command("open-design-agent")
    .description("Open Design local CLI bridge for OMK")
    .option("--artifact-dir <path>", "Directory where generated Open Design artifacts must be written")
    .option("--cwd <path>", "Workspace directory passed by Open Design")
    .option("--diagnose", "Run bounded bridge diagnostics without reading stdin or launching the agent")
    .option("--image <path>", "Image/screenshot path passed by Open Design; repeatable", (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    }, [])
    .option("--json", "Output diagnose/bridge status as JSON")
    .option("--model <model>", "Model override from Open Design")
    .option("--run-id <id>", "Stable Open Design bridge run id for artifacts")
    .option("--smoke", "Return the Open Design smoke-test response without launching the agent")
    .option("--stdio", "Read the Open Design prompt from stdin")
    .option("--stdin-idle-ms <ms>", "Maximum idle time while reading Open Design stdin", "3000")
    .option("--stdin-max-bytes <bytes>", "Maximum Open Design prompt size", "524288")
    .option("--stdin-timeout-ms <ms>", "Maximum total time while reading Open Design stdin", "30000")
    .option("--timeout-ms <ms>", "Maximum agent print-mode runtime", "1200000")
    .action(async (options: { artifactDir?: string; cwd?: string; diagnose?: boolean; image?: string[]; json?: boolean; model?: string; runId?: string; smoke?: boolean; stdio?: boolean; stdinIdleMs?: string; stdinMaxBytes?: string; stdinTimeoutMs?: string; timeoutMs?: string }) => {
      const { openDesignAgentCommand } = await import("../../commands/open-design-agent.js");
      await openDesignAgentCommand({ ...options, runId: options.runId ?? program.opts().runId });
      process.exit(process.exitCode ?? 0);
    });

  program
    .command("cockpit")
    .description(t("cmd.cockpitDesc"))
    .option("--run-id <id>", t("cmd.cockpitRunIdOption"))
    .option("-w, --watch", t("cmd.cockpitWatchOption"))
    .option("--refresh <ms>", t("cmd.cockpitRefreshOption"), "1500")
    .option("--redraw <diff|full|append>", "Redraw mode", "diff")
    .option("--height <rows>", "Cockpit height in rows (watch default: auto-fit pane; one-shot default: auto)")
    .option("--section <agents|todos|mcp|all>", "Cockpit section to render", "all")
    .option("--events <on|off>", "Use events.jsonl telemetry when available", "on")
    .option("--view <panel|rail|compact|json>", "Cockpit view mode", "panel")
    .option("--no-clear", "Do not clear screen between refreshes")
    .option("--pause", "Start paused")
    .action(async (options) => {
      const globalOpts = program.opts();
      const { cockpitCommand } = await import("../../commands/cockpit.js");
      await cockpitCommand({
        ...options,
        runId: globalOpts.runId ?? options.runId,
        refreshMs: options.refresh ? Number.parseInt(options.refresh, 10) : undefined,
        height: options.height ? Number.parseInt(options.height, 10) : undefined,
        redraw: options.redraw,
        section: options.section,
        events: options.events,
        view: options.view,
      });
    });

  program
    .command("rail")
    .description("Compact rail sidebar view of OMK cockpit")
    .option("--run-id <id>", "Run ID to focus on")
    .option("-w, --watch", "Watch mode")
    .option("--refresh <ms>", "Refresh interval in ms", "1500")
    .option("--height <rows>", "Fixed height in rows (default: auto)")
    .action(async (options) => {
      const globalOpts = program.opts();
      const { railCommand } = await import("../../commands/rail.js");
      await railCommand({
        runId: globalOpts.runId ?? options.runId,
        watch: Boolean(options.watch),
        refreshMs: options.refresh ? Number.parseInt(options.refresh, 10) : undefined,
        height: options.height ? Number.parseInt(options.height, 10) : undefined,
      });
    });
}
