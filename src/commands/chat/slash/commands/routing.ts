import { buildAuthCenterReport } from "../../../auth.js";
import {
  KNOWN_PROVIDER_IDS,
  listUserModelAliases,
  normalizeProviderId,
  parseProviderModelArg,
  readProviderRegistry,
  resolveUserModelAlias,
} from "../../../../providers/model-registry.js";
import { groupProviderModelsByProvider, renderProviderModelTable } from "../../../../providers/model-table.js";
import { formatThinkingModelVariant, nextThinkingLevel, normalizeThinkingLevel, normalizeThinkingVariant, thinkingLevelsFor } from "../../../../providers/thinking-levels.js";
import { resolveRuntimeBootstrap } from "../../../../runtime/runtime-bootstrap.js";
import { style } from "../../../../util/theme.js";
import { errorSlashResult, okSlashResult } from "../result.js";
import type { SlashCommandContext, SlashCommandResult, SlashCommandSpec } from "../types.js";

export function buildRoutingSlashCommands(): SlashCommandSpec[] {
  return [
    {
      name: "/auth",
      aliases: ["/login"],
      group: "routing",
      summary: "Show provider auth status",
      usage: "/auth [provider] [--setup] [--doctor]",
      examples: ["/auth", "/auth codex --doctor"],
      handler: async (ctx, args) => {
        const target = args.positional.find((token) => !token.startsWith("-"));
        const report = await buildAuthCenterReport(target, { env: ctx.env });
        if (args.flags.json) return okSlashResult({ json: report });
        return okSlashResult({
          text: renderAuthReport(
            report,
            Boolean(args.flags.setup || args.flags.doctor),
          ),
        });
      },
    },
    {
      name: "/providers",
      aliases: [":providers"],
      group: "routing",
      summary: "List providers",
      usage: "/providers",
      examples: ["/providers"],
      handler: async (ctx) => {
        const providers = await readProviderRegistry({ env: ctx.env });
        return okSlashResult({ text: renderProviderModelTable(providers, { currentProvider: ctx.state.provider, currentModel: ctx.state.model, currentThinking: ctx.state.thinking, compactAliases: true, activeProviderTab: ctx.state.activeProviderTab }) });
      },
    },
    {
      name: "/provider",
      aliases: ["/p"],
      group: "routing",
      summary: "Switch provider for this session",
      usage: "/provider <name>",
      examples: ["/provider codex"],
      handler: async (ctx, args) => {
        const provider = String(args.positional[0] ?? "")
          .trim()
          .toLowerCase();
        const valid = ["auto", ...KNOWN_PROVIDER_IDS];
        const normalized = normalizeProviderId(provider);
        if (!provider || !valid.includes(normalized)) {
          return okSlashResult({
            text: `${style.phosphorDim(`\n  Available: ${valid.join(", ")}`)}\n${style.phosphorDim("  Usage: /provider codex\n")}`,
          });
        }
        return applyProviderOverride(ctx, normalized);
      },
    },
    {
      name: "/models",
      aliases: [":models"],
      group: "routing",
      summary: "List model aliases",
      usage: "/models",
      examples: ["/models"],
      handler: async (ctx) => {
        const aliases = await listUserModelAliases({ env: ctx.env });
        const lines = [style.phosphorBold("\n  User Model Aliases:")];
        const entries = Object.entries(aliases);
        if (entries.length === 0) lines.push(style.phosphorDim("    (none)"));
        for (const [alias, target] of entries)
          lines.push(style.phosphorDim(`    ${alias} -> ${target}`));
        lines.push(
          style.phosphorDim(
            "  Use `omk model alias add fast deepseek/flash` to persist aliases.\n",
          ),
        );
        return okSlashResult({ text: lines.join("\n") });
      },
    },
    {
      name: "/model",
      aliases: ["/m"],
      group: "routing",
      summary: "Show or set model [+thinking variant] for this session",
      usage: "/model [provider/model|model[:level]]",
      examples: ["/model", "/model codex/codex-cli", "/model deepseek/pro:max", "/model kimi/k2.6:high", "/model deepseek-v4-pro:max", "/think variant code-high"],
      handler: async (ctx, args) => {
        const raw = args.positional.join(" ").trim();
        if (!raw) {
          const providers = await readProviderRegistry({ env: ctx.env });
          const providerGroups = groupProviderModelsByProvider(providers);
          if (args.flags.json) {
            return okSlashResult({
              json: {
                schema: "omk.slash.model-groups.v1",
                currentProvider: ctx.state.provider,
                currentModel: ctx.state.model,
                currentThinking: ctx.state.thinking,
                providerGroups,
              },
            });
          }
          return okSlashResult({
            text: renderProviderModelTable(providers, {
              currentProvider: ctx.state.provider,
              currentModel: ctx.state.model,
              currentThinking: ctx.state.thinking,
              activeProviderTab: ctx.state.activeProviderTab,
            }),
          });
        }
        // Parse model + optional :thinkingLevel
        const parsed = parseProviderModelArg(raw);
        const ref = modelRefFromParsed(parsed, raw);
        const thinking = parsed.thinkingLevel
          ? await validateThinkingOverride(ctx, ref, parsed.thinkingLevel)
          : undefined;
        if (thinking && !thinking.ok) return thinking.result;
        const result = await applyModelOverride(ctx, ref);
        return thinking?.ok
          ? applyThinkingOverride(ctx, result, thinking.level, thinking.levels)
          : result;
      },
    },
    {
      name: "/think",
      aliases: ["/thinking", ":think"],
      group: "routing",
      summary: "Show, cycle, or set model thinking variant",
      usage: "/think [next|medium|high|xhigh|max|variant <name>]",
      examples: ["/think", "/think next", "/think high", "/think variant code-high", "/think varint review-xhigh"],
      handler: async (ctx, args) => {
        const requested = args.positional[0]?.trim().toLowerCase();
        const levels = thinkingLevelsFor(ctx.state.provider, ctx.state.model);
        const wantsCustomVariant = requested === "variant" || requested === "varint" || requested === "v";
        const customVariant = wantsCustomVariant ? normalizeThinkingVariant(args.positional[1]) : undefined;
        if (wantsCustomVariant) {
          if (!customVariant) {
            return okSlashResult({
              text: style.phosphorDim(`\n  Usage: /think variant <name>\n  Example: /think variant code-high\n  Alias: /think varint <name>\n  Allowed: letters, numbers, dot, underscore, colon, hyphen.\n`),
            });
          }
          ctx.env.OMK_THINKING = customVariant;
          ctx.env.OMK_MODEL_VARIANT = formatThinkingModelVariant(ctx.state.model, customVariant);
          return okSlashResult({
            statePatch: { thinking: customVariant, updatedAt: new Date().toISOString() },
            text: [
              style.phosphor(`\n  Thinking variant: ${customVariant}`),
              style.phosphorDim("  Mode: custom variant"),
              style.phosphorDim(`  Active: ${ctx.env.OMK_MODEL_VARIANT}`),
              style.phosphorDim(`  Level cycle still available: ${levels.join(" → ")}\n`),
            ].join("\n"),
          });
        }
        if (!requested) {
          return okSlashResult({
            statePatch: { thinkingPickerOpen: true, updatedAt: new Date().toISOString() },
            text: renderThinkingLevelList(ctx, levels),
          });
        }
        const level = requested === "next" || requested === "tab"
          ? nextThinkingLevel(ctx.state.thinking ?? ctx.env.OMK_THINKING, ctx.state.provider, ctx.state.model)
          : normalizeThinkingLevel(requested);
        if (!level || !levels.includes(level)) {
          return okSlashResult({
            text: style.phosphorDim(`\n  Supported thinking levels for ${ctx.state.provider}/${ctx.state.model ?? "auto"}: ${levels.join(" → ")}\n  Usage: /think next | ${levels.join(" | ")} | variant <name>\n  Shortcut: /model ${ctx.state.provider ?? "kimi"}/${ctx.state.model ?? "auto"}:${levels[0]}\n`),
          });
        }
        ctx.env.OMK_THINKING = level;
        ctx.env.OMK_MODEL_VARIANT = formatThinkingModelVariant(ctx.state.model, level);
        return okSlashResult({
          statePatch: { thinking: level, updatedAt: new Date().toISOString() },
          text: [
            style.phosphor(`\n  Thinking variant: ${level}`),
            style.phosphorDim(`  Cycle: ${levels.join(" → ")}`),
            style.phosphorDim(`  Active: ${ctx.env.OMK_MODEL_VARIANT}`),
            style.phosphorDim(`  Shortcut: /model ${ctx.state.provider ?? "kimi"}/${ctx.state.model ?? "auto"}:${level}`),
            style.phosphorDim("  Custom variant: /think variant code-high  (alias: /think varint code-high)\n"),
          ].join("\n"),
        });
      },
    },
    {
      name: "/use",
      aliases: [":use"],
      group: "routing",
      summary: "Switch provider/model [+thinking] by alias",
      usage: "/use <ref>[:level]",
      examples: ["/use codex/codex-cli", "/use fast", "/use deepseek/pro:max"],
      handler: async (ctx, args) => {
        const raw = args.positional.join(" ").trim();
        if (!raw)
          return okSlashResult({
            text: style.phosphorDim(
              "\n  Usage: /use codex/codex-cli or /use fast or /use deepseek/pro:max\n",
            ),
          });
        const parsed = parseProviderModelArg(raw);
        const ref = modelRefFromParsed(parsed, raw);
        const thinking = parsed.thinkingLevel
          ? await validateThinkingOverride(ctx, ref, parsed.thinkingLevel)
          : undefined;
        if (thinking && !thinking.ok) return thinking.result;
        const result = await applyModelOverride(ctx, ref);
        return thinking?.ok
          ? applyThinkingOverride(ctx, result, thinking.level, thinking.levels)
          : result;
      },
    },
  ];
}

