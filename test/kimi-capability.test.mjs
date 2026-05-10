import { test } from "node:test";
import assert from "node:assert";
import { parseKimiCapabilityFlags } from "../dist/kimi/capability.js";

test("parseKimiCapabilityFlags detects no sampling flags in v1.40.0 help", () => {
  const help = `
 Usage: kimi [OPTIONS] COMMAND [ARGS]...
 --model           -m                      TEXT
 --thinking               --no-thinking
 --help            -h
`;
  const caps = parseKimiCapabilityFlags(help, "kimi, version 1.40.0");
  assert.strictEqual(caps.model, true);
  assert.strictEqual(caps.thinking, true);
  assert.strictEqual(caps.temperature, false);
  assert.strictEqual(caps.topP, false);
  assert.strictEqual(caps.variant, false);
  assert.strictEqual(caps.version, "1.40.0");
  assert.strictEqual(caps.agentFile, false);
  assert.strictEqual(caps.webTools, false);
  assert.strictEqual(caps.swarmStatus, "available");
});

test("parseKimiCapabilityFlags detects extended flags when present", () => {
  const help = `
 --model           -m                      TEXT
 --thinking               --no-thinking
 --temperature                           FLOAT
 --top-p                                 FLOAT
 --variant                               TEXT
`;
  const caps = parseKimiCapabilityFlags(help, "");
  assert.strictEqual(caps.model, true);
  assert.strictEqual(caps.thinking, true);
  assert.strictEqual(caps.temperature, true);
  assert.strictEqual(caps.topP, true);
  assert.strictEqual(caps.variant, true);
  assert.strictEqual(caps.version, null);
  assert.strictEqual(caps.agentFile, false);
  assert.strictEqual(caps.webTools, false);
  assert.strictEqual(caps.swarmStatus, "unknown");
});

test("parseKimiCapabilityFlags does not treat the web subcommand as SearchWeb availability", () => {
  const help = `
 Commands:
   web      Run Kimi Code CLI web interface.
`;
  const caps = parseKimiCapabilityFlags(help, "kimi, version 1.41.0");
  assert.strictEqual(caps.webTools, false);
});

test("parseKimiCapabilityFlags extracts version from help fallback", () => {
  const caps = parseKimiCapabilityFlags("", "kimi, version 2.0.0");
  assert.strictEqual(caps.version, "2.0.0");
  assert.strictEqual(caps.agentFile, false);
  assert.strictEqual(caps.webTools, false);
  assert.strictEqual(caps.swarmStatus, "available");
});

test("parseKimiCapabilityFlags handles missing CLI gracefully", () => {
  const caps = parseKimiCapabilityFlags("", "");
  assert.strictEqual(caps.model, false);
  assert.strictEqual(caps.thinking, false);
  assert.strictEqual(caps.temperature, false);
  assert.strictEqual(caps.topP, false);
  assert.strictEqual(caps.variant, false);
  assert.strictEqual(caps.version, null);
  assert.strictEqual(caps.agentFile, false);
  assert.strictEqual(caps.webTools, false);
  assert.strictEqual(caps.swarmStatus, "unknown");
});
