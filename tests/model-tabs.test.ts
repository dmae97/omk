import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderTabs,
  createModelPickerState,
  handleModelPickerKey,
  initializeModelPickerState,
  nextProviderTab,
} from "../src/providers/model-tabs.ts";

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
