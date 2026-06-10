/**
 * Section 21 — CLI v2 Full Migration
 *
 * Clipanion-based CLI with RuntimeSidecar pipeline integration.
 * All commands route through CommandBus → IntentClassifier → CapabilitySelector
 * → RuntimeSidecar → OutputRouter pipeline.
 *
 * Enabled via OMK_CLI_V2=1 environment variable.
 */

import { Cli, Command, Option } from "clipanion";
import { createCommandBus } from "../../runtime/command-bus.js";
import { classifyIntent, selectCapabilities, compileBloatToNlp, filterMcpConfigForTurn, selectProviderRuntime } from "../../runtime/debloat-nlp.js";
import { createOutputRouter } from "../../runtime/output-router.js";
import { createPersistentMemoryStore } from "./persistent-memory.js";
import { registerSlashCommands } from "../../runtime/slash-commands.js";
import { registerProviderCommandsV2 } from "./provider-commands.js";
import { registerWorkflowCommandsV2 } from "./workflow-commands.js";
import { DEFAULT_AUTHORITY_PROVIDER } from "../../providers/types.js";
import type { RequestIntent } from "../../runtime/debloat-nlp.js";
import type { OutputProfile } from "../../runtime/contracts/command-envelope.js";
/**
 * Base class for all OMK v2 commands.
 * Provides common pipeline execution helpers.
 */
export abstract class OmkCommand extends Command {
  static override usage = Command.Usage({
    description: "OMK CLI v2 command base",
  });

  cwd = Option.String("--cwd", process.cwd(), { description: "Working directory" });
  json = Option.Boolean("--json", false, { description: "JSON output" });
  theme = Option.String("--theme", "");
  provider = Option.String("--provider", "", { description: "Provider override" });
  model = Option.String("--model", "", { description: "Model override" });

  /**
   * Execute through the full RuntimeSidecar pipeline:
   * CommandBus → IntentClassifier → CapabilitySelector → RuntimeSidecar → OutputRouter
   */
  protected async executePipeline(userRequest: string, intent: string): Promise<number> {
    const bus = createCommandBus();
    registerSlashCommands(bus, {
      provider: this.provider || undefined,
      model: this.model || undefined,
      theme: this.theme || undefined,
    });
    const busResult = await bus.dispatch({ kind: "chat", source: "cli", rawText: userRequest });

    // Intent classification (map non-standard intents to valid RequestIntent)
    const classifiedIntent = classifyIntent(userRequest);
    const effectiveIntent: RequestIntent =
      (intent === "run" || intent === "model" || intent === "doctor" || intent === "theme" || intent === "memory")
        ? "chat"
        : (intent as RequestIntent) || classifiedIntent;

    // Capability selection
    const capabilityPlan = selectCapabilities({
      intent: effectiveIntent,
      availableMcp: [],
      availableSkills: [],
      failedMcp: [],
    });

    // Build RuntimeSidecar via debloated NLP compiler
    const result = compileBloatToNlp({
      rawText: userRequest,
      provider: this.provider || undefined,
      model: this.model || undefined,
    });
    const sidecar = result.runtimeSidecar;

    // Select provider runtime mode
    const runtimeMode = selectProviderRuntime({
      provider: sidecar.provider || DEFAULT_AUTHORITY_PROVIDER,
      intent: effectiveIntent,
    });

    // Filter MCP config for this turn
    const mcpConfig = filterMcpConfigForTurn({
      userMcpConfig: {},
      projectMcpConfig: {},
      sidecar,
    });
    const selectedMcpCount = capabilityPlan.requiredMcp.length + capabilityPlan.optionalMcp.length;
    const selectedSkillCount = capabilityPlan.selectedSkills.length;
    const filteredMcpCount = Object.keys(mcpConfig.mcpServers).length;

    // Route output through ThemeRenderer/NlpRenderer/JsonRenderer
    const outputMode = this.json ? "json" as const : "theme" as const;
    const profile: OutputProfile = {
      format: this.json ? "json" : "nlp",
      progress: "live",
      color: "auto",
      rawProvider: false,
      explainRouting: false,
      stdoutMode: outputMode,
    };
    const router = createOutputRouter(profile);

    // Emit pipeline result as OmkEvent
    router.route({
      type: "result",
      data: {
        kind: "result",
        content: `Pipeline: ${effectiveIntent} → ${runtimeMode} (${sidecar.provider}/${sidecar.model}); capabilities=${selectedMcpCount} MCP/${selectedSkillCount} skills; mcp=${filteredMcpCount}`,
        format: "nlp",
      },
      turnId: Date.now().toString(),
      timestamp: new Date().toISOString(),
    });
    router.flush();

    // Also emit bus result events
    for (const ev of busResult.events) {
      router.route(ev);
    }
    router.flush();

    return 0;
  }
}

