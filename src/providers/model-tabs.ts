export type ProviderTabId = "all" | string;

export const ALL_PROVIDER_TAB = "all" as const;

export const PROVIDER_ORDER = [
  "anthropic",
  "deepseek",
  "google",
  "mimo",
  "minimax",
  "openai-codex",
  "openrouter",
  "zai",
] as const;

const HIDDEN_PROVIDER_TAB_IDS = new Set(["kimi", "qwen"]);

export function providerTabIdForProvider(providerId: string | null | undefined): ProviderTabId | null {
  const id = providerId?.trim();
  if (!id || id.startsWith("__") || id.startsWith("local-")) {
    return null;
  }
  if (id === "codex") {
    return "openai-codex";
  }
  if (HIDDEN_PROVIDER_TAB_IDS.has(id)) {
    return null;
  }
  return id;
}

export function buildProviderTabs(providerIds: readonly string[]): ProviderTabId[] {
  const unique = Array.from(new Set(
    providerIds
      .map((id) => providerTabIdForProvider(id))
      .filter((id): id is ProviderTabId => Boolean(id)),
  ));

  const extras = unique
    .filter((id) => !PROVIDER_ORDER.includes(id as (typeof PROVIDER_ORDER)[number]))
    .sort((a, b) => a.localeCompare(b));

  return [ALL_PROVIDER_TAB, ...PROVIDER_ORDER, ...extras];
}

export function normalizeProviderTab(
  value: string | null | undefined,
  tabs: readonly ProviderTabId[],
): ProviderTabId {
  if (value && tabs.includes(value)) {
    return value;
  }

  return ALL_PROVIDER_TAB;
}

export function nextProviderTab(
  tabs: readonly ProviderTabId[],
  active: ProviderTabId,
  direction: 1 | -1,
): ProviderTabId {
  if (tabs.length === 0) {
    return ALL_PROVIDER_TAB;
  }

  const currentIndex = tabs.indexOf(active);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + tabs.length) % tabs.length;

  return tabs[nextIndex] ?? ALL_PROVIDER_TAB;
}

export type ModelPickerState = {
  activeProviderTab: ProviderTabId;
  cursor: number;
  query: string;
};

export function createModelPickerState(activeProviderTab: string | null | undefined = ALL_PROVIDER_TAB): ModelPickerState {
  return {
    activeProviderTab: activeProviderTab ?? ALL_PROVIDER_TAB,
    cursor: 0,
    query: "",
  };
}

export function initializeModelPickerState(args: {
  state: ModelPickerState;
  providerIds: readonly string[];
  explicitProviderTab?: string | null | undefined;
}): readonly ProviderTabId[] {
  const tabs = buildProviderTabs(args.providerIds);
  args.state.activeProviderTab = args.explicitProviderTab
    ? normalizeProviderTab(args.explicitProviderTab, tabs)
    : ALL_PROVIDER_TAB;
  args.state.cursor = 0;
  return tabs;
}

export function debugModelTabs(args: {
  providerIds: readonly string[];
  tabs: readonly ProviderTabId[];
  activeProviderTab: ProviderTabId;
  key?: string;
  nextProviderTab?: ProviderTabId;
  runtimeProvider?: string;
  runtimeModel?: string;
  visibleRowCount?: number;
}): void {
  if (process.env.OMK_DEBUG_MODEL_TABS !== "1") {
    return;
  }

  const key = args.key ? ` key=${formatDebugKey(args.key)}` : "";
  const next = args.nextProviderTab ? ` next=${args.nextProviderTab}` : "";
  const runtime = args.runtimeProvider || args.runtimeModel
    ? ` runtime=${args.runtimeProvider ?? "unknown"}/${args.runtimeModel ?? "unknown"}`
    : "";
  const rows = args.visibleRowCount == null ? "" : ` rows=${args.visibleRowCount}`;
  process.stderr.write(
    `[model-tabs] providerIds=${args.providerIds.join(",")} tabs=${args.tabs.join(",")} active=${args.activeProviderTab}${key}${next}${runtime}${rows}\n`,
  );
}

function formatDebugKey(key: string): string {
  if (key === "\t") return "Tab";
  if (key === "\x1b[Z") return "Shift-Tab";
  return key.replace(/\x1b/g, "\\x1b");
}

export function handleModelPickerKey(args: {
  key: string;
  state: ModelPickerState;
  providerIds: readonly string[];
}): boolean {
  const tabs = buildProviderTabs(args.providerIds);

  args.state.activeProviderTab = normalizeProviderTab(
    args.state.activeProviderTab,
    tabs,
  );

  if (args.key === "\t") {
    args.state.activeProviderTab = nextProviderTab(
      tabs,
      args.state.activeProviderTab,
      1,
    );
    args.state.cursor = 0;
    return true;
  }

  if (args.key === "\x1b[Z") {
    args.state.activeProviderTab = nextProviderTab(
      tabs,
      args.state.activeProviderTab,
      -1,
    );
    args.state.cursor = 0;
    return true;
  }

  return false;
}