function renderThinkingLevelList(
  ctx: SlashCommandContext,
  levels: readonly string[],
): string {
  const current = ctx.state.thinking ?? ctx.env.OMK_THINKING;
  const levelLine = levels
    .map((level) => {
      const label = `${level === current ? "●" : "○"} ${level}`;
      if (level === current) return style.mintBold(label);
      if (level === "max" || level === "xhigh") return style.cyanBold(label);
      return style.gray(label);
    })
    .join(style.gray("  "));
  const active = current
    ? `${current} (${formatThinkingModelVariant(ctx.state.model, current)})`
    : "not selected";
  return [
    style.phosphorBold("\n  OMK Thinking Control · choose level"),
    style.phosphorDim(`  Target: ${ctx.state.provider ?? "auto"}/${ctx.state.model ?? "auto"}`),
    `  ${levelLine}`,
    style.phosphorDim(`  Choose directly: /think ${levels.join(" | /think ")}`),
    style.phosphorDim("  Cycle only when explicit: /think next"),
    style.phosphorDim(`  Active: ${active}\n`),
  ].join("\n");
}

function modelRefFromParsed(parsed: ReturnType<typeof parseProviderModelArg>, raw: string): string {
  return `${parsed.provider ? `${parsed.provider}/` : ""}${parsed.model ?? raw}`;
}

