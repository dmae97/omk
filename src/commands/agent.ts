import { readdir, readFile, writeFile } from "fs/promises";

import YAML from "yaml";
import { getOmkPath, pathExists } from "../util/fs.js";
import { style, header, status, label, bullet } from "../util/theme.js";

const STABLE_AGENTS = new Set([
  "aggregator",
  "architect",
  "coder",
  "explorer",
  "integrator",
  "interviewer",
  "ontology",
  "planner",
  "qa",
  "researcher",
  "reviewer",
  "security",
  "tester",
  "vision-debugger",
]);
const CAPABILITY_FLAGS = ["OMK_MCP_ENABLED", "OMK_SKILLS_ENABLED", "OMK_HOOKS_ENABLED"] as const;

interface AgentMeta {
  id: string;
  name: string;
  role: string;
  extend?: string;
  description?: string;
  excludeTools?: string[];
  filePath: string;
  stable: boolean;
  mcpServers?: string[];
  skills?: string[];
  hooks?: string[];
}

async function loadAgentMeta(id: string): Promise<AgentMeta | null> {
  const filePath = getOmkPath(`agents/roles/${id}.yaml`);
  if (!(await pathExists(filePath))) return null;

  const content = await readFile(filePath, "utf-8");
  const doc = YAML.parse(content) as Record<string, unknown>;
  const agent = (doc?.agent ?? {}) as Record<string, unknown>;

  const promptArgs = (agent.system_prompt_args as Record<string, unknown> | undefined) ?? {};

  return {
    id,
    name: (agent.name as string | undefined) ?? id,
    role: (promptArgs.OMK_ROLE as string | undefined) ?? id,
    extend: agent.extend as string | undefined,
    description: (agent.description as string | undefined) ?? (agent.prompt as string | undefined)?.replace(/\s+/g, " ").slice(0, 200),
    excludeTools: agent.exclude_tools as string[] | undefined,
    filePath,
    stable: STABLE_AGENTS.has(id),
    mcpServers: parseTopFromHint(promptArgs.OMK_MCP_HINTS as string | undefined),
    skills: parseTopFromHint(promptArgs.OMK_SKILL_HINTS as string | undefined),
    hooks: parseTopFromHint(promptArgs.OMK_HOOK_HINTS as string | undefined),
  };
}

async function listAllAgents(): Promise<AgentMeta[]> {
  const rolesDir = getOmkPath("agents/roles");
  if (!(await pathExists(rolesDir))) return [];

  const entries = await readdir(rolesDir);
  const yamlFiles = entries
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));

  const agents = await Promise.all(yamlFiles.map(loadAgentMeta));
  return agents.filter((a): a is AgentMeta => a !== null).sort((a, b) => {
    if (a.stable === b.stable) return a.id.localeCompare(b.id);
    return a.stable ? -1 : 1;
  });
}

// ─── Commands ───

export async function agentListCommand(): Promise<void> {
  const agents = await listAllAgents();
  if (agents.length === 0) {
    console.log(status.warn("No agents found. Run omk init to scaffold agents."));
    return;
  }

  const stable = agents.filter((a) => a.stable);
  const experimental = agents.filter((a) => !a.stable);

  console.log(header("Agent Registry"));
  console.log(label("Total", String(agents.length)));
  console.log("");

  console.log(style.purpleBold("🟢 Stable Agents") + style.gray(" — recommended for production"));
  for (const a of stable) {
    console.log(`  ${style.mintBold(a.id.padEnd(14))} ${style.gray(a.name)}`);
  }
  console.log("");

  if (experimental.length > 0) {
    console.log(style.orangeBold("🟡 Experimental Agents") + style.gray(" — use with caution"));
    for (const a of experimental) {
      console.log(`  ${style.cream(a.id.padEnd(14))} ${style.gray(a.name)}`);
    }
    console.log("");
  }

  console.log(style.gray("  Tip: omk agent show <name> for details"));
}

export async function agentShowCommand(id: string): Promise<void> {
  const meta = await loadAgentMeta(id);
  if (!meta) {
    console.warn(status.warn(`Agent "${id}" not found.`));
    console.warn(style.gray(`  Run "omk agent list" to see available agents.`));
    return;
  }

  console.log(header(`Agent: ${meta.id}`));
  console.log(label("Name", meta.name));
  console.log(label("Role", meta.role));
  console.log(label("Stability", meta.stable ? style.mint("stable") : style.orange("experimental")));
  console.log(label("File", meta.filePath));
  if (meta.extend) {
    console.log(label("Extends", meta.extend));
  }
  if (meta.excludeTools && meta.excludeTools.length > 0) {
    console.log(label("Excluded tools", String(meta.excludeTools.length)));
    for (const tool of meta.excludeTools) {
      console.log(bullet(style.gray(tool)));
    }
  }
  console.log(label("MCP Servers", meta.mcpServers?.join(", ") ?? style.gray("default")));
  console.log(label("Skills", meta.skills?.join(", ") ?? style.gray("default")));
  console.log(label("Hooks", meta.hooks?.join(", ") ?? style.gray("default")));
  if (meta.description) {
    console.log("");
    console.log(style.gray(meta.description));
  }
}

