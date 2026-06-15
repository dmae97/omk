import test from "node:test";
import assert from "node:assert/strict";

// Import compiled dist modules
const mod = await import("../dist/runtime/debloat-nlp.js");
const {
  compileBloatToNlp,
  classifyIntent,
  selectCapabilities,
  resolveFailurePolicy,
  selectProviderRuntime,
  filterMcpConfigForTurn,
  filterMcpConfigForRuntime,
} = mod;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function inventoryWith21Mcp() {
  return [
    "filesystem", "codex", "web-reader", "playwright", "memory", "sqlite",
    "omk-project", "fetch", "filesystem-readonly", "github", "context7",
    "firecrawl", "supabase", "prisma", "railway", "zai-vision", "zread",
    "godot", "sequential-thinking", "clearthought", "gh_grep",
  ];
}

function inventoryWith67Skills() {
  return Array.from({ length: 67 }, (_, i) => `skill-${i}`);
}

// ─────────────────────────────────────────────
// 20.1 status does not load all MCP
// ─────────────────────────────────────────────

test("20.1 does not load all MCP servers for status intent", () => {
  const intent = classifyIntent("현재 상태는 어데");
  assert.equal(intent, "status");

  const selection = selectCapabilities({
    intent,
    availableMcp: inventoryWith21Mcp(),
    availableSkills: inventoryWith67Skills(),
    failedMcp: [],
  });

  assert.deepEqual(selection.requiredMcp, [], "status intent must have empty requiredMcp");
  assert.ok(selection.optionalMcp.length <= 2, `optionalMcp should be <= 2, got ${selection.optionalMcp.length}`);
  assert.ok(selection.optionalMcp.includes("omk-project"), "optionalMcp should include omk-project");
});

// ─────────────────────────────────────────────
// 20.2 no MUST activate leakage
// ─────────────────────────────────────────────

test("20.2 does not leak full inventory into provider prompt", () => {
  const { modelPrompt } = compileBloatToNlp({
    rawText: "현재 상태는 어데",
    userPayload: "현재 상태는 어데",
    capabilityEnvelope: {
      mcpEnabled: inventoryWith21Mcp(),
      skillsEnabled: inventoryWith67Skills(),
      toolsEnabled: true,
      liveRequired: false,
    },
  });

  assert.doesNotMatch(modelPrompt, /MUST activate/i, "prompt must not contain MUST activate");
  assert.doesNotMatch(modelPrompt, /MUST use/i, "prompt must not contain MUST use");
  assert.ok(modelPrompt.length < 1200, `prompt should be < 1200 chars, got ${modelPrompt.length}`);
});

// ─────────────────────────────────────────────
// 20.3 optional MCP failure is warning
// ─────────────────────────────────────────────

test("20.3 treats optional MCP failure as warning", () => {
  const result = resolveFailurePolicy({
    requiredMcp: [],
    failedMcp: ["omk-web-bridge"],
  });

  assert.deepEqual(result.blockers, [], "should have no blockers");
  assert.deepEqual(result.warnings, ["omk-web-bridge"], "should have omk-web-bridge as warning");
});

test("20.3 treats required MCP failure as blocker", () => {
  const result = resolveFailurePolicy({
    requiredMcp: ["filesystem"],
    failedMcp: ["filesystem"],
  });

  assert.deepEqual(result.blockers, ["filesystem"], "should have filesystem as blocker");
  assert.deepEqual(result.warnings, [], "should have no warnings");
});

// ─────────────────────────────────────────────
// 20.4 provider print debug only
// ─────────────────────────────────────────────

test("20.4 does not select provider-print unless debug raw is enabled", () => {
  assert.notEqual(
    selectProviderRuntime({ provider: "test-authority", intent: "status", debugRaw: false }),
    "provider-print",
    "should not be provider-print when debugRaw=false"
  );
  assert.notEqual(
    selectProviderRuntime({ provider: "test-authority", intent: "status" }),
    "provider-print",
    "should not be provider-print when debugRaw is undefined"
  );
  assert.equal(
    selectProviderRuntime({ provider: "test-authority", intent: "status", debugRaw: true }),
    "provider-print",
    "should be provider-print when debugRaw=true"
  );
});

// ─────────────────────────────────────────────
// 20.5 raw provider event not visible in NLP prompt
// ─────────────────────────────────────────────

