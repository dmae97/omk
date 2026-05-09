import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChatAgentHarnessManifest,
  buildChatAgentModeContract,
  buildParallelAlgorithmInjection,
  prepareChatAgentModeAgent,
} from "../dist/util/chat-agent-mode.js";

test("chat agent mode contract captures mode and active runtime resources", () => {
  const contract = buildChatAgentModeContract({
    mode: "agent",
    runId: "chat-agent-test",
    resources: {
      workers: "3",
      maxStepsPerTurn: "12",
      resourceProfile: "standard",
      approvalPolicy: "interactive",
      providerPolicy: "auto",
      ensembleDefaultEnabled: true,
      mcpScope: "all",
      skillsScope: "all",
      hooksScope: "project",
      mcpNames: ["omk-project"],
      skillNames: ["omk-repo-explorer"],
      hookNames: ["subagent-stop-audit.sh"],
    },
  });

  assert.match(contract, /Mode: agent/);
  assert.match(contract, /Active MCP \(1\): omk-project/);
  assert.match(contract, /Active skills \(1\): omk-repo-explorer/);
  assert.match(contract, /Active hooks \(1\): subagent-stop-audit\.sh/);
  assert.match(contract, /Harness manifest: \.\/chat-agent-harness\.json/);
  assert.match(contract, /Treat every non-trivial user prompt as an orchestration request/);
  assert.match(contract, /delegate bounded subagents/);
  assert.match(contract, /Injected parallel DAG algorithm/);
  assert.match(contract, /bootstrap\(done\) -> root-coordinator -> model\/capability\/worker lanes -> review-merge -> quality\/security\/design gates/);
  assert.match(contract, /DeepSeek direct lanes are read-only/);
  assert.match(contract, /default command-pass gate is `npm run check`/);
  assert.match(contract, /workerCap=3/);
});

test("parallel algorithm injection mirrors the parallel DAG routing contract", () => {
  const injection = buildParallelAlgorithmInjection({
    workers: "9",
    maxStepsPerTurn: "20",
    resourceProfile: "standard",
    approvalPolicy: "interactive",
    providerPolicy: "auto",
    ensembleDefaultEnabled: true,
    mcpScope: "project",
    skillsScope: "project",
    hooksScope: "project",
    mcpNames: ["omk-project"],
    skillNames: ["omk-context-broker"],
    hookNames: ["routing-hints"],
  });

  assert.equal(injection.workerCap, 6);
  assert.match(injection.text, /Intent schema to infer before delegation: taskType, complexity, estimatedWorkers/);
  assert.match(injection.text, /Capability-agent routing: when workers>=2/);
  assert.match(injection.text, /spawn read-only Flash quick-decomposition and Pro critique lanes/);
  assert.match(injection.text, /review-merge depends on every model, capability, and worker lane/);
  assert.match(injection.text, /read `chat-agent-harness\.json` for the full MCP\/skills\/hooks inventory/);
});

test("chat agent harness manifest captures full inventory and safe worker limits", () => {
  const skills = Array.from({ length: 32 }, (_, index) => `skill-${index + 1}`);
  const manifest = buildChatAgentHarnessManifest({
    mode: "agent",
    runId: "chat-agent-harness",
    resources: {
      workers: "2abc",
      resourceProfile: "standard",
      approvalPolicy: "interactive",
      providerPolicy: "auto",
      ensembleDefaultEnabled: true,
      mcpScope: "all",
      skillsScope: "all",
      hooksScope: "all",
      mcpNames: ["omk-project", "omk-project"],
      skillNames: skills,
      hookNames: ["pre-shell-guard.sh"],
    },
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.resources.workerBudget, 1);
  assert.equal(manifest.resources.workerCap, 1);
  assert.deepEqual(manifest.resources.active.mcp, ["omk-project"]);
  assert.equal(manifest.resources.active.skills.length, 32);
  assert.equal(manifest.capabilityPolicy.useMcp, true);
  assert.equal(manifest.capabilityPolicy.useSkills, true);
  assert.equal(manifest.capabilityPolicy.useHooks, true);
  assert.ok(manifest.virtualDag.nodes.some((node) => node.id === "capability-skill-agent"));
  assert.ok(manifest.virtualDag.nodes.some((node) => node.id === "review-merge"));
});

test("prepareChatAgentModeAgent writes run-scoped wrapper agent and prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-chat-agent-mode-"));
  try {
    const agentDir = join(root, ".omk", "agents");
    const promptDir = join(root, ".omk", "prompts");
    await mkdir(agentDir, { recursive: true });
    await mkdir(promptDir, { recursive: true });

    const baseAgentFile = join(agentDir, "root.yaml");
    const basePromptPath = join(promptDir, "root.md");
    await writeFile(baseAgentFile, "version: 1\nagent:\n  name: root\n", "utf-8");
    await writeFile(basePromptPath, "# Base Root Prompt\n", "utf-8");

    const prepared = await prepareChatAgentModeAgent({
      root,
      runId: "chat-agent-run",
      baseAgentFile,
      basePromptPath,
      mode: "debugging",
      resources: {
        workers: "2",
        resourceProfile: "lite",
        approvalPolicy: "interactive",
        providerPolicy: "auto",
        ensembleDefaultEnabled: false,
        mcpScope: "project",
        skillsScope: "project",
        hooksScope: "project",
        mcpNames: [],
        skillNames: ["omk-test-debug-loop"],
        hookNames: [],
      },
    });

    assert.equal(prepared.agentFile, join(root, ".omk", "runs", "chat-agent-run", "chat-agent.yaml"));
    assert.equal(prepared.promptPath, join(root, ".omk", "runs", "chat-agent-run", "chat-agent-prompt.md"));
    assert.equal(prepared.contractPath, join(root, ".omk", "runs", "chat-agent-run", "chat-agent-contract.md"));
    assert.equal(prepared.harnessPath, join(root, ".omk", "runs", "chat-agent-run", "chat-agent-harness.json"));

    const yaml = await readFile(prepared.agentFile, "utf-8");
    assert.match(yaml, /extend: /);
    assert.match(yaml, /system_prompt_path: \.\/chat-agent-prompt\.md/);
    assert.match(yaml, /OMK_ROLE: "root-coordinator"/);

    const prompt = await readFile(prepared.promptPath, "utf-8");
    assert.match(prompt, /# Base Root Prompt/);
    assert.match(prompt, /# OMK Chat Agent Runtime Contract/);
    assert.match(prompt, /Mode: debugging/);
    assert.match(prompt, /Active skills \(1\): omk-test-debug-loop/);
    assert.match(prompt, /Injected parallel DAG algorithm/);
    assert.match(prompt, /profile=lite; approval=interactive; provider=auto; ensemble=disabled; workerCap=2/);

    const contract = await readFile(prepared.contractPath, "utf-8");
    assert.match(contract, /Debugging: reproduce or inspect the exact failing path/);

    const harness = JSON.parse(await readFile(prepared.harnessPath, "utf-8"));
    assert.equal(harness.schemaVersion, 1);
    assert.equal(harness.mode, "debugging");
    assert.deepEqual(harness.resources.active.skills, ["omk-test-debug-loop"]);
    assert.ok(harness.gates.includes("run npm run check before final implementation claims"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