export async function agentCreateCommand(name: string, options: { from?: string }): Promise<void> {
  const templateId = options.from ?? "coder";
  const templatePath = getOmkPath(`agents/roles/${templateId}.yaml`);
  const destPath = getOmkPath(`agents/roles/${name}.yaml`);

  if (await pathExists(destPath)) {
    console.warn(status.warn(`Agent "${name}" already exists.`));
    console.warn(style.gray(`  ${destPath}`));
    return;
  }

  if (!(await pathExists(templatePath))) {
    console.warn(status.warn(`Template "${templateId}" not found.`));
    console.warn(style.gray(`  Run "omk agent list" to see available agents.`));
    return;
  }

  const templateContent = await readFile(templatePath, "utf-8");
  const doc = YAML.parse(templateContent) as Record<string, unknown>;
  const agent = (doc?.agent ?? {}) as Record<string, unknown>;

  const newDoc = {
    version: (doc.version as number | undefined) ?? 1,
    agent: {
      ...agent,
      name: `omk-${name}`,
      system_prompt_args: {
        ...(agent.system_prompt_args as Record<string, unknown> | undefined),
        OMK_ROLE: name,
        OMK_MCP_ENABLED: "true",
        OMK_SKILLS_ENABLED: "true",
        OMK_HOOKS_ENABLED: "true",
      },
    },
  };

  await writeFile(destPath, YAML.stringify(newDoc));
  console.log(status.success(`Agent "${name}" created from template "${templateId}".`));
  console.log(style.gray(`  ${destPath}`));
}

export async function agentDoctorCommand(): Promise<void> {
  const agents = await listAllAgents();
  const issues: string[] = [];
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  const okabePath = getOmkPath("agents/okabe.yaml");
  const rootPath = getOmkPath("agents/root.yaml");
  let okabeHealthy = false;

  if (!(await pathExists(okabePath))) {
    issues.push("Missing Okabe base agent: .omk/agents/okabe.yaml");
  } else {
    const okabeContent = await readFile(okabePath, "utf-8");
    const okabeDoc = YAML.parse(okabeContent) as Record<string, unknown>;
    const okabeAgent = (okabeDoc?.agent ?? {}) as Record<string, unknown>;
    const okabeTools = Array.isArray(okabeAgent.tools) ? okabeAgent.tools.map(String) : [];
    okabeHealthy =
      okabeTools.some((tool) => tool.includes("kimi_cli.tools.agent:Agent")) &&
      okabeTools.some((tool) => tool.includes("kimi_cli.tools.dmail:SendDMail"));
    if (!okabeHealthy) {
      issues.push("okabe: missing required Agent/SendDMail tools");
    }
    for (const issue of missingCapabilityFlagIssues("okabe", okabeAgent)) {
      issues.push(issue);
    }
    // Note: hints are injected at runtime by scoped-agent-file.ts; skip for base agent
  }

  if (!(await pathExists(rootPath))) {
    issues.push("Missing root agent: .omk/agents/root.yaml");
  } else {
    const rootContent = await readFile(rootPath, "utf-8");
    const rootDoc = YAML.parse(rootContent) as Record<string, unknown>;
    const rootAgent = (rootDoc?.agent ?? {}) as Record<string, unknown>;
    if (String(rootAgent.extend ?? "") !== "./okabe.yaml") {
      issues.push("root: expected extend: ./okabe.yaml");
    }
    for (const issue of missingCapabilityFlagIssues("root", rootAgent)) {
      issues.push(issue);
    }
    // Note: hints are injected at runtime by scoped-agent-file.ts; skip for root agent
    const subagents = (rootAgent.subagents ?? {}) as Record<string, unknown>;
    for (const [alias, value] of Object.entries(subagents)) {
      const ref = value as Record<string, unknown>;
      const path = typeof ref.path === "string" ? ref.path : "";
      const match = path.match(/\.\/roles\/([^/]+)\.yaml$/);
      if (!match) {
        issues.push(`root subagent ${alias}: invalid role path ${path || "(missing)"}`);
        continue;
      }
      if (!agentsById.has(match[1])) {
        issues.push(`root subagent ${alias}: missing role agent ${match[1]}`);
      }
    }
  }

  for (const a of agents) {
    const content = await readFile(a.filePath, "utf-8");
    if (!content.includes("agent:")) {
      issues.push(`${a.id}: missing 'agent:' root key`);
    }
    if (!a.role) {
      issues.push(`${a.id}: missing OMK_ROLE in system_prompt_args`);
    }
    const doc = YAML.parse(content) as Record<string, unknown>;
    const agent = (doc?.agent ?? {}) as Record<string, unknown>;
    if (okabeHealthy && String(agent.extend ?? "") !== "../okabe.yaml") {
      issues.push(`${a.id}: expected extend: ../okabe.yaml`);
    }
    for (const issue of missingCapabilityFlagIssues(a.id, agent)) {
      issues.push(issue);
    }
    // Note: role agents do not have static hints; hints are injected at runtime
    // by scoped-agent-file.ts based on preset/skill assignment. Skip hint checks.
  }

  // Check for stable agents
  for (const id of STABLE_AGENTS) {
    if (!agents.some((a) => a.id === id)) {
      issues.push(`Missing stable agent: ${id}`);
    }
  }

  console.log(header("Agent Doctor"));
  console.log(label("Agents checked", String(agents.length)));

  if (issues.length === 0) {
    console.log("");
    console.log(status.success("All agents healthy."));
  } else {
    console.log("");
    console.log(status.warn(`${issues.length} issue(s) found:`));
    for (const issue of issues) {
      console.log(bullet(issue));
    }
  }
}

function missingCapabilityFlagIssues(id: string, agent: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const promptArgs = (agent.system_prompt_args ?? {}) as Record<string, unknown>;
  for (const flag of CAPABILITY_FLAGS) {
    if (String(promptArgs[flag]) !== "true") {
      issues.push(`${id}: missing ${flag}=true in system_prompt_args`);
    }
  }
  return issues;
}

function parseTopFromHint(hint: string | undefined): string[] | undefined {
  if (!hint) return undefined;
  const topMatch = hint.match(/top=([^;]*)/);
  if (!topMatch) return undefined;
  const top = topMatch[1].trim();
  if (!top) return undefined;
  return top.split("|").filter(Boolean);
}
