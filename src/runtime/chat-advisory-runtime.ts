import type { AgentRuntime, AgentRunResult } from "./agent-runtime.js";
import type { ContextCapsule } from "./context-capsule.js";
import { execSync } from "child_process";

export function createChatAdvisoryRuntime(): AgentRuntime {
  return {
    id: "omk-advisory",
    priority: 0,
    supports: () => true,
    async runNode(_capsule: ContextCapsule, _signal: AbortSignal): Promise<AgentRunResult> {
      const available: string[] = [];
      try { execSync("which codex", { stdio: "ignore" }); available.push("codex"); } catch {}
      try { execSync("which opencode", { stdio: "ignore" }); available.push("opencode"); } catch {}
      try { execSync("which commandcode", { stdio: "ignore" }); available.push("commandcode"); } catch {}
      if (process.env.DEEPSEEK_API_KEY) available.push("deepseek");

      const sep = "\n" + "─".repeat(60) + "\n";
      const msg = [
        sep,
        "⚠  No AI runtime adapter detected.",
        "",
        "OMK started in advisory mode. To enable interactive coding:",
        "",
        "  1. Install a CLI runtime:",
        "     • npm install -g @openai/codex",
        "     • npm install -g @anthropic-ai/kimi-code",
        "     • cargo install opencode",
        "",
        "  2. Or set an API key:",
        "     • export DEEPSEEK_API_KEY=\"sk-...\"",
        "",
        "  3. Then restart: omk chat --provider auto",
        "",
        available.length > 0
          ? `Detected: ${available.join(", ")}`
          : "No runtimes detected. Install one of the above.",
        sep,
      ].join("\n");

      return { success: true, stdout: msg, stderr: "" };
    },
  };
}
