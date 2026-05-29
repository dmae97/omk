import test from "node:test";
import assert from "node:assert/strict";

const {
  parseSlashArgs,
  parseSlashInput,
  tokenizeSlashArgs,
} = await import("../dist/commands/chat/slash/parser.js");
const {
  SlashCommandRegistry,
  createSlashCommandRegistry,
} = await import("../dist/commands/chat/slash/registry.js");
const {
  errorSlashResult,
  okSlashResult,
} = await import("../dist/commands/chat/slash/result.js");

test("slash parser handles quoted args and flags without shell evaluation", () => {
  assert.deepEqual(tokenizeSlashArgs('"refactor harness tests" --json --limit=20 plain'), [
    "refactor harness tests",
    "--json",
    "--limit=20",
    "plain",
  ]);

  const parsed = parseSlashInput('/parallel "refactor harness tests" --json --tag=ui --tag=harness');
  assert.equal(parsed?.command, "/parallel");
  assert.equal(parsed?.args.raw, '"refactor harness tests" --json --tag=ui --tag=harness');
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
  assert.deepEqual(registry.list().map((spec) => spec.name), ["/theme"]);
});

test("slash registry rejects duplicate or non-command names", () => {
  assert.throws(() => new SlashCommandRegistry([
    { name: "theme", aliases: [], group: "ui", summary: "bad", usage: "theme", examples: [], handler: () => okSlashResult() },
  ]), /Invalid slash command name/);

  assert.throws(() => new SlashCommandRegistry([
    { name: "/theme", aliases: ["/th"], group: "ui", summary: "one", usage: "/theme", examples: [], handler: () => okSlashResult() },
    { name: "/other", aliases: ["/th"], group: "ui", summary: "two", usage: "/other", examples: [], handler: () => errorSlashResult("duplicate") },
  ]), /Duplicate slash command name/);
});
