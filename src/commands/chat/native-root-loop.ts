import type { TaskRunner } from "../../contracts/orchestration.js";
import type { RuntimeBootstrap } from "../../runtime/runtime-bootstrap.js";
import type { ChatLayout } from "./utils.js";
import { style } from "../../util/theme.js";
import { runShell } from "../../util/shell.js";
import type { DagNode } from "../../orchestration/dag.js";
import { applyCapabilityInjectionToRouting, buildCapabilityInjection } from "../../runtime/capability-injection.js";
import { buildPromptEnvelope, renderPromptEnvelope } from "../../runtime/prompt-envelope.js";

export interface NativeRootLoopInput {
  bootstrap: RuntimeBootstrap;
  taskRunner: TaskRunner;
  runId: string;
  root: string;
  env: Record<string, string>;
  layout: ChatLayout;
  agentFile: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  onData?: (data: string) => void;
  onTodoSync?: (output: string) => void;
}

interface SlashCommand {
  name: string;
  aliases: string[];
  help: string;
  handler: (args: string) => void | Promise<void>;
}

function buildSlashCommands(input: NativeRootLoopInput): SlashCommand[] {
  const b = input.bootstrap;
  return [
    { name: "/exit", aliases: ["/quit", ":q"], help: "Exit chat session", handler: () => {} },
    { name: "/help", aliases: ["/h", "/?"], help: "Show this help", handler: () => {
      console.log(style.phosphorBold("\n  Slash Commands:"));
      console.log(style.phosphorDim("  ─────────────────────────────────────────────"));
      console.log(`  ${style.phosphor("/exit")} ${style.phosphorDim("/quit :q")}   — Exit chat session`);
      console.log(`  ${style.phosphor("/help")} ${style.phosphorDim("/h /?")}     — Show this help`);
      console.log(`  ${style.phosphor("/auth")}                — Show provider auth status`);
      console.log(`  ${style.phosphor("/provider")} ${style.phosphorDim("<name>")}  — Switch provider (kimi/codex/deepseek)`);
      console.log(`  ${style.phosphor("/model")} ${style.phosphorDim("<name>")}    — Set model`);
      console.log(`  ${style.phosphor("/status")}              — Show session status`);
      console.log(`  ${style.phosphor("/clear")} ${style.phosphorDim("/cls")}    — Clear screen`);
      console.log(`  ${style.phosphor("/runs")}                — List recent runs`);
      console.log(`  ${style.phosphor("/doctor")}              — Run omk doctor`);
      console.log(`  ${style.phosphor("/parallel")} ${style.phosphorDim("<prompt>")} — Run parallel orchestrator`);
      console.log(style.phosphorDim("  ─────────────────────────────────────────────\n"));
    }},
    { name: "/auth", aliases: ["/login"], help: "Show auth status", handler: () => {
      console.log(style.phosphorBold(`\n  Provider: ${b.provider}`));
      console.log(`  Model: ${style.phosphor(b.selectedModel ?? "auto")}`);
      console.log(`  Session: ${style.phosphorDim(b.sessionMode)}`);
      console.log(`  Runtime: ${style.phosphorDim(b.selectedRuntimeId ?? "none")}`);
      console.log(`  Auth OK: ${b.authOk ? style.green("✓") : style.metricsRed("✗")}\n`);
    }},
    { name: "/provider", aliases: ["/p"], help: "Switch provider", handler: (args) => {
      const p = args.trim().toLowerCase();
      const valid = ["kimi", "codex", "deepseek", "commandcode", "opencode", "auto"];
      if (p && valid.includes(p)) {
        console.log(style.phosphor(`\n  Switching provider to '${p}'... Restart chat to apply.\n`));
        console.log(style.phosphorDim(`  omk chat --provider ${p}`));
      } else {
        console.log(style.phosphorDim(`\n  Available: ${valid.join(", ")}`));
        console.log(style.phosphorDim("  Usage: /provider codex\n"));
      }
    }},
    { name: "/model", aliases: ["/m"], help: "Set model", handler: (args) => {
      const m = args.trim();
      if (m) {
        console.log(style.phosphor(`\n  Model set to '${m}' for next turns.\n`));
      } else {
        console.log(style.phosphorDim(`\n  Current model: ${b.selectedModel ?? "auto"}`));
        console.log(style.phosphorDim("  Usage: /model deepseek-chat\n"));
      }
    }},
    { name: "/status", aliases: ["/s"], help: "Show session status", handler: () => {
      const uptime = process.uptime();
      const mem = process.memoryUsage();
      console.log(style.phosphorBold(`\n  Session: ${input.runId}`));
      console.log(`  Provider: ${style.phosphor(b.provider)} | Model: ${style.phosphorDim(b.selectedModel ?? "auto")}`);
      console.log(`  Uptime: ${style.phosphorDim(Math.floor(uptime / 60) + "m " + Math.floor(uptime % 60) + "s")}`);
      console.log(`  Heap: ${style.phosphorDim((mem.heapUsed / 1024 / 1024).toFixed(1) + "M")} / ${style.phosphorDim((mem.heapTotal / 1024 / 1024).toFixed(1) + "M")}`);
      console.log(`  Layout: ${style.phosphorDim(input.layout)} | Root: ${style.phosphorDim(input.root)}\n`);
    }},
    { name: "/clear", aliases: ["/cls"], help: "Clear screen", handler: () => {
      process.stdout.write("\x1b[2J\x1b[H");
    }},
    { name: "/runs", aliases: ["/history"], help: "List recent runs", handler: async () => {
      try {
        const { readdir } = await import("fs/promises");
        const { join } = await import("path");
        const runsDir = join(input.root, ".omk", "runs");
        const entries = await readdir(runsDir, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const recent = dirs.filter((d) => d.startsWith("chat-")).sort().reverse().slice(0, 10);
        console.log(style.phosphorBold("\n  Recent Chats:"));
        for (const r of recent) {
          console.log(style.phosphorDim(`    • ${r}`));
        }
        if (recent.length === 0) console.log(style.phosphorDim("    (none)"));
        console.log("");
      } catch {
        console.log(style.phosphorDim("\n  No runs found.\n"));
      }
    }},
    { name: "/doctor", aliases: [], help: "Run omk doctor", handler: async () => {
      console.log(style.phosphorDim("\n  Running doctor...\n"));
      try {
        const { execSync } = await import("child_process");
        const output = execSync("node dist/cli.js doctor --json", {
          cwd: input.root, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 30000,
        });
        console.log(output.slice(0, 2000));
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : String(err);
        console.log(style.metricsRed(`Doctor failed: ${m}`));
      }
    }},
    { name: "/parallel", aliases: ["/pa"], help: "Run parallel orchestrator with prompt", handler: async (args) => {
      const prompt = args.trim();
      if (!prompt) {
        console.log(style.phosphorDim("\n  Usage: /parallel <prompt>\n"));
        return;
      }
      console.log(style.phosphorDim(`\n  Spawning parallel: "${prompt}"\n`));
      const result = await runShell("node", ["dist/cli.js", "parallel", prompt], {
        cwd: input.root,
        env: input.env,
        stdio: "inherit",
        timeout: 300000,
      });
      if (result.failed) {
        console.log(style.metricsRed(`Parallel exited with code ${result.exitCode}`));
      }
    }},
  ];
}

export function buildNativeRootLoopTurnNode(input: {
  bootstrap: RuntimeBootstrap;
  prompt: string;
  nodeId?: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
}): DagNode {
  const id = input.nodeId ?? `turn-${Date.now()}`;
  const capabilityInjection = buildCapabilityInjection({
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
  });
  const envelope = buildPromptEnvelope({
    bootstrap: input.bootstrap,
    prompt: input.prompt,
    capabilities: capabilityInjection,
    role: "root-coordinator",
    nodeId: id,
  });
  return {
    id,
    name: renderPromptEnvelope(envelope),
    role: "coordinator",
    dependsOn: [],
    status: "running",
    retries: 0,
    maxRetries: 1,
    routing: applyCapabilityInjectionToRouting({
      provider: input.bootstrap.provider,
      providerModel: input.bootstrap.selectedModel,
      providerReason: `native-root-loop selected ${input.bootstrap.selectedRuntimeId ?? input.bootstrap.sessionMode}`,
      assignedProviderCapabilities: ["write", "shell"],
      contextBudget: "normal",
      readOnly: false,
      rationale: "native-root-loop turn; OMK retains root orchestration and passes scoped MCP/skills/hooks metadata to the selected runtime",
    }, capabilityInjection),
  };
}

export async function runNativeOmkRootLoop(input: NativeRootLoopInput): Promise<number> {
  const { bootstrap, taskRunner, layout, onData } = input;
  const turnTimeoutMs = Number.parseInt(input.env.OMK_TURN_TIMEOUT_MS ?? "120000", 10);
  const safeTurnTimeoutMs = Number.isFinite(turnTimeoutMs) && turnTimeoutMs > 0 ? turnTimeoutMs : 120_000;
  const commands = buildSlashCommands(input);

  if (layout !== "plain") {
    console.log(style.phosphor("Entering interactive mode. Type /help for commands.\n"));
  }

  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let running = true;
  process.once("SIGINT", () => { running = false; rl.close(); });

  while (running) {
    const userInput = await new Promise<string>((resolve) => {
      rl.question(style.phosphorDim("omk> "), resolve);
    });

    const line = userInput.trim();
    if (!line) continue;

    if (["exit", "quit", ":q", "/exit", "/quit"].includes(line.toLowerCase())) {
      running = false;
      break;
    }

    if (line.startsWith("/") || line.startsWith(":")) {
      const spaceIdx = line.indexOf(" ");
      const cmd = spaceIdx > 0 ? line.slice(0, spaceIdx) : line;
      const args = spaceIdx > 0 ? line.slice(spaceIdx + 1) : "";
      const handler = commands.find((c) => c.name === cmd || c.aliases.includes(cmd));

      if (handler) {
        if (handler.name === "/exit") {
          running = false;
          break;
        }
        try {
          await handler.handler(args);
        } catch (err: unknown) {
          const m = err instanceof Error ? err.message : String(err);
          console.error(style.metricsRed(`Command error: ${m}`));
        }
        continue;
      }
      console.log(style.phosphorDim(`Unknown command: ${cmd}. Type /help for commands.`));
      continue;
    }

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), safeTurnTimeoutMs);

    try {
      const node = buildNativeRootLoopTurnNode({
        bootstrap,
        prompt: line,
        mcpAllowlist: input.mcpAllowlist,
        skillNames: input.skillNames,
        hookNames: input.hookNames,
      });

      const result = await taskRunner.run(node, input.env, abort.signal);

      if (result.stdout) {
        process.stdout.write(result.stdout + "\n");
        onData?.(result.stdout);
      }
      if (result.stderr && result.exitCode !== 0) {
        process.stderr.write(style.metricsRed(result.stderr) + "\n");
      }
      if (input.onTodoSync && result.stdout) {
        input.onTodoSync(result.stdout);
      }
    } catch (err) {
      const msg = abort.signal.aborted
        ? `Turn timed out after ${safeTurnTimeoutMs}ms`
        : err instanceof Error
        ? err.message
        : String(err);
      console.error(style.metricsRed(`Error: ${msg}`));
    } finally {
      clearTimeout(timeout);
    }
  }

  rl.close();
  console.log(style.phosphorDim("\nSession ended."));
  return 0;
}
