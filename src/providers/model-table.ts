import type { ProviderRegistryEntry } from "./model-registry.js";
import { ALL_PROVIDER_TAB, buildProviderTabs, normalizeProviderTab, providerTabIdForProvider, type ProviderTabId } from "./model-tabs.js";
import { thinkingLevelsFor } from "./thinking-levels.js";
import { style } from "../util/theme.js";

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function displayProviderId(providerId: string): string {
  return providerTabIdForProvider(providerId) ?? providerId;
}


function providerMark(entry: ProviderRegistryEntry, currentProvider?: string): string {
  if (isCurrentProvider(entry, currentProvider)) return style.mintBold("●");
  return entry.enabled ? style.phosphorDim("○") : style.gray("×");
}
function isCurrentProvider(entry: ProviderRegistryEntry, currentProvider?: string): boolean {
  const displayId = displayProviderId(entry.id);
  const currentDisplayId = currentProvider ? displayProviderId(currentProvider) : undefined;
  return entry.id === currentProvider || displayId === currentProvider || displayId === currentDisplayId;
}


function routingLabel(entry: ProviderRegistryEntry): string {
  if (entry.routing === "runtime") return style.mint("runtime");
  if (entry.routing === "external-cli") return style.blue("cli");
  return style.gray("advisory");
}

export interface ProviderModelDescriptor {
  model: string;
  aliases: string[];
  thinkingLevels: string[];
  thinkingVariants: string[];
}

export interface ProviderModelGroup {
  provider: string;
  enabled: boolean;
  kind: ProviderRegistryEntry["kind"];
  routing: ProviderRegistryEntry["routing"];
  baseUrl?: string;
  models: ProviderModelDescriptor[];
}

export function providerModelRows(entry: ProviderRegistryEntry): string[] {
  return uniqueValues([entry.defaultModel, ...Object.values(entry.aliases)]);
}

export function groupProviderModelsByProvider(providers: readonly ProviderRegistryEntry[]): ProviderModelGroup[] {
  return providers
    .filter((entry) => !String(entry.id).startsWith("__"))
    .map((entry) => ({
      provider: entry.id,
      enabled: entry.enabled,
      kind: entry.kind,
      routing: entry.routing,
      baseUrl: entry.baseUrl,
      models: providerModelRows(entry).map((model) => {
        const thinkingLevels = thinkingLevelsFor(entry.id, model).map((level) => level.toString());
        return {
          model,
          aliases: Object.entries(entry.aliases)
            .filter(([, target]) => target === model)
            .map(([alias]) => alias)
            .filter((alias) => alias !== model)
            .sort((a, b) => a.localeCompare(b)),
          thinkingLevels,
          thinkingVariants: thinkingLevels.map((level) => `${model}:${level}`),
        };
      }),
    }));
}

function renderProviderTabs(args: {
  tabs: readonly ProviderTabId[];
  activeProviderTab: ProviderTabId;
  groups: readonly ProviderModelGroup[];
}): string {
  const groupByProvider = new Map(
    args.groups
      .map((group) => [providerTabIdForProvider(group.provider), group] as const)
      .filter((entry): entry is readonly [ProviderTabId, ProviderModelGroup] => entry[0] !== null),
  );

  return args.tabs
    .map((tab) => {
      const selected = tab === args.activeProviderTab;
      const group = groupByProvider.get(tab);
      const marker = selected ? "●" : group && !group.enabled ? "×" : "○";
      const label = `[${marker} ${tab}]`;
      if (selected) return style.mintBold(label);
      return group && !group.enabled ? style.gray(label) : style.cyan(label);
    })
    .join(style.gray("  "));
}

