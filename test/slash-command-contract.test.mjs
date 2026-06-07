import test from "node:test";
import assert from "node:assert/strict";

const { parseSlashArgs, parseSlashInput, tokenizeSlashArgs } =
  await import("../dist/commands/chat/slash/parser.js");
const { SlashCommandRegistry, createSlashCommandRegistry } =
  await import("../dist/commands/chat/slash/registry.js");
const { errorSlashResult, okSlashResult } =
  await import("../dist/commands/chat/slash/result.js");
const { buildNativeChatSlashCommands } =
  await import("../dist/commands/chat/slash/commands/index.js");
const { buildUiSlashCommands } =
  await import("../dist/commands/chat/slash/commands/ui.js");
const { buildNativeParallelTurnArgs } =
  await import("../dist/commands/chat/native-root-loop.js");
const { renderCapabilityRoutingArtifact } =
  await import("../dist/orchestration/capability-routing.js");
const { readFileSync } = await import("node:fs");

test("slash parser handles quoted args and flags without shell evaluation", () => {
  assert.deepEqual(
    tokenizeSlashArgs('"refactor harness tests" --json --limit=20 plain'),
    ["refactor harness tests", "--json", "--limit=20", "plain"],
  );

  const parsed = parseSlashInput(
    '/parallel "refactor harness tests" --json --tag=ui --tag=harness',
  );
  assert.equal(parsed?.command, "/parallel");
  assert.equal(
    parsed?.args.raw,
    '"refactor harness tests" --json --tag=ui --tag=harness',
  );
  assert.deepEqual(parsed?.args.positional, ["refactor harness tests"]);
  assert.deepEqual(parsed?.args.flags, { json: true, tag: ["ui", "harness"] });
});

test("slash parser ignores ordinary chat input", () => {
  assert.equal(parseSlashInput("please review the repo"), undefined);
  assert.deepEqual(parseSlashArgs("").argv, []);
});

test("slash registry resolves primary names and aliases", () => {
  const command = {
    name: "/theme",
    aliases: ["/th", ":theme"],
    group: "ui",
    summary: "Change chat theme",
    usage: "/theme <name>",
    examples: ["/theme green-rain"],
    handler: () => okSlashResult({ text: "theme updated" }),
  };
  const registry = createSlashCommandRegistry([command]);

  assert.equal(registry.find("/theme"), command);
  assert.equal(registry.find("/th"), command);
  assert.equal(registry.resolve(parseSlashInput(":theme green-rain")), command);
  assert.deepEqual(
    registry.list().map((spec) => spec.name),
    ["/theme"],
  );
});

test("slash registry rejects duplicate or non-command names", () => {
  assert.throws(
    () =>
      new SlashCommandRegistry([
        {
          name: "theme",
          aliases: [],
          group: "ui",
          summary: "bad",
          usage: "theme",
          examples: [],
          handler: () => okSlashResult(),
        },
      ]),
    /Invalid slash command name/,
  );

  assert.throws(
    () =>
      new SlashCommandRegistry([
        {
          name: "/theme",
          aliases: ["/th"],
          group: "ui",
          summary: "one",
          usage: "/theme",
          examples: [],
          handler: () => okSlashResult(),
        },
        {
          name: "/other",
          aliases: ["/th"],
          group: "ui",
          summary: "two",
          usage: "/other",
          examples: [],
          handler: () => errorSlashResult("duplicate"),
        },
      ]),
    /Duplicate slash command name/,
  );
});

test("native chat slash command registry exposes modular control-plane commands", () => {
  const commands = buildNativeChatSlashCommands();
  const names = new Set(commands.map((command) => command.name));

  for (const expected of [
    "/help",
    "/status",
    "/provider",
    "/route",
    "/mcp",
    "/tools",
    "/theme",
    "/view",
    "/animation",
    "/parallel",
  ]) {
    assert.equal(names.has(expected), true, `${expected} should be registered`);
  }
  assert.equal(
    commands.every((command) => typeof command.handler === "function"),
    true,
  );
  assert.equal(
    commands.every((command) => !("help" in command)),
    true,
  );
});

test("/model exposes provider-grouped model JSON", async () => {
  const commands = new Map(
    buildNativeChatSlashCommands().map((command) => [command.name, command]),
  );
  const model = commands.get("/model");
  assert.ok(model, "/model should be registered");

  const ctx = {
    input: { root: process.cwd(), runId: "slash-model-test", layout: "plain" },
    state: {
      bootstrap: { provider: "codex", selectedRuntimeId: "codex-cli" },
      provider: "codex",
      model: "codex-cli",
    },
    env: {},
  };

  const result = await model.handler(ctx, parseSlashArgs("--json"));
  assert.equal(result.ok, true);
  assert.equal(result.json.schema, "omk.slash.model-groups.v1");
  assert.ok(Array.isArray(result.json.providerGroups));
  assert.ok(result.json.providerGroups.some((group) => group.provider === "mimo"));
  assert.ok(result.json.providerGroups.some((group) => group.provider === "codex"));
  assert.ok(result.json.providerGroups.every((group) => Array.isArray(group.models)));
  const deepseekGroup = result.json.providerGroups.find((group) => group.provider === "deepseek");
  const deepseekPro = deepseekGroup?.models.find((entry) => entry.model === "deepseek-v4-pro");
  assert.ok(deepseekPro?.thinkingLevels.includes("max"), "deepseek-v4-pro should expose max thinking");
  assert.ok(deepseekPro?.thinkingVariants.includes("deepseek-v4-pro:max"));
});

