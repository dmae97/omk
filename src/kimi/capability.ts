import { execSync } from "child_process";

export interface KimiCapabilityFlags {
  model: boolean;
  thinking: boolean;
  temperature: boolean;
  topP: boolean;
  variant: boolean;
  version: string | null;
  agentFile: boolean;
  webTools: boolean;
  swarmStatus: "available" | "unavailable" | "unknown";
}

let capabilityCache: KimiCapabilityFlags | undefined;

/**
 * Probe the installed Kimi CLI for supported flags by parsing --help output.
 * Results are cached for the process lifetime.
 */
export function getKimiCapabilities(): KimiCapabilityFlags {
  if (capabilityCache) return capabilityCache;

  let helpOutput = "";
  let versionOutput = "";

  try {
    helpOutput = execSync("kimi --help", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], timeout: 5000 });
  } catch {
    helpOutput = "";
  }

  try {
    versionOutput = execSync("kimi --version", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], timeout: 5000 });
  } catch {
    versionOutput = "";
  }

  const flags = parseKimiCapabilityFlags(helpOutput, versionOutput);
  capabilityCache = flags;
  return flags;
}

/**
 * Pure helper: parse capability flags from raw --help and --version strings.
 * Exported for unit testing without spawning the real CLI.
 */
export function parseKimiCapabilityFlags(helpOutput: string, versionOutput: string): KimiCapabilityFlags {
  return {
    model: /\s--model\s/.test(helpOutput) || /\s-m\s/.test(helpOutput),
    thinking: /\s--thinking\s/.test(helpOutput) || /\s--no-thinking\s/.test(helpOutput),
    temperature: /\s--temperature\b/.test(helpOutput),
    topP: /\s--top-p\b/.test(helpOutput) || /\s--top_p\b/.test(helpOutput),
    variant: /\s--variant\b/.test(helpOutput),
    version: parseKimiVersion(versionOutput) ?? parseKimiVersion(helpOutput),
    agentFile: /\s--agent-file\b/.test(helpOutput),
    webTools: /\sSearchWeb\b/.test(helpOutput) || /\sFetchURL\b/.test(helpOutput) || /\sweb search\b/i.test(helpOutput),
    swarmStatus: inferSwarmStatus(versionOutput, helpOutput),
  };
}

function inferSwarmStatus(versionOutput: string, helpOutput: string): "available" | "unavailable" | "unknown" {
  // Kimi K2.6 Agent Swarm is a platform capability, not a CLI flag.
  // We infer availability from version (>=1.1.0 heuristic) or help mentions.
  const version = parseKimiVersion(versionOutput) ?? parseKimiVersion(helpOutput);
  if (!version) return "unknown";
  const [major, minor] = version.split(".").map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(major) || Number.isNaN(minor)) return "unknown";
  // Conservative heuristic: swarm APIs stabilized around 1.1+
  if (major > 1 || (major === 1 && minor >= 1)) return "available";
  return "unavailable";
}

function parseKimiVersion(output: string): string | null {
  const m = output.match(/kimi,\s*version\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
  return m?.[1] ?? null;
}

/**
 * Reset cached capabilities (mainly for tests).
 */
export function resetKimiCapabilities(): void {
  capabilityCache = undefined;
}