test("20.5 does not show raw provider event objects in normal output", () => {
  const { modelPrompt } = compileBloatToNlp({
    rawText: "현재 상태는 어데",
    userPayload: "현재 상태는 어데",
  });

  assert.doesNotMatch(modelPrompt, /TurnBegin\(/, "must not contain TurnBegin(");
  assert.doesNotMatch(modelPrompt, /StatusUpdate\(/, "must not contain StatusUpdate(");
  assert.doesNotMatch(modelPrompt, /MCPStatusSnapshot\(/, "must not contain MCPStatusSnapshot(");
});

// ─────────────────────────────────────────────
// 20.6 filterMcpConfigForTurn filters correctly
// ─────────────────────────────────────────────

test("20.6 filterMcpConfigForTurn merges and filters MCP config", () => {
  const userMcp = { github: { url: "https://github.com" }, memory: { url: "http://mem" } };
  const projectMcp = { "omk-project": { url: "http://proj" }, filesystem: { url: "http://fs" } };
  const sidecar = {
    provider: "kimi",
    model: "default",
    intent: "code_edit",
    risk: "write",
    sandbox: "workspace-write",
    requiredMcp: ["filesystem"],
    optionalMcp: ["omk-project"],
    disabledMcp: [],
    selectedSkills: [],
    failurePolicy: "required-only",
  };

  const result = filterMcpConfigForTurn({ userMcpConfig: userMcp, projectMcpConfig: projectMcp, sidecar });

  assert.ok("filesystem" in result.mcpServers, "should include required filesystem");
  assert.ok("omk-project" in result.mcpServers, "should include optional omk-project");
  assert.ok(!("github" in result.mcpServers), "should exclude github (not in allowed)");
  assert.ok(!("memory" in result.mcpServers), "should exclude memory (not in allowed)");
});

test("20.6 filterMcpConfigForTurn respects disabledMcp", () => {
  const sidecar = {
    provider: "kimi",
    model: "default",
    intent: "status",
    risk: "read",
    sandbox: "read-only",
    requiredMcp: [],
    optionalMcp: ["omk-project", "memory"],
    disabledMcp: ["memory"],
    selectedSkills: [],
    failurePolicy: "required-only",
  };

  const result = filterMcpConfigForTurn({
    userMcpConfig: {},
    projectMcpConfig: { "omk-project": { url: "http://p" }, memory: { url: "http://m" } },
    sidecar,
  });

  assert.ok("omk-project" in result.mcpServers, "should include omk-project");
  assert.ok(!("memory" in result.mcpServers), "should exclude disabled memory");
});

// ─────────────────────────────────────────────
// 20.7 slash command returns CommandResult through pipeline
// ─────────────────────────────────────────────────────────

test("20.7 slash command /help returns CommandResult through CommandBus", async () => {
  const busMod = await import("../dist/runtime/command-bus.js");
  const slashMod = await import("../dist/runtime/slash-commands.js");
  const bus = busMod.createCommandBus();
  slashMod.registerSlashCommands(bus, { provider: "kimi", model: "default" });

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/help" });

  assert.equal(result.handled, true, "/help should be handled");
  assert.ok(result.output.length > 0, "should have output");
  assert.ok(result.events.length > 0, "should have events");
  const lastEvent = result.events[result.events.length - 1];
  assert.equal(lastEvent.type, "result", "last event should be result type");
  assert.equal(lastEvent.data.kind, "result", "event should be result kind");
});

test("20.7 v2 interactive REPL bus registers /think and applies session state", async () => {
  const replMod = await import("../dist/cli/v2/chat-repl.js");
  const state = replMod.createChatReplState({ provider: "codex", model: "codex-cli" });
  const bus = replMod.createChatReplCommandBus({}, state);

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/think xhigh" });
  replMod.applyChatReplSlashResultToState(state, result);

  assert.equal(result.handled, true, "/think should be handled in v2 chat REPL");
  const payload = JSON.parse(result.output);
  assert.equal(payload.thinking, "xhigh");
  assert.ok(payload.modelVariant, "should include model variant for thinking change");
  assert.equal(state.thinking, "xhigh");
  assert.equal(state.modelVariant, payload.modelVariant);

  const modelResult = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/model kimi/kimi-code" });
  replMod.applyChatReplSlashResultToState(state, modelResult, "/model kimi/kimi-code");
  assert.equal(state.provider, "kimi");
  assert.equal(state.model, "kimi-code");
  assert.equal(state.modelVariant, undefined, "route changes should clear stale thinking model variants");
  assert.equal(state.thinkingPickerOpen, true, "model changes should open the follow-up thinking picker");
});
test("20.7 v2 interactive REPL /think without args lists levels", async () => {
  const replMod = await import("../dist/cli/v2/chat-repl.js");
  const state = replMod.createChatReplState({ provider: "codex", model: "codex-cli" });
  const bus = replMod.createChatReplCommandBus({}, state);

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/think" });
  replMod.applyChatReplSlashResultToState(state, result, "/think");

  assert.equal(result.handled, true, "/think should be handled");
  const payload = JSON.parse(result.output);
  assert.equal(payload.thinking, undefined);
  assert.ok(payload.supportedThinkingLevels.includes("xhigh"));
  assert.match(result.events.at(-1).data.content, /OMK Thinking Control · choose level/);
  assert.equal(state.thinking, undefined);
  assert.equal(state.thinkingPickerOpen, true);
});

test("20.7 chat REPL prepares /model show with activeProviderTab all before dispatch", async () => {
  const replMod = await import("../dist/cli/v2/chat-repl.js");
  const tabsMod = await import("../dist/providers/model-tabs.js");
  const state = replMod.createChatReplState({ provider: "openai-codex", model: "gpt-5.5" });
  state.activeProviderTab = "openai-codex";
  const modelPickerState = tabsMod.createModelPickerState("openai-codex");

  const prepared = replMod.prepareChatReplModelPickerForShow({
    input: "/model",
    state,
    modelPickerState,
    providerIds: ["anthropic", "deepseek", "google", "mimo", "minimax", "openai-codex", "openrouter", "zai"],
  });

  assert.equal(prepared, true);
  assert.equal(state.activeProviderTab, "all");
  assert.equal(modelPickerState.activeProviderTab, "all");
});

test("20.7 chat REPL /model show renders all tab even when current runtime provider is openai-codex", async () => {
  const replMod = await import("../dist/cli/v2/chat-repl.js");
  const tabsMod = await import("../dist/providers/model-tabs.js");
  const state = replMod.createChatReplState({ provider: "openai-codex", model: "gpt-5.5" });
  state.activeProviderTab = "openai-codex";
  const bus = replMod.createChatReplCommandBus({}, state);
  const modelPickerState = tabsMod.createModelPickerState("openai-codex");

  replMod.prepareChatReplModelPickerForShow({
    input: "/model",
    state,
    modelPickerState,
    providerIds: ["anthropic", "deepseek", "google", "mimo", "minimax", "openai-codex", "openrouter", "zai"],
  });

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/model" });

  assert.equal(result.handled, true);
  assert.match(result.events.at(-1).data.content, /\[● all\]/);
  assert.doesNotMatch(result.events.at(-1).data.content, /\[● openai-codex\]/);
});

test("20.7 slash command /model returns provider info", async () => {
  const busMod = await import("../dist/runtime/command-bus.js");
  const slashMod = await import("../dist/runtime/slash-commands.js");
  const bus = busMod.createCommandBus();
  slashMod.registerSlashCommands(bus, { provider: "kimi", model: "kimi-code" });

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/model" });

  assert.equal(result.handled, true, "/model should be handled");
  const payload = JSON.parse(result.output);
  assert.equal(payload.currentProvider, "kimi", "should show provider");
  assert.equal(payload.currentModel, "kimi-code", "should show model");
  assert.ok(payload.providerGroups.some((group) => group.provider === "mimo"), "mimo should appear as default provider tab");
  const deepseekGroup = payload.providerGroups.find((group) => group.provider === "deepseek");
  const deepseekPro = deepseekGroup.models.find((entry) => entry.model === "deepseek-v4-pro");
  assert.ok(deepseekPro.thinkingLevels.includes("max"), "deepseek-v4-pro should list max thinking");
  assert.match(result.events.at(-1).data.content, /provider tabs/);
  assert.match(result.events.at(-1).data.content, /deepseek-v4-pro:max/);
});

test("20.7 slash command /model keeps provider-only selection working", async () => {
  const replMod = await import("../dist/cli/v2/chat-repl.js");
  const state = replMod.createChatReplState({ provider: "codex", model: "codex-cli" });
  const bus = replMod.createChatReplCommandBus({}, state);

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/model kimi" });
  replMod.applyChatReplSlashResultToState(state, result);

  assert.equal(result.handled, true, "/model provider-only should be handled");
  const payload = JSON.parse(result.output);
  assert.equal(payload.provider, "kimi");
  assert.equal(payload.model, "kimi-k2.6");
  assert.equal(state.provider, "kimi");
  assert.equal(state.model, "kimi-k2.6");
});

test("20.7 slash command /model parses deepseek pro max thinking", async () => {
  const replMod = await import("../dist/cli/v2/chat-repl.js");
  const state = replMod.createChatReplState({ provider: "kimi", model: "kimi-code" });
  const bus = replMod.createChatReplCommandBus({}, state);

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/model deepseek/pro:max" });
  replMod.applyChatReplSlashResultToState(state, result);

  assert.equal(result.handled, true, "/model should be handled");
  const payload = JSON.parse(result.output);
  assert.equal(payload.provider, "deepseek");
  assert.equal(payload.model, "deepseek-v4-pro");
  assert.equal(payload.thinking, "max");
  assert.equal(payload.modelVariant, "deepseek-v4-pro:max");
  assert.equal(state.provider, "deepseek");
  assert.equal(state.model, "deepseek-v4-pro");
  assert.equal(state.thinking, "max");
  assert.equal(state.modelVariant, "deepseek-v4-pro:max");
});