export function renderProviderModelTable(
  providers: readonly ProviderRegistryEntry[],
  options: { currentProvider?: string; currentModel?: string; currentThinking?: string; compactAliases?: boolean; activeProviderTab?: string } = {},
): string {
  const groups = groupProviderModelsByProvider(providers);
  const tabs = buildProviderTabs(groups.map((group) => group.provider));
  const activeProviderTab = normalizeProviderTab(options.activeProviderTab, tabs);
  const visibleGroups = activeProviderTab === ALL_PROVIDER_TAB
    ? groups
    : groups.filter((group) => providerTabIdForProvider(group.provider) === activeProviderTab);
  const lines = [
    style.phosphorBold("\n  OMK Model Control · provider tabs"),
    style.phosphorDim("  /model <provider/model>[:level]  ·  /think [next|medium|high|xhigh|max|variant <name>]"),
    `  ${renderProviderTabs({ tabs, activeProviderTab, groups })}`,
    style.gray("  " + "─".repeat(78)),
  ];

  const entryById = new Map(providers.map((entry) => [entry.id, entry]));

  for (const group of visibleGroups) {
    const entry = entryById.get(group.provider);
    if (!entry) continue;
    const selected = isCurrentProvider(entry, options.currentProvider);
    const statusTag = entry.enabled ? style.mint("enabled") : style.orange("disabled");
    const routeTag = routingLabel(entry);
    const title = `${providerMark(entry, options.currentProvider)} ${style.cyanBold(`[${displayProviderId(entry.id)}]`)} ${statusTag} ${routeTag} ${style.gray(entry.kind)}`;
    lines.push(`  ${style.gray("┌─")} ${title}`);

    // Models row: each model is a compact tab panel line with supported thinking levels.
    const modelsWithAliases = group.models;
    const models = modelsWithAliases.map((item) => item.model);
    const isCurrent = selected;
    const isCurrentModel = (model: string) => isCurrent && model === options.currentModel;

    for (const { model, aliases, thinkingLevels, thinkingVariants } of modelsWithAliases.slice(0, 6)) {
      const modelLabel = isCurrentModel(model)
        ? style.mintBold(model)
        : style.phosphorDim(model);

      const aliasSuffix = aliases.length > 0
        ? style.gray(` (${aliases.join(", ")})`)
        : "";

      const levelHints = thinkingLevels
        .map((level) => {
          if (level === options.currentThinking && isCurrentModel(model)) return style.mintBold(level);
          if (level === "max") return style.cyanBold(level);
          return style.gray(level);
        })
        .join(style.gray(" · "));
      const maxVariant = thinkingVariants.find((variant) => variant.endsWith(":max"));
      const maxHint = maxVariant ? `${style.gray("  max think:")} ${style.cyanBold(maxVariant)}` : "";

      lines.push(`  ${style.gray("│")}   ${modelLabel}${aliasSuffix}`);
      if (!options.compactAliases && thinkingLevels.length > 0) {
        lines.push(`  ${style.gray("│")}     ${style.gray("think:")} ${levelHints}${maxHint}`);
      }
    }

    // Show remaining models count
    if (models.length > 6) {
      lines.push(`  ${style.gray("│")}   ${style.phosphorDim(`+${models.length - 6} more`)}`);
    }

    // Base URL hint for this provider
    if (entry.baseUrl && !options.compactAliases) {
      lines.push(`  ${style.gray("│")}   ${style.gray("base :")} ${style.phosphorDim(entry.baseUrl)}`);
    }

    if (selected) {
      const currentInfo = options.currentModel
        ? `${options.currentModel}${options.currentThinking ? `:${options.currentThinking}` : ""}`
        : "auto";
      lines.push(style.mint(`  │   ⟐ current: ${currentInfo}`));
    }

    lines.push(`  ${style.gray("└─")} ${style.phosphorDim(`${displayProviderId(group.provider)} tab end`)}`);
  }

  lines.push(style.gray("  " + "─".repeat(78)));
  lines.push(style.phosphorDim("  Use /model <provider/model>[:level] to switch. Custom variant: /think variant code-high\n"));
  return lines.join("\n");
}
