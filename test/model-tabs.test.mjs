import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderTabs,
  createModelPickerState,
  handleModelPickerKey,
  initializeModelPickerState,
  nextProviderTab,
} from "../dist/providers/model-tabs.js";
import { renderProviderModelTable } from "../dist/providers/model-table.js";

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

test("provider tabs start with all", () => {
  const tabs = buildProviderTabs([
    "openai-codex",
    "openrouter",
    "zai",
    "deepseek",
    "mimo",
    "anthropic",
    "google",
    "minimax",
  ]);

  assert.deepEqual(tabs, [
    "all",
    "anthropic",
    "deepseek",
    "google",
    "mimo",
    "minimax",
    "openai-codex",
    "openrouter",
    "zai",
  ]);
});

test("provider tabs ignore internal registry metadata ids while preserving canonical tabs", () => {
  const tabs = buildProviderTabs(["mimo", "__providerDefaults", "openrouter", "__userModelAliases"]);

  assert.deepEqual(tabs, [
    "all",
    "anthropic",
    "deepseek",
    "google",
    "mimo",
    "minimax",
    "openai-codex",
    "openrouter",
    "zai",
  ]);
});
test("model picker initializes to all without explicit provider even when runtime provider is openai-codex", () => {
  const state = createModelPickerState("openai-codex");
  const runtimeProvider = "openai-codex";

  initializeModelPickerState({
    state,
    providerIds: ["anthropic", "deepseek", "google", "mimo", "minimax", "openai-codex", "openrouter", "zai"],
  });

  assert.equal(runtimeProvider, "openai-codex");
  assert.equal(state.activeProviderTab, "all");
});

test("model picker initializes to explicit provider tab", () => {
  const state = createModelPickerState("all");

  initializeModelPickerState({
    state,
    providerIds: ["anthropic", "deepseek", "google", "mimo", "minimax", "openai-codex", "openrouter", "zai"],
    explicitProviderTab: "deepseek",
  });

  assert.equal(state.activeProviderTab, "deepseek");
});

test("tab wraps from zai to all", () => {
  const tabs = buildProviderTabs([
    "anthropic",
    "deepseek",
    "google",
    "mimo",
    "minimax",
    "openai-codex",
    "openrouter",
    "zai",
  ]);

  assert.equal(nextProviderTab(tabs, "zai", 1), "all");
});

test("shift-tab wraps from all to zai", () => {
  const tabs = buildProviderTabs([
    "anthropic",
    "deepseek",
    "google",
    "mimo",
    "minimax",
    "openai-codex",
    "openrouter",
    "zai",
  ]);

  assert.equal(nextProviderTab(tabs, "all", -1), "zai");
});

test("tab from openai-codex goes to openrouter", () => {
  const tabs = buildProviderTabs([
    "anthropic",
    "deepseek",
    "google",
    "mimo",
    "minimax",
    "openai-codex",
    "openrouter",
    "zai",
  ]);

  assert.equal(nextProviderTab(tabs, "openai-codex", 1), "openrouter");
});
test("tab from all goes to anthropic", () => {
  const tabs = buildProviderTabs([
    "anthropic",
    "deepseek",
    "google",
    "mimo",
    "minimax",
    "openai-codex",
    "openrouter",
    "zai",
  ]);

  assert.equal(nextProviderTab(tabs, "all", 1), "anthropic");
});

test("full tab sequence starts at all and wraps after zai", () => {
  const state = createModelPickerState("all");
  const providerIds = ["openai-codex", "openrouter", "zai"];
  const sequence = [state.activeProviderTab];

  for (let i = 0; i < 9; i += 1) {
    handleModelPickerKey({ key: "\t", state, providerIds });
    sequence.push(state.activeProviderTab);
  }

  assert.deepEqual(sequence, [
    "all",
    "anthropic",
    "deepseek",
    "google",
    "mimo",
    "minimax",
    "openai-codex",
    "openrouter",
    "zai",
    "all",
  ]);
});

test("model picker key handler mutates active tab but not current provider", () => {
  const state = createModelPickerState("all");
  const providerIds = [
    "anthropic",
    "deepseek",
    "google",
    "mimo",
    "minimax",
    "openai-codex",
    "openrouter",
    "zai",
  ];

  assert.equal(handleModelPickerKey({ key: "\t", state, providerIds }), true);
  assert.equal(state.activeProviderTab, "anthropic");
  assert.equal(handleModelPickerKey({ key: "\x1b[Z", state, providerIds }), true);
  assert.equal(state.activeProviderTab, "all");
});