test("/model applies deepseek/pro:max as provider, model, and thinking", async () => {
  const commands = new Map(
    buildNativeChatSlashCommands().map((command) => [command.name, command]),
  );
  const model = commands.get("/model");
  assert.ok(model, "/model should be registered");

  const ctx = {
    input: { root: process.cwd(), runId: "slash-model-set-test", layout: "plain" },
    state: {
      bootstrap: { provider: "kimi", selectedRuntimeId: "kimi-api" },
      provider: "kimi",
      model: "kimi-k2.6",
    },
    env: { DEEPSEEK_API_KEY: "test-deepseek-key" },
  };

  const result = await model.handler(ctx, parseSlashArgs("deepseek/pro:max"));
  assert.equal(result.ok, true);
  assert.equal(result.statePatch.provider, "deepseek");
  assert.equal(result.statePatch.model, "deepseek-v4-pro");
  assert.equal(result.statePatch.thinking, "max");
  assert.equal(ctx.env.OMK_MODEL_VARIANT, "deepseek-v4-pro:max");
  assert.match(result.text, /Thinking: max/);
});

test("/model and /use reject unsupported thinking before mutating state", async () => {
  const commands = new Map(
    buildNativeChatSlashCommands().map((command) => [command.name, command]),
  );
  const model = commands.get("/model");
  const use = commands.get("/use");
  assert.ok(model, "/model should be registered");
  assert.ok(use, "/use should be registered");

  for (const command of [model, use]) {
    const ctx = {
      input: { root: process.cwd(), runId: "slash-model-reject-test", layout: "plain" },
      state: {
        bootstrap: { provider: "kimi", selectedRuntimeId: "kimi-api" },
        provider: "kimi",
        model: "kimi-k2.6",
      },
      env: { DEEPSEEK_API_KEY: "test-deepseek-key" },
    };
    const result = await command.handler(ctx, parseSlashArgs("deepseek/pro:medium"));
    assert.equal(result.ok, false);
    assert.equal(result.statePatch, undefined);
    assert.equal(ctx.env.OMK_MODEL_VARIANT, undefined);
    assert.match(result.text, /Unsupported thinking level: medium/);
  }
});

test("/think accepts custom variant alias varint", async () => {
  const commands = new Map(
    buildNativeChatSlashCommands().map((command) => [command.name, command]),
  );
  const think = commands.get("/think");
  assert.ok(think, "/think should be registered");

  const ctx = {
    input: { root: process.cwd(), runId: "slash-think-test", layout: "plain" },
    state: {
      bootstrap: { provider: "codex", selectedRuntimeId: "codex-cli" },
      provider: "codex",
      model: "codex-cli",
    },
    env: {},
  };

  const result = await think.handler(ctx, parseSlashArgs("varint code-high"));
  assert.equal(result.ok, true);
  assert.equal(result.statePatch.thinking, "code-high");
  assert.equal(ctx.env.OMK_MODEL_VARIANT, "codex-cli:code-high");
  assert.match(result.text, /custom variant/i);
});

test("/route previews route policy, evidence gates, and assigned agent lanes", async () => {
  const commands = new Map(
    buildNativeChatSlashCommands().map((command) => [command.name, command]),
  );
  const route = commands.get("/route");
  assert.ok(route, "/route should be registered");

  const ctx = {
    input: {
      root: process.cwd(),
      runId: "slash-route-test",
      layout: "plain",
      mcpAllowlist: ["omk-project"],
      skillNames: ["omk-repo-explorer", "omk-security-review", "omk-quality-gate"],
      hookNames: ["protect-secrets.sh"],
      executionPrompt: "parallel",
    },
    state: {
      bootstrap: { provider: "codex", selectedRuntimeId: "codex-cli" },
      provider: "codex",
    },
    env: {},
  };

  const jsonResult = await route.handler(
    ctx,
    parseSlashArgs('"크리티컬 이슈좀 찾아줘" --json'),
  );
  assert.equal(jsonResult.ok, true);
  assert.equal(jsonResult.json.schema, "omk.slash.route-preview.v1");
  assert.equal(jsonResult.json.route.intent, "critical_issue_scan");
  assert.equal(jsonResult.json.route.mode, "read-only");
  assert.deepEqual(jsonResult.json.route.requiredEvidence.map((item) => item.kind), [
    "diff",
    "test",
    "diagnostic",
  ]);
  const securityLane = jsonResult.json.assignments.find(
    (assignment) => assignment.agent === "security_reviewer",
  );
  assert.ok(securityLane);
  assert.deepEqual(securityLane.skills, ["omk-security-review", "omk-secret-guard"]);
  assert.deepEqual(securityLane.mcpServers, ["omk-project"]);
  assert.deepEqual(securityLane.hooks, ["protect-secrets.sh"]);

  const textResult = await route.handler(
    ctx,
    parseSlashArgs('"크리티컬 이슈좀 찾아줘"'),
  );
  assert.equal(textResult.ok, true);
  assert.match(textResult.text, /Route Policy Preview/);
  assert.match(textResult.text, /Evidence Gates/);
  assert.match(textResult.text, /security_reviewer/);
});

