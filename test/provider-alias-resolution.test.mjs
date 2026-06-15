import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeModelAlias,
  normalizeProviderId,
  parseProviderModelArg,
} from "../dist/providers/model-registry.js";

test("normalizeModelAlias maps popular model aliases", () => {
  assert.equal(normalizeModelAlias("sonnet"), "claude-sonnet");
  assert.equal(normalizeModelAlias("opus"), "claude-opus");
  assert.equal(normalizeModelAlias("haiku"), "claude-haiku");
  assert.equal(normalizeModelAlias("gpt-4"), "gpt-4");
  assert.equal(normalizeModelAlias("gpt-4o"), "gpt-4o");
  assert.equal(normalizeModelAlias("gpt-4o-mini"), "gpt-4o-mini");
  assert.equal(normalizeModelAlias("gemini-pro"), "gemini-pro");
  assert.equal(normalizeModelAlias("gemini-flash"), "gemini-flash");
  assert.equal(normalizeModelAlias("flash"), "deepseek-v4-flash");
  assert.equal(normalizeModelAlias("pro"), "deepseek-v4-pro");
  assert.equal(normalizeModelAlias("thinking"), "deepseek-v4-flash");
  assert.equal(normalizeModelAlias("non-thinking"), "deepseek-v4-flash");
  assert.equal(normalizeModelAlias("reasoner"), "deepseek-v4-flash");
  assert.equal(normalizeModelAlias("codex"), "codex-cli");
  assert.equal(normalizeModelAlias("qwen-max"), "qwen3-max");
  assert.equal(normalizeModelAlias("Qwen 3.7 MAX"), "qwen3-max");
  assert.equal(normalizeModelAlias("glm-5"), "glm-5");
  assert.equal(normalizeModelAlias("glm5max"), "glm-5");
  assert.equal(normalizeModelAlias("glm 5.2 max"), "glm-5.2");
});

test("normalizeModelAlias maps DeepSeek variant aliases", () => {
  assert.equal(normalizeModelAlias("thinking"), "deepseek-v4-flash");
  assert.equal(normalizeModelAlias("non-thinking"), "deepseek-v4-flash");
  assert.equal(normalizeModelAlias("reasoner"), "deepseek-v4-flash");
  // Complex full-name variants are preserved by normalizeModelAlias;
  // actual alias resolution happens via registry entry.aliases in resolveProviderModelRef
  assert.equal(normalizeModelAlias("deepseek-v4-flash-thinking"), "deepseek-v4-flash-thinking");
  assert.equal(normalizeModelAlias("deepseek-v4-flash-non-thinking"), "deepseek-v4-flash-non-thinking");
  assert.equal(normalizeModelAlias("deepseek-v4-pro-thinking"), "deepseek-v4-pro-thinking");
});

test("parseProviderModelArg resolves DeepSeek variant aliases", () => {
  assert.deepEqual(parseProviderModelArg("deepseek/thinking"), {
    provider: "deepseek",
    model: "deepseek-v4-flash",
  });
  assert.deepEqual(parseProviderModelArg("deepseek/non-thinking"), {
    provider: "deepseek",
    model: "deepseek-v4-flash",
  });
  assert.deepEqual(parseProviderModelArg("thinking"), {
    provider: "deepseek",
    model: "deepseek-v4-flash",
  });
});

test("normalizeProviderId maps popular provider aliases", () => {
  assert.equal(normalizeProviderId("claude"), "openrouter");
  assert.equal(normalizeProviderId("ds"), "deepseek");
  assert.equal(normalizeProviderId("deepseek"), "deepseek");
  assert.equal(normalizeProviderId("openrouter"), "openrouter");
  assert.equal(normalizeProviderId("codex"), "codex");
  assert.equal(normalizeProviderId("qwen"), "qwen");
  assert.equal(normalizeProviderId("kimi"), "kimi");
  assert.equal(normalizeProviderId("bigmodel"), "glm");
  assert.equal(normalizeProviderId("zhipu"), "glm");
});

test("parseProviderModelArg resolves provider and model aliases", () => {
  assert.deepEqual(parseProviderModelArg("openrouter/sonnet"), {
    provider: "openrouter",
    model: "claude-sonnet",
  });
  assert.deepEqual(parseProviderModelArg("claude/opus"), {
    provider: "openrouter",
    model: "claude-opus",
  });
  assert.deepEqual(parseProviderModelArg("deepseek/flash"), {
    provider: "deepseek",
    model: "deepseek-v4-flash",
  });
  assert.deepEqual(parseProviderModelArg("codex"), {
    provider: "codex",
    model: "codex-cli",
  });
  assert.deepEqual(parseProviderModelArg("qwen-max"), {
    model: "qwen3-max",
  });
  assert.deepEqual(parseProviderModelArg("gpt-4o"), {
    provider: "openrouter",
    model: "gpt-4o",
  });
  assert.deepEqual(parseProviderModelArg("glm-5"), {
    provider: "glm",
    model: "glm-5",
  });
  assert.deepEqual(parseProviderModelArg("glm 5.2 max"), {
    provider: "glm",
    model: "glm-5.2",
    thinkingLevel: "max",
  });
  assert.deepEqual(parseProviderModelArg("bigmodel/glm-5-air"), {
    provider: "glm",
    model: "glm-5-air",
  });
  assert.deepEqual(parseProviderModelArg("zhipu/glm 5.2 max"), {
    provider: "glm",
    model: "glm-5.2",
    thinkingLevel: "max",
  });
});
