import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIST_ROOT = join(process.cwd(), "dist", "cli", "root.js");
const DIST_CHAT_UTILS = join(process.cwd(), "dist", "commands", "chat", "utils.js");
const DIST_CHAT_CORE = join(process.cwd(), "dist", "commands", "chat", "core.js");
const DIST_FS = join(process.cwd(), "dist", "util", "fs.js");
const DIST_PROVIDER_TASK_RUNNER = join(process.cwd(), "dist", "providers", "provider-task-runner.js");
const { buildRootChatLaunchArgs } = await import("../dist/cli/root.js");
function sliceFunction(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}


describe("root chat launch args", () => {
  it("enters chat through the neon-grid UI when launched from bare omk", () => {
    const args = buildRootChatLaunchArgs({
      cliPath: "/usr/bin/omk",
      runId: "run-entry",
      workers: "4",
      mode: "agent",
    });

    assert.deepEqual(args, [
      "/usr/bin/omk",
      "chat",
      "--layout",
      "auto",
      "--brand",
      "neon-grid",
      "--ui",
      "neon-grid",
      "--run-id",
      "run-entry",
      "--workers",
      "4",
      "--mode",
      "agent",
      "--execution",
      "ask",
    ]);
  });

  it("keeps chat-only mode outside the execution ask policy", () => {
    const args = buildRootChatLaunchArgs({
      cliPath: "/usr/bin/omk",
      mode: "chat",
    });

    assert.deepEqual(args, [
      "/usr/bin/omk",
      "chat",
      "--layout",
      "auto",
      "--brand",
      "neon-grid",
      "--ui",
      "neon-grid",
      "--mode",
      "chat",
    ]);
  });
});
describe("omk with no arguments", () => {
  it("does not embed the legacy non-TTY dashboard or suggestion branch", () => {
    const rootSource = readFileSync(DIST_ROOT, "utf-8");

    assert.doesNotMatch(rootSource, /renderHudDashboard/);
    assert.doesNotMatch(rootSource, /runMcpAutoConnect/);
    assert.doesNotMatch(rootSource, /MCP Tool Plane/);
    assert.doesNotMatch(rootSource, /Run the parallel subagent orchestrator/);
    assert.doesNotMatch(rootSource, /promptModeCycle/);
    assert.doesNotMatch(rootSource, /@inquirer\/prompts/);
    assert.doesNotMatch(rootSource, /suggestionChat/);
    assert.doesNotMatch(rootSource, /suggestionHud/);
    assert.match(rootSource, /OMK_ENTRY_SURFACE/);
    assert.doesNotMatch(rootSource, /OMK_MCP_SCOPE/);
    assert.doesNotMatch(rootSource, /OMK_SKILLS_SCOPE/);
    assert.doesNotMatch(rootSource, /OMK_HOOKS_SCOPE/);
    const chatCoreSource = readFileSync(DIST_CHAT_CORE, "utf-8");
    assert.match(chatCoreSource, /OMK_ENTRY_SURFACE/);
    assert.match(chatCoreSource, /!isPiOmkEntry/);
  });
  it("keeps root runtime discovery on OMK and portable agent paths", () => {
    const chatUtilsSource = readFileSync(DIST_CHAT_UTILS, "utf-8");
    const fsSource = readFileSync(DIST_FS, "utf-8");

    const activeSkillNamesSource = sliceFunction(chatUtilsSource, "export async function getActiveSkillNames", "export async function getActiveHookNames");
    const collectMcpSource = sliceFunction(fsSource, "export async function collectMcpConfigs", "async function readMcpServersForRuntime");

    assert.match(activeSkillNamesSource, /\.agents/);
    assert.doesNotMatch(activeSkillNamesSource, /\.kimi/);
    assert.match(collectMcpSource, /\.omk/);
    assert.doesNotMatch(collectMcpSource, /\.kimi/);

    const providerRunnerSource = readFileSync(DIST_PROVIDER_TASK_RUNNER, "utf-8");
    assert.equal(providerRunnerSource.includes("../kimi/runner"), false);
    assert.match(providerRunnerSource, /kimi-provider-failure/);
  });

  it("keeps bare omk routed into the OMK chat entry", () => {
    const args = buildRootChatLaunchArgs({
      cliPath: "/usr/bin/omk",
      mode: "agent",
    });

    assert.deepEqual(args, [
      "/usr/bin/omk",
      "chat",
      "--layout",
      "auto",
      "--brand",
      "neon-grid",
      "--ui",
      "neon-grid",
      "--mode",
      "agent",
      "--execution",
      "ask",
    ]);
  });
});