test("slash UI commands patch theme view and animation session state", async () => {
  const commands = new Map(
    buildUiSlashCommands().map((command) => [command.name, command]),
  );
  const ctx = {
    input: { root: process.cwd(), runId: "slash-ui-test", layout: "plain" },
    state: {
      bootstrap: { provider: "codex", selectedRuntimeId: "codex-cli" },
      provider: "codex",
    },
    env: {},
  };

  const theme = await commands
    .get("/theme")
    .handler(ctx, parseSlashArgs("control"));
  assert.equal(theme.ok, true);
  assert.equal(theme.statePatch.theme, "neon-grid");
  assert.match(theme.text, /OMK\/\/CONTROL/);
  Object.assign(ctx.state, theme.statePatch);
  const rustTheme = await commands
    .get("/theme")
    .handler(ctx, parseSlashArgs("rust"));
  assert.equal(rustTheme.ok, true);
  assert.equal(rustTheme.statePatch.theme, "rust-forge");
  assert.match(rustTheme.text, /OMK Rust Forge/);

  const view = await commands
    .get("/view")
    .handler(ctx, parseSlashArgs("toolplane"));
  assert.equal(view.ok, true);
  assert.equal(view.statePatch.view, "tool-plane");
  assert.equal(ctx.env.OMK_TUI_VIEW, "tool-plane");
  Object.assign(ctx.state, view.statePatch);

  const animation = await commands
    .get("/animation")
    .handler(ctx, parseSlashArgs("low"));
  assert.equal(animation.ok, true);
  assert.equal(animation.statePatch.animation, "low");
  assert.equal(ctx.env.OMK_ANIMATION, "low");
});

test("native parallel turn command carries provider, model, workers, and MCP scope", () => {
  const args = buildNativeParallelTurnArgs(
    {
      bootstrap: {
        provider: "codex",
        providerPolicy: "codex",
        selectedProvider: "codex",
        selectedModel: "codex-cli",
      },
      runId: "chat-parallel-parent",
      env: {
        OMK_MODEL_VARIANT: "codex-cli:code-high",
        OMK_MCP_SCOPE: "all",
      },
      workers: 4,
    },
    "ship the UI polish"
  );

  assert.deepEqual(args.slice(0, 6), ["dist/cli.js", "parallel", "ship the UI polish", "--execution", "parallel", "--chat"]);
  assert.ok(args.includes("--workers"));
  assert.ok(args.includes("4"));
  assert.ok(args.includes("--provider"));
  assert.ok(args.includes("codex"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("codex-cli:code-high"));
  assert.ok(args.includes("--mcp-scope"));
  assert.ok(args.includes("all"));
});

test("capability routing artifact carries OMK orchestrator identity and goal", () => {
  const artifact = renderCapabilityRoutingArtifact(
    [
      {
        id: "worker-1",
        name: "worker",
        role: "coder",
        dependsOn: [],
        status: "pending",
        retries: 0,
        maxRetries: 1,
        routing: {
          provider: "auto",
          skills: ["omk-typescript-strict"],
          mcpServers: ["omk-project"],
          hooks: ["protect-secrets.sh"],
        },
      },
    ],
    { goal: "ship orchestration identity" }
  );

  assert.equal(artifact.orchestrator.owner, "omk");
  assert.equal(artifact.orchestrator.identity, "OMK root orchestrator");
  assert.match(artifact.orchestrator.doctrine, /OMK routes, verifies, measures, and controls/);
  assert.equal(artifact.orchestrator.goal, "ship orchestration identity");
  assert.equal(artifact.orchestrator.capabilityAssignment, "goal-scoped");
  assert.deepEqual(artifact.nodes[0].skills, ["omk-typescript-strict"]);
  assert.deepEqual(artifact.nodes[0].mcpServers, ["omk-project"]);
  assert.deepEqual(artifact.nodes[0].hooks, ["protect-secrets.sh"]);
});

test("native root loop slash handler emits structured results without console hijack", () => {
  const source = readFileSync(
    new URL("../src/commands/chat/native-root-loop.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /console\.log\s*=|console\.warn\s*=|console\.error\s*=/,
  );
  assert.match(source, /emitSlashResult\(normalized, ctx\.renderer\)/);
  assert.match(source, /printSlashResult\(normalized\)/);
  assert.match(source, /buildNativeChatSlashCommands\(\)/);
});
