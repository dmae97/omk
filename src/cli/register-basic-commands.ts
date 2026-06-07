import type { Command } from "commander";
import { style } from "../util/theme.js";
import { t } from "../util/i18n.js";
import { registerConsentCommand } from "../commands/consent.js";

export function registerBasicCommands(program: Command): void {
  program
    .command("star")
    .description(t("cmd.starDesc"))
    .option("--status", "Show local star prompt state")
    .action(async (options) => {
      const { starCommand } = await import("../commands/star.js");
      await starCommand(options);
    });

  program
    .command("menu")
    .description("Show interactive OMK main menu")
    .action(async () => {
      const globalOpts = program.opts();
      const { menuCommand } = await import("../commands/menu.js");
      await menuCommand({ runId: globalOpts.runId, workers: globalOpts.workers });
    });

  program
    .command("mode [preset]")
    .description(t("cmd.modeDesc"))
    .option("-l, --list", t("cmd.modeListDesc"))
    .action(async (preset, options) => {
      const { modeCommand } = await import("../commands/mode.js");
      await modeCommand(preset, { list: Boolean(options.list) });
    });

  program
    .command("version")
    .description("Print OMK version, runtime, contract, and schema status")
    .option("--json", "Output version report as a JSON envelope")
    .action(async (options) => {
      const { versionCommand } = await import("../commands/version.js");
      await versionCommand(options);
    });

  program
    .command("update")
    .description("Check or run OMK updates")
    .argument("[action]", "check (default) | omk | kimi")
    .option("--json", "Output update status as JSON")
    .option("--refresh", "Force refresh update cache")
    .option("--yes", "Skip confirmation prompt")
    .option("--install-script", "Print Kimi API setup guidance")
    .action(async (action, options) => {
      const { checkUpdates } = await import("../util/update-check.js");
      const actionMode = action ?? "check";
      if (actionMode === "check") {
        const status = await checkUpdates(Boolean(options.refresh));
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }
        console.log(`  omk: ${status.omk.current}${status.omk.latest ? ` → ${style.orange(status.omk.latest)}` : ""}`);
        if (status.omk.outdated) console.log(`  ℹ️  ${style.gray(status.omk.installCmd)}`);
        if (status.omk.error) console.log(style.gray(`  omk error: ${status.omk.error}`));
        if (status.cacheHit) console.log(style.gray(`
    (cached, checked ${status.checkedAt})`));
        console.log("");
        return;
      }

      const isKimiAdapterAction = actionMode === "kimi" || actionMode === "kimi-adapter";
      const isInstallScript = isKimiAdapterAction && options.installScript;
      if (!process.stdout.isTTY && !options.yes && !isInstallScript) {
        console.error("Interactive update requires a TTY. Use --yes to skip confirmation.");
        process.exit(1);
      }
      if (actionMode === "omk") {
        if (!options.yes) {
          console.log("Upgrade omk via: npm i -g @omk/cli");
          console.log("Press Enter to continue or Ctrl+C to cancel...");
          const rl = (await import("readline")).createInterface({ input: process.stdin, output: process.stdout });
          await new Promise<void>((resolve) => rl.question("", () => { rl.close(); resolve(); }));
        }
        const { runShell } = await import("../util/shell.js");
        const result = await runShell("npm", ["i", "-g", "@omk/cli"], { stdio: "inherit", timeout: 120_000 });
        process.exit(result.failed ? (result.exitCode ?? 1) : 0);
      }
      if (isKimiAdapterAction) {
        console.log([
          "Kimi support in OMK uses the direct Moonshot HTTP API.",
          "Set KIMI_API_KEY to enable explicit Kimi usage.",
          "Optional: set KIMI_MODEL or configure [providers.kimi] in ~/.omk/config.toml.",
          "There is no Kimi CLI package to install or upgrade for the default OMK runtime path.",
        ].join("\n"));
        return;
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
      const { runsCommand } = await import("../commands/runs.js");
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
      const { runsCommand } = await import("../commands/runs.js");
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
    .option("--home-dir <path>", "Trusted local Kimi home, ~/.kimi/mcp.json, or ~/.kimi/skills path")
    .option("--import-user-skills", "Import personal/global skills into this project (trusted local use only)")
    .action(async (options) => {
      const { initCommand } = await import("../commands/init.js");
      await initCommand(options);
    });

  program
    .command("doctor")
    .description(t("cmd.doctorDesc"))
    .option("--json", t("cmd.doctorJsonOption"))
    .option("--soft", "Soft mode: do not fail on missing tools")
    .option("--fix", "Apply safe local repairs before reporting")
    .option("--global", "With --fix, also attempt explicit global Kimi/git repairs")
    .option("--dry-run", "Preview doctor fixes without writing")
    .option("--fix-level <level>", "Doctor fix safety level: safe | recommended | aggressive", "safe")
    .option("--verify-fix", "Run doctor checks again after applying fixes", true)
    .option("--no-verify-fix", "Skip post-fix doctor verification")
    .option("--set-default-project-root <path>", "With --fix, set user default_project_root for HOME shell launches")
    .action(async (options) => {
      const { doctorCommand } = await import("../commands/doctor.js");
      await doctorCommand(options);
    });

  const webBridge = program.command("web-bridge").description("Manage the local OMK Chrome Web Bridge");
  webBridge
    .command("doctor")
    .description("Check Chrome extension/native-host/MCP readiness")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { webBridgeDoctorCommand } = await import("../commands/web-bridge.js");
      await webBridgeDoctorCommand({ json: Boolean(options.json) });
    });
  webBridge
    .command("status")
    .description("Show Web Bridge status for harness/cockpit visibility")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { webBridgeStatusCommand } = await import("../commands/web-bridge.js");
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
      const { webBridgeInstallHostCommand } = await import("../commands/web-bridge.js");
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
      const { webBridgeNativeHostCommand } = await import("../commands/web-bridge.js");
      await webBridgeNativeHostCommand();
    });

  program
    .command("index")
    .description(t("cmd.indexDesc"))
    .option("--changed", t("cmd.indexChangedOption"))
    .option("--symbols", t("cmd.indexSymbolsOption"))
    .action(async (options) => {
      const { indexCommand } = await import("../commands/project-index.js");
      await indexCommand({ ...options, symbols: Boolean(options.symbols) });
    });

  program
    .command("index-show")
    .description(t("cmd.indexShowDesc"))
    .action(async () => {
      const { indexShowCommand } = await import("../commands/project-index.js");
      await indexShowCommand();
    });

  const skill = program.command("skill").description(t("cmd.skillDesc"));
  skill
    .command("pack")
    .description(t("cmd.skillPackDesc"))
    .action(async () => {
      const { skillPackCommand } = await import("../commands/skill.js");
      await skillPackCommand();
    });
  skill
    .command("catalog")
    .description("Show machine-readable skill catalog/status")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { skillCatalogCommand } = await import("../commands/skill.js");
      await skillCatalogCommand(options);
    });
  skill
    .command("install <pack>")
    .description(t("cmd.skillInstallDesc"))
    .action(async (pack) => {
      const { skillInstallCommand } = await import("../commands/skill.js");
      await skillInstallCommand(pack);
    });
  skill
    .command("sync")
    .description(t("cmd.skillSyncDesc"))
    .action(async () => {
      const { skillSyncCommand } = await import("../commands/skill.js");
      await skillSyncCommand();
    });

  program
    .command("summary")
    .description(t("cmd.summaryDesc"))
    .option("--json", "Output the latest run summary as a JSON envelope")
    .action(async (options) => {
      const { summaryLatestCommand } = await import("../commands/summary.js");
      await summaryLatestCommand(options);
    });

  program
    .command("summary-show [run-id]")
    .description(t("cmd.summaryShowDesc"))
    .action(async (runId) => {
      const { summaryShowCommand } = await import("../commands/summary.js");
      await summaryShowCommand(runId);
    });

  program
    .command("chat")
    .description("Run OMK provider-neutral interactive orchestrator/chat coordinator")
    .option("--agent-file <path>", t("cmd.chatAgentOption"))
    .option("--workers <n>", t("cmd.chatWorkersOption"), "auto")
    .option("--mcp-scope <all|project|none>", "MCP scope for this chat session (all | project | none)")
    .option("--execution <ask|auto|parallel|sequential>", "Execution selection policy (ask | auto | parallel | sequential)")
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
    .option("--model <model>", "provider model or provider/model override")
    .option("--max-steps-per-turn <n>", t("cmd.chatMaxStepsOption"))
    .option("--layout <auto|tmux|inline|plain>", t("cmd.chatLayoutOption"), "auto")
    .option("--ui <legacy|plain-modern|rich|system24|green-rain|neon-grid|rust-forge>", "Chat UI renderer (legacy | plain-modern | rich | system24 | green-rain | neon-grid | rust-forge)")
    .option("--brand <omk|minimal|plain|green-rain|neon-grid|rust-forge>", "Chat branding (omk | minimal | plain | green-rain | neon-grid | rust-forge)", "omk")
    .option("--mode <agent|plan|chat|debugging|review>", "OMK execution mode")
    .option("--cockpit-refresh <ms>", "Cockpit refresh interval in milliseconds", "2000")
    .option("--cockpit-redraw <diff|full|append>", "Cockpit redraw mode", "diff")
    .option("--cockpit-history <off|static|watch>", "Cockpit history pane mode", "static")
    .option("--cockpit-side-width <percent>", "Cockpit side pane width percentage (default: auto, about 45-50%)")
    .option("--cockpit-height <rows>", "Cockpit height override in rows (watch default: auto-fit pane)")
    .option("--smoke", "Run chat startup preflight and runtime MCP merge checks without launching Kimi")
    .option("--json", "With --smoke, output machine-readable JSON")
    .action(async (options) => {
      const globalOpts = program.opts();
      const { chatCommand } = await import("../commands/chat.js");
      await chatCommand({ ...options, runId: globalOpts.runId });
    });

  program
    .command("research <query>")
    .description("Run a web research query via Kimi native SearchWeb/FetchURL")
    .option("--agent-file <path>", "Custom researcher agent YAML")
    .action(async (query, options) => {
      const { researchCommand } = await import("../commands/research.js");
      await researchCommand({ query, agentFile: options.agentFile });
    });

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
      const { designOpenDesignCommand } = await import("../commands/design.js");
      await designOpenDesignCommand(options);
    });

  program
    .command("open-design-agent")
    .description("Open Design local CLI bridge for OMK")
    .option("--artifact-dir <path>", "Directory where generated Open Design artifacts must be written")
    .option("--cwd <path>", "Workspace directory passed by Open Design")
    .option("--diagnose", "Run bounded bridge diagnostics without reading stdin or launching Kimi")
    .option("--image <path>", "Image/screenshot path passed by Open Design; repeatable", (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    }, [])
    .option("--json", "Output diagnose/bridge status as JSON")
    .option("--model <model>", "Model override from Open Design")
    .option("--run-id <id>", "Stable Open Design bridge run id for artifacts")
    .option("--smoke", "Return the Open Design smoke-test response without launching Kimi")
    .option("--stdio", "Read the Open Design prompt from stdin")
    .option("--stdin-idle-ms <ms>", "Maximum idle time while reading Open Design stdin", "3000")
    .option("--stdin-max-bytes <bytes>", "Maximum Open Design prompt size", "524288")
    .option("--stdin-timeout-ms <ms>", "Maximum total time while reading Open Design stdin", "30000")
    .option("--timeout-ms <ms>", "Maximum Kimi print-mode runtime", "1200000")
    .action(async (options: { artifactDir?: string; cwd?: string; diagnose?: boolean; image?: string[]; json?: boolean; model?: string; runId?: string; smoke?: boolean; stdio?: boolean; stdinIdleMs?: string; stdinMaxBytes?: string; stdinTimeoutMs?: string; timeoutMs?: string }) => {
      const { openDesignAgentCommand } = await import("../commands/open-design-agent.js");
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
    .option("--no-clear", "Do not clear screen between refreshes")
    .option("--pause", "Start paused")
    .action(async (options) => {
      const globalOpts = program.opts();
      const { cockpitCommand } = await import("../commands/cockpit.js");
      await cockpitCommand({
        ...options,
        runId: globalOpts.runId ?? options.runId,
        refreshMs: options.refresh ? Number.parseInt(options.refresh, 10) : undefined,
        height: options.height ? Number.parseInt(options.height, 10) : undefined,
        redraw: options.redraw,
        section: options.section,
        events: options.events,
      });
    });

  program
    .command("rail")
    .description("Thin alias for cockpit --view rail")
    .option("--run-id <id>", t("cmd.cockpitRunIdOption"))
    .option("-w, --watch", t("cmd.cockpitWatchOption"))
    .option("--refresh <ms>", t("cmd.cockpitRefreshOption"), "1500")
    .option("--redraw <diff|full|append>", "Redraw mode", "diff")
    .option("--height <rows>", "Cockpit height in rows (watch default: auto-fit pane; one-shot default: auto)")
    .option("--section <agents|todos|mcp|all>", "Cockpit section to render", "all")
    .option("--events <on|off>", "Use events.jsonl telemetry when available", "on")
    .option("--no-clear", "Do not clear screen between refreshes")
    .option("--pause", "Start paused")
    .action(async (options) => {
      const globalOpts = program.opts();
      const { railCommand } = await import("../commands/rail.js");
      await railCommand({
        ...options,
        runId: globalOpts.runId ?? options.runId,
        refreshMs: options.refresh ? Number.parseInt(options.refresh, 10) : undefined,
        height: options.height ? Number.parseInt(options.height, 10) : undefined,
        redraw: options.redraw,
        section: options.section,
        events: options.events,
      });
    });

  registerConsentCommand(program);

  program
    .command("do <prompt>")
    .description("Route a natural-language prompt through OMK's provider-neutral control loop")
    .option("--mode <mode>", "UX mode: safe | fast | full | plan")
    .option("--mcp-scope <all|project|none>", "MCP scope for this prompt (all | project | none)")
    .option("--provider <provider>", "provider policy (auto | authority | kimi | deepseek | codex | qwen | openrouter)", "auto")
    .option("--model <model>", "provider model or provider/model override")
    .option("--workers <n>", "worker count (auto = resource profile based)", "auto")
    .option("--dry-run", "Compile and persist the DAG without executing it")
    .option("--json", "Output JSON")
    .action(async (prompt, options) => {
      const globalOpts = program.opts();
      const { doCommand } = await import("../commands/do.js");
      const result = await doCommand(prompt, { ...options, runId: globalOpts.runId });
      if (!result.success && process.exitCode === undefined) {
        process.exitCode = 1;
      }
    });

  program
    .command("why")
    .description("Explain the latest or selected OMK control-loop decision")
    .option("--run-id <id>", "Run ID to inspect")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const globalOpts = program.opts();
      const { whyCommand } = await import("../commands/why.js");
      await whyCommand({ ...options, runId: options.runId ?? globalOpts.runId });
    });

  program
    .command("replay <run-id>")
    .description("Replay a previous run by restoring its manifest, context capsules, and decision traces")
    .option("--json", "Output raw ReplayManifest as JSON")
    .option("--context", "Show restored context capsules")
    .option("--evidence", "Show evidence gate results")
    .option("--decisions", "Show all decision traces")
    .option("--repair", "Show repair policy decisions")
    .action(async (runId, options) => {
      const { replayCommand } = await import("../commands/replay.js");
      await replayCommand(runId, {
        json: Boolean(options.json),
        context: Boolean(options.context),
        evidence: Boolean(options.evidence),
        decisions: Boolean(options.decisions),
        repair: Boolean(options.repair),
      });
    });

  program
    .command("inspect <run-id>")
    .description("Inspect a run, node, or attempt with full decision trace and forensic details")
    .option("--node <node-id>", "Inspect a specific node")
    .option("--attempt <attempt-id>", "Inspect a specific attempt")
    .option("--context", "Deep-dive into context capsules")
    .option("--evidence", "Show evidence gate results")
    .option("--decisions", "Show all decision traces")
    .option("--repair", "Show repair policy decisions")
    .option("--json", "Output as JSON")
    .action(async (runId, options) => {
      const { inspectCommand } = await import("../commands/inspect.js");
      await inspectCommand(runId, {
        node: options.node,
        attempt: options.attempt,
        json: Boolean(options.json),
        context: Boolean(options.context),
        evidence: Boolean(options.evidence),
        decisions: Boolean(options.decisions),
        repair: Boolean(options.repair),
      });
    });

  program
    .command("diff-runs <run-a> <run-b>")
    .description("Compare two runs structurally (DAG, policy, decisions, tokens, context, evidence)")
    .option("--json", "Output diff report as JSON")
    .action(async (runA, runB, options) => {
      const { diffRunsCommand } = await import("../commands/diff-runs.js");
      await diffRunsCommand(runA, runB, { json: Boolean(options.json) });
    });
}