/**
 * `omk chat` — Interactive chat with provider
 */
export class ChatCommand extends OmkCommand {
  static override paths = [["chat"]];
  static override usage = Command.Usage({
    description: "Start interactive chat with provider",
    examples: [
      ["Start chat", "omk chat"],
      ["With message", "omk chat -m 'hello'"],
    ],
  });

  message = Option.String("-m,--message", "");

  async execute(): Promise<number> {
    if (this.message) {
      return this.executePipeline(this.message, "chat");
    }

    // Interactive REPL mode
    const { startChatRepl } = await import("./chat-repl.js");
    await startChatRepl({
      provider: this.provider,
      model: this.model,
      cwd: this.cwd,
      json: this.json,
    });
    return 0;
  }
}

/**
 * `omk run` — Execute a goal/task through the pipeline
 */
export class RunCommand extends OmkCommand {
  static override paths = [["run"]];
  static override usage = Command.Usage({
    description: "Execute a goal or task file",
    examples: [["Run a goal", "omk run goal.md"]],
  });

  goalArgs = Option.Rest();
  workers = Option.String("--workers", "");
  timeout = Option.String("--timeout", "");

  async execute(): Promise<number> {
    const userRequest = this.goalArgs.length > 0 ? this.goalArgs.join(" ") : "execute pending tasks";
    // Run pipeline classification (no stdout output)
    const classifiedIntent = classifyIntent(userRequest);
    const result = compileBloatToNlp({ rawText: userRequest });
    const sidecar = result.runtimeSidecar;
    const runtimeMode = selectProviderRuntime({ provider: sidecar.provider || DEFAULT_AUTHORITY_PROVIDER, intent: classifiedIntent });
    // Output structured JSON envelope to stdout only
    this.context.stdout.write(JSON.stringify({ command: "run", result: { placeholder: true, runtimeMode } }) + "\n");
    return 0;
  }
}

/**
 * `omk status` — Show current runtime status through pipeline
 */
export class StatusCommand extends OmkCommand {
  static override paths = [["status"]];
  static override usage = Command.Usage({
    description: "Show current OMK runtime status",
  });

  async execute(): Promise<number> {
    return this.executePipeline("show current status", "status");
  }
}

/**
 * `omk model` — Show or set provider/model
 */
export class ModelCommand extends OmkCommand {
  static override paths = [["model"]];
  static override usage = Command.Usage({
    description: "Show or set current provider/model",
    examples: [
      ["Show current model", "omk model"],
      ["Set model", "omk model auto"],
    ],
  });

  targetArgs = Option.Rest();

  async execute(): Promise<number> {
    const target = this.targetArgs.join(" ");
    if (target) {
      process.env.OMK_PROVIDER = target.split("/")[0] ?? "";
      process.env.OMK_MODEL = target.split("/")[1] ?? "";
      this.context.stdout.write(`Provider/model set to: ${target}\n`);
      return 0;
    }
    return this.executePipeline("show current model", "model");
  }
}