type ThinkingValidation =
  | { ok: true; level: NonNullable<ReturnType<typeof normalizeThinkingLevel>>; levels: readonly string[] }
  | { ok: false; result: SlashCommandResult };

async function validateThinkingOverride(
  ctx: SlashCommandContext,
  ref: string,
  requestedThinking: string,
): Promise<ThinkingValidation> {
  const level = normalizeThinkingLevel(requestedThinking);
  const resolved = await resolveUserModelAlias(ref, { env: ctx.env });
  const nextProvider = resolved.provider ?? ctx.state.provider;
  const nextModel = resolved.model ?? ctx.state.model;
  const levels = thinkingLevelsFor(nextProvider, nextModel);
  if (!level || !levels.includes(level)) {
    return {
      ok: false,
      result: errorSlashResult([
        style.metricsRed(`\n  Unsupported thinking level: ${requestedThinking}`),
        style.phosphorDim(`  Target: ${nextProvider ?? "auto"}/${nextModel ?? "auto"}`),
        style.phosphorDim(`  Supported: ${levels.join(" → ")}`),
        style.phosphorDim(`  Usage: /model ${ref}:${levels.join("|")}\n`),
      ].join("\n")),
    };
  }
  return { ok: true, level, levels };
}

function applyThinkingOverride(
  ctx: SlashCommandContext,
  result: SlashCommandResult,
  level: NonNullable<ReturnType<typeof normalizeThinkingLevel>>,
  levels: readonly string[],
): SlashCommandResult {
  const nextModel = result.statePatch?.model ?? ctx.state.model;
  if (!nextModel) return result;
  ctx.env.OMK_THINKING = level;
  ctx.env.OMK_MODEL_VARIANT = formatThinkingModelVariant(nextModel, level);
  const statePatch = result.statePatch ?? {};
  result.statePatch = {
    ...statePatch,
    thinking: level,
    updatedAt: new Date().toISOString(),
  };
  result.text = [
    result.text?.trimEnd(),
    style.phosphorDim(`  Thinking: ${level}  (cycle: ${levels.join(" → ")})`),
  ].filter(Boolean).join("\n");
  return result;
}

