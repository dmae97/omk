import test from "node:test";
import assert from "node:assert/strict";

// Avoid slow MCP package preflight in the /mcp render path.
process.env.OMK_MCP_PREFLIGHT = "off";

test("slash /help includes all new status commands", async () => {
  const busMod = await import("../dist/runtime/command-bus.js");
  const slashMod = await import("../dist/runtime/slash-commands.js");
  const bus = busMod.createCommandBus();
  slashMod.registerSlashCommands(bus, { provider: "kimi", model: "default" });

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/help" });

  assert.equal(result.handled, true, "/help should be handled");
  assert.ok(result.events.length > 0, "should emit events");
  assert.equal(result.events.at(-1).type, "result", "last event should be result");
  const payload = JSON.parse(result.output);
  assert.ok(Array.isArray(payload.commands), "help payload should list commands");
  for (const command of ["/mcp", "/provider", "/headroom", "/tools", "/memory", "/trace"]) {
    assert.ok(
      payload.commands.some((line) => line.startsWith(`${command} `)),
      `help should include ${command}`,
    );
  }
  assert.ok(typeof result.events.at(-1).data.content === "string", "should render content");
  assert.ok(result.events.at(-1).data.content.length > 0, "rendered content should be non-empty");
});

const statusCommands = ["/mcp", "/provider", "/headroom", "/tools", "/memory", "/trace"];

for (const text of statusCommands) {
  test(`slash ${text} dispatches status result and renders without throwing`, async () => {
    const busMod = await import("../dist/runtime/command-bus.js");
    const slashMod = await import("../dist/runtime/slash-commands.js");
    const bus = busMod.createCommandBus();
    slashMod.registerSlashCommands(bus, { provider: "kimi", model: "default" });

    const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: text });

    assert.equal(result.handled, true, `${text} should be handled`);
    assert.ok(result.events.length > 0, "should emit events");
    assert.equal(result.events.at(-1).type, "result", "last event should be result");
    const payload = JSON.parse(result.output);
    assert.equal(payload.kind ?? "status", "status", "payload should be a status result");
    assert.ok(typeof result.events.at(-1).data.content === "string", "should render content");
    assert.ok(result.events.at(-1).data.content.length > 0, "rendered content should be non-empty");
  });
}

test("slash /memory with query returns search results", async () => {
  const busMod = await import("../dist/runtime/command-bus.js");
  const slashMod = await import("../dist/runtime/slash-commands.js");
  const bus = busMod.createCommandBus();
  slashMod.registerSlashCommands(bus, { provider: "kimi", model: "default" });

  const result = await bus.dispatch({
    kind: "chat",
    source: "cli",
    rawText: "/memory project",
  });

  assert.equal(result.handled, true, "/memory query should be handled");
  const payload = JSON.parse(result.output);
  assert.equal(payload.command ?? "memory.show", "memory.show");
  assert.ok(typeof result.events.at(-1).data.content === "string");
});

test("slash /trace returns a list summary", async () => {
  const busMod = await import("../dist/runtime/command-bus.js");
  const slashMod = await import("../dist/runtime/slash-commands.js");
  const bus = busMod.createCommandBus();
  slashMod.registerSlashCommands(bus, { provider: "kimi", model: "default" });

  const result = await bus.dispatch({ kind: "chat", source: "cli", rawText: "/trace" });

  assert.equal(result.handled, true, "/trace should be handled");
  const payload = JSON.parse(result.output);
  assert.equal(payload.command ?? "trace.show", "trace.show");
  assert.ok(Array.isArray(payload.traces), "trace payload should include traces array");
  assert.ok(typeof result.events.at(-1).data.content === "string");
});