/**
 * `omk doctor` — Health check through pipeline
 */
export class DoctorCommand extends OmkCommand {
  static override paths = [["doctor"]];
  static override usage = Command.Usage({
    description: "Run OMK health checks",
  });

  noColor = Option.Boolean("--no-color", false, { description: "Disable color output (NO_COLOR equivalent)" });

  /** Color-tier / theme / NO_COLOR diagnostic section (theme contract T5a). */
  private async writeColorThemeSection(): Promise<void> {
    const { explainColorTier } = await import("../theme/tier-explain.js");
    const { resolveTheme } = await import("../theme/theme-resolver.js");
    const { loadThemeDocument, validateThemeDocument } = await import("../theme/theme-doc.js");

    const argv: readonly string[] = this.noColor ? ["--no-color"] : [];
    const explanation = explainColorTier(argv);
    const active = resolveTheme({ cwd: this.cwd, flagTheme: this.theme || undefined });
    const doc = loadThemeDocument(active.name, this.cwd);
    const schemaStatus = doc === undefined
      ? "builtin palette (no omk.theme.v1 document)"
      : ((): string => {
          const errors = validateThemeDocument(doc);
          return errors.length === 0 ? "omk.theme.v1 document: valid" : `omk.theme.v1 document: INVALID (${errors.length} error(s): ${errors[0]})`;
        })();

    if (this.json) {
      this.context.stdout.write(JSON.stringify({
        section: "color-theme",
        tier: explanation.tier,
        reasons: explanation.reasons,
        noColorRequested: explanation.noColorRequested,
        noColorHonored: explanation.noColorHonored,
        activeTheme: active.name,
        themeMode: active.mode,
        schema: schemaStatus,
      }) + "\n");
      return;
    }
    this.context.stdout.write([
      "Color tier & theme",
      `  detected tier : ${explanation.tier}`,
      `  why           : ${explanation.reasons.join("; ")}`,
      `  NO_COLOR      : requested=${explanation.noColorRequested ? "yes" : "no"} honored=${explanation.noColorHonored ? "yes" : "no"}`,
      `  active theme  : ${active.name} (mode ${active.mode})`,
      `  theme schema  : ${schemaStatus}`,
      "",
    ].join("\n"));
  }

  async execute(): Promise<number> {
    await this.writeColorThemeSection();
    return this.executePipeline("run health checks", "doctor");
  }
}

/**
 * `omk memory` — Project memory management
 */
export class MemoryCommand extends OmkCommand {
  static override paths = [["memory"]];
  static override usage = Command.Usage({
    description: "Manage project memory",
    examples: [
      ["Show memory", "omk memory show"],
      ["Search memory", "omk memory search 'last decision'"],
    ],
  });

  args = Option.Rest();

  async execute(): Promise<number> {
    const store = createPersistentMemoryStore({ cwd: this.cwd });
    const subcommand = this.args[0] ?? "";
    const query = this.args.slice(1).join(" ");

    switch (subcommand) {
      case "show": {
        const capsule = await store.load();
        this.context.stdout.write(JSON.stringify(capsule, null, 2) + "\n");
        return 0;
      }
      case "search": {
        if (!query) {
          this.context.stderr.write("Usage: omk memory search <query>\n");
          return 2;
        }
        const results = await store.search(query);
        this.context.stdout.write(JSON.stringify(results, null, 2) + "\n");
        return 0;
      }
      case "clear": {
        await store.clear();
        this.context.stdout.write("Memory cleared.\n");
        return 0;
      }
      default: {
        const capsule = await store.load();
        this.context.stdout.write(JSON.stringify(capsule, null, 2) + "\n");
        return 0;
      }
    }
  }
}

/**
 * `omk theme` — Show or set theme
 */