test("explicit provider active tab is independent from current runtime provider", () => {
  const providers = [
    providerEntry("openai-codex", "gpt-5.5"),
    providerEntry("deepseek", "deepseek-v4-flash"),
  ];

  const output = stripAnsi(renderProviderModelTable(providers, {
    currentProvider: "openai-codex",
    currentModel: "gpt-5.5",
    activeProviderTab: "deepseek",
  }));

  assert.match(output, /\[● deepseek\]/);
  assert.match(output, /\[○ openai-codex\]/);
  assert.doesNotMatch(output, /\[● openai-codex\]/);
  assert.match(output, /deepseek-v4-flash/);
  assert.doesNotMatch(output, /gpt-5\.5/);
});
test("selected model check remains on runtime provider when active tab is all", () => {
  const providers = [
    providerEntry("openai-codex", "gpt-5.5"),
    providerEntry("deepseek", "deepseek-v4-flash"),
  ];

  const output = stripAnsi(renderProviderModelTable(providers, {
    currentProvider: "openai-codex",
    currentModel: "gpt-5.5",
    activeProviderTab: "all",
  }));

  assert.match(output, /gpt-5\.5/);
  assert.match(output, /⟐ current: gpt-5\.5/);
  assert.match(output, /\[● all\]/);
});

test("visible rows for all contain all providers", () => {
  const providers = [
    providerEntry("openai-codex", "gpt-5.5"),
    providerEntry("deepseek", "deepseek-v4-flash"),
  ];

  const output = stripAnsi(renderProviderModelTable(providers, {
    currentProvider: "openai-codex",
    currentModel: "gpt-5.5",
    activeProviderTab: "all",
  }));

  assert.match(output, /\[openai-codex\]/);
  assert.match(output, /\[deepseek\]/);
});

test("repeated render does not reset active provider tab to runtime provider", () => {
  const providers = [
    providerEntry("openai-codex", "gpt-5.5"),
    providerEntry("deepseek", "deepseek-v4-flash"),
  ];
  const state = createModelPickerState("deepseek");

  const first = stripAnsi(renderProviderModelTable(providers, {
    currentProvider: "openai-codex",
    currentModel: "gpt-5.5",
    activeProviderTab: state.activeProviderTab,
  }));
  const second = stripAnsi(renderProviderModelTable(providers, {
    currentProvider: "openai-codex",
    currentModel: "gpt-5.5",
    activeProviderTab: state.activeProviderTab,
  }));

  assert.equal(state.activeProviderTab, "deepseek");
  assert.match(first, /\[● deepseek\]/);
  assert.match(second, /\[● deepseek\]/);
  assert.doesNotMatch(second, /\[● openai-codex\]/);
});

test("render does not mutate model picker active tab", () => {
  const providers = [providerEntry("openai-codex", "gpt-5.5")];
  const state = createModelPickerState("all");

  renderProviderModelTable(providers, {
    currentProvider: "openai-codex",
    currentModel: "gpt-5.5",
    activeProviderTab: state.activeProviderTab,
  });

  assert.equal(state.activeProviderTab, "all");
});

test("model table defaults active provider tab to all", () => {
  const providers = [
    providerEntry("openai-codex", "codex-cli"),
    providerEntry("openrouter", "openrouter/auto"),
    providerEntry("zai", "zai-default"),
    providerEntry("deepseek", "deepseek-v4-flash"),
    providerEntry("mimo", "mimo-v2.5-pro"),
    providerEntry("anthropic", "claude-sonnet"),
    providerEntry("google", "gemini-pro"),
    providerEntry("minimax", "minimax-default"),
  ];

  const output = stripAnsi(renderProviderModelTable(providers, {
    currentProvider: "openai-codex",
    currentModel: "codex-cli",
  }));

  assert.match(output, /\[● all\]/);
  assert.match(output, /\[○ openai-codex\]/);
  assert.doesNotMatch(output, /\[● openai-codex\]/);
  assert.match(output, /⟐ current: codex-cli/);
});

function providerEntry(id, defaultModel) {
  return {
    id,
    enabled: true,
    kind: "openai-compatible",
    defaultModel,
    aliases: { default: defaultModel, [defaultModel]: defaultModel },
    capabilities: [],
    configured: true,
    routing: "runtime",
  };
}