async function applyProviderOverride(
  ctx: SlashCommandContext,
  provider: string,
  model?: string,
) {
  const bootstrap = await resolveRuntimeBootstrap({
    provider,
    model: model ?? ctx.state.model,
    cwd: ctx.input.root,
    env: ctx.env,
  });
  if (!bootstrap.ok) {
    const lines = [style.metricsRed(`\n  Provider not ready: ${provider}`)];
    if (bootstrap.reason)
      lines.push(style.phosphorDim(`  ${bootstrap.reason}`));
    for (const hint of bootstrap.setupHints.slice(0, 3))
      lines.push(style.phosphorDim(`  - ${hint}`));
    lines.push(
      style.phosphorDim(`  Restart/setup: omk auth ${provider} --setup\n`),
    );
    return okSlashResult({ text: lines.join("\n") });
  }
  const statePatch = {
    bootstrap,
    provider: bootstrap.provider,
    model: bootstrap.selectedModel,
    updatedAt: new Date().toISOString(),
  };
  if (bootstrap.selectedModel)
    ctx.env.OMK_PROVIDER_MODEL = bootstrap.selectedModel;
  else delete ctx.env.OMK_PROVIDER_MODEL;
  return okSlashResult({
    statePatch,
    text: [
      style.phosphor(
        `\n  Provider switched for this session: ${bootstrap.provider}`,
      ),
      style.phosphorDim(
        `  Runtime: ${bootstrap.selectedRuntimeId ?? "auto"} | Model: ${bootstrap.selectedModel ?? "auto"}`,
      ),
      style.phosphorDim(
        "  Persistent default unchanged; use `omk provider use` to persist.\n",
      ),
    ].join("\n"),
  });
}

async function applyModelOverride(ctx: SlashCommandContext, ref: string) {
  const resolved = await resolveUserModelAlias(ref, { env: ctx.env });
  const updatedAt = new Date().toISOString();
  const lines = [
    style.phosphor(
      `\n  Model override for this session: ${ref} → ${resolved.model}`,
    ),
  ];
  if (resolved.provider)
    lines.push(style.phosphorDim(`  Provider: ${resolved.provider}`));
  lines.push(
    style.phosphorDim(
      "  Persistent default unchanged; use `omk model use` to persist.\n",
    ),
  );

  if (resolved.provider && resolved.provider !== ctx.state.provider) {
    const providerResult = await applyProviderOverride(
      ctx,
      resolved.provider,
      resolved.model,
    );
    if (providerResult.statePatch?.provider !== resolved.provider)
      return providerResult;
    const providerPatch = providerResult.statePatch ?? {};
    const bootstrap = {
      ...(providerPatch.bootstrap ?? ctx.state.bootstrap),
      selectedModel: resolved.model,
    };
    ctx.env.OMK_PROVIDER_MODEL = resolved.model;
    return okSlashResult({
      statePatch: {
        ...providerPatch,
        bootstrap,
        model: resolved.model,
        updatedAt,
      },
      text: [providerResult.text?.trimEnd(), ...lines]
        .filter(Boolean)
        .join("\n"),
    });
  }

  const statePatch = {
    bootstrap: {
      ...ctx.state.bootstrap,
      selectedModel: resolved.model,
    },
    model: resolved.model,
    updatedAt,
  };
  ctx.env.OMK_PROVIDER_MODEL = resolved.model;
  return okSlashResult({ statePatch, text: lines.join("\n") });
}

function renderAuthReport(
  report: Awaited<ReturnType<typeof buildAuthCenterReport>>,
  verbose: boolean,
): string {
  const lines = [
    style.phosphorBold("OMK Auth Center"),
    style.phosphorDim(`Default provider: ${report.defaultProvider}`),
    style.phosphorDim(`Authority: ${report.authorityProvider}`),
  ];
  if (report.model) lines.push(style.phosphorDim(`Model: ${report.model}`));
  lines.push("");
  for (const provider of report.providers) {
    const mark = provider.available
      ? style.phosphorBold("✓")
      : provider.enabled
        ? style.phosphorDim("○")
        : style.phosphorDim("×");
    const state = provider.available
      ? "runtime ready"
      : provider.enabled
        ? "needs setup"
        : "disabled";
    const auth = provider.apiKeyEnv
      ? `${provider.authMethod} ${provider.apiKeyEnv}`
      : provider.authMethod;
    lines.push(
      `  ${mark} ${style.phosphor(provider.provider.padEnd(12))} ${style.phosphorDim(state.padEnd(14))} ${style.phosphorDim(auth)}`,
    );
    if (verbose && provider.nextActions.length > 0) {
      for (const action of provider.nextActions.slice(0, 3))
        lines.push(style.phosphorDim(`      - ${action}`));
    }
  }
  lines.push("");
  lines.push(
    style.phosphorDim(
      "Secret policy: tokenFilesRead=false, secretValuesPrinted=false",
    ),
  );
  lines.push(
    style.phosphorDim("Use `omk auth <provider> --setup` for setup actions."),
  );
  return lines.join("\n");
}