export class ThemeCommand extends OmkCommand {
  static override paths = [["theme"]];
  static override usage = Command.Usage({
    description: "Show or set CLI theme",
    examples: [
      ["Show current theme", "omk theme"],
      ["Set theme", "omk theme dark"],
      ["Preview theme", "omk theme preview matrix"],
      ["List all themes", "omk theme list"],
    ],
  });

  nameArgs = Option.Rest({ required: 0 });
  noColor = Option.Boolean("--no-color", false, { description: "Disable color output (NO_COLOR equivalent)" });

  /** Detect the degradation tier, honoring the command's --no-color flag. */
  private async detectTier(): Promise<"truecolor" | "256" | "16" | "no-color"> {
    const { detectColorTier } = await import("../theme/terminal-capability.js");
    return detectColorTier(this.noColor ? ["--no-color"] : []);
  }

  async execute(): Promise<number> {
    const name = this.nameArgs.join(" ").trim();
    const subcommand = this.nameArgs[0] ?? "";
    const target = this.nameArgs.slice(1).join(" ").trim();

    // omk theme list — active theme + omk.theme.v1 documents + builtin swatches
    if (subcommand === "list") {
      const { renderAllThemePreviews, getBuiltinTheme } = await import(
        "../theme/theme-registry.js"
      );
      const { resolveTheme } = await import("../theme/theme-resolver.js");
      const { listThemeDocuments, loadThemeDocument, validateThemeDocument } = await import(
        "../theme/theme-doc.js"
      );
      const active = resolveTheme({ cwd: this.cwd, flagTheme: this.theme || undefined });
      const tier = await this.detectTier();
      const currentPalette = getBuiltinTheme(active.name) ?? getBuiltinTheme("omk");
      this.context.stdout.write(
        (currentPalette?.render("header", `Active theme: ${active.name}`) ?? `Active theme: ${active.name}`)
        + ` (mode ${active.mode}, tier ${tier})\n\n`,
      );
      const docs = listThemeDocuments(this.cwd);
      if (docs.length > 0) {
        this.context.stdout.write("Theme documents (omk.theme.v1):\n");
        for (const ref of docs) {
          const doc = loadThemeDocument(ref.name, this.cwd);
          const valid = doc !== undefined && validateThemeDocument(doc).length === 0;
          const marker = ref.name === active.name ? "●" : "○";
          this.context.stdout.write(`  ${marker} ${ref.name} — ${ref.path} (${valid ? "valid" : "INVALID"})\n`);
        }
        this.context.stdout.write("\n");
      }
      this.context.stdout.write("Built-in palettes:\n");
      this.context.stdout.write(renderAllThemePreviews() + "\n");
      return 0;
    }

    // omk theme set <name> — validate + persist choice to project config
    if (subcommand === "set") {
      if (!target) {
        this.context.stderr.write("Usage: omk theme set <name>\n");
        return 2;
      }
      const { getBuiltinTheme, listBuiltinThemes } = await import("../theme/theme-registry.js");
      const { listThemeDocuments } = await import("../theme/theme-doc.js");
      const docNames = listThemeDocuments(this.cwd).map((r) => r.name);
      const known = getBuiltinTheme(target) !== undefined || docNames.includes(target);
      if (!known) {
        this.context.stderr.write(`Unknown theme: ${target}\n`);
        this.context.stderr.write(`Available: ${[...new Set([...docNames, ...listBuiltinThemes()])].join(", ")}\n`);
        return 2;
      }
      const { readFile, writeFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const cfgPath = resolve(this.cwd, ".omkrc.json");
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
      } catch {
        existing = {};
      }
      const next = { ...existing, theme: target };
      await writeFile(cfgPath, JSON.stringify(next, null, 2) + "\n");
      process.env.OMK_THEME = target;
      this.context.stdout.write(`Theme set to: ${target} (persisted to ${cfgPath})\n`);
      return 0;
    }

    // omk theme preview <name> — representative status frame at detected tier
    // (same frame as test/theme-degradation.test.mjs) for omk.theme.v1 docs;
    // falls back to the builtin palette swatch for registry-only themes.
    if (subcommand === "preview") {
      if (!target) {
        this.context.stderr.write("Usage: omk theme preview <name>\n");
        return 2;
      }
      const { loadThemeDocument, listThemeDocuments } = await import("../theme/theme-doc.js");
      const doc = loadThemeDocument(target, this.cwd);
      if (doc !== undefined) {
        const { compileTheme } = await import("../theme/render-table.js");
        const { renderStatusFrame } = await import("../theme/status-frame.js");
        const tier = await this.detectTier();
        const compiled = compileTheme(doc, tier);
        this.context.stdout.write(`${doc.displayName ?? doc.name} — tier ${tier}\n\n`);
        this.context.stdout.write(renderStatusFrame(compiled) + "\n");
        const current = process.env.OMK_THEME ?? "omk";
        this.context.stdout.write(
          `\nCurrent theme: ${current}. Use \`omk theme set ${target}\` to switch.\n`,
        );
        return 0;
      }
      const { renderThemePreview, getBuiltinTheme, listBuiltinThemes } = await import(
        "../theme/theme-registry.js"
      );
      const palette = getBuiltinTheme(target);
      if (!palette) {
        const docNames = listThemeDocuments(this.cwd).map((r) => r.name);
        const available = [...new Set([...docNames, ...listBuiltinThemes()])].join(", ");
        this.context.stderr.write(`Unknown theme: ${target}\n`);
        this.context.stderr.write(`Available: ${available}\n`);
        return 2;
      }
      this.context.stdout.write(renderThemePreview(palette) + "\n");
      const current = process.env.OMK_THEME ?? "omk";
      this.context.stdout.write(
        `\nCurrent theme: ${current}. Use \`omk theme set ${target}\` to switch.\n`,
      );
      return 0;
    }

    // omk theme <name> — set theme
    if (name) {
      process.env.OMK_THEME = name;
      const { getBuiltinTheme, renderThemePreview } = await import(
        "../theme/theme-registry.js"
      );
      const palette = getBuiltinTheme(name);
      if (palette) {
        this.context.stdout.write(renderThemePreview(palette) + "\n");
      }
      this.context.stdout.write(`\nTheme set to: ${name}\n`);
      return 0;
    }

    // omk theme — show current + all with swatches
    const { renderAllThemePreviews, getBuiltinTheme } = await import(
      "../theme/theme-registry.js"
    );
    const current = process.env.OMK_THEME ?? "omk";
    const currentPalette = getBuiltinTheme(current) ?? getBuiltinTheme("omk");
    this.context.stdout.write(
      (currentPalette?.render("header", `Current theme: ${current}`) ?? `Current theme: ${current}`) + "\n\n",
    );
    this.context.stdout.write(renderAllThemePreviews() + "\n");
    return 0;
  }
}

/**
 * Register all v2 commands on a Clipanion CLI instance.
 */
export function createCliV2() {
  const cli = new Cli({
    binaryLabel: "OMK CLI",
    binaryName: "omk",
    binaryVersion: "1.1.18",
  });

  cli.register(ChatCommand);
  cli.register(RunCommand);
  cli.register(StatusCommand);
  cli.register(ModelCommand);
  cli.register(DoctorCommand);
  cli.register(MemoryCommand);
  cli.register(ThemeCommand);

  // Section 21: Register migrated provider/model commands
  registerProviderCommandsV2(cli);

  // Section 21: Register migrated workflow commands
  registerWorkflowCommandsV2(cli);

  return cli;
}

/**
 * Run CLI v2 from argv.
 * Entry point called from main.ts when OMK_CLI_V2=1.
 */
export async function runCliV2(argv: readonly string[]): Promise<void> {
  const cli = createCliV2();
  const exitCode = await cli.run(argv.slice(2));
  process.exitCode = exitCode;
}
