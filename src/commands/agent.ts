import { readdir, readFile, writeFile } from "fs/promises";

import YAML from "yaml";
import { getOmkPath, pathExists } from "../util/fs.js";
import { style, header, status, label, bullet } from "../util/theme.js";

const STABLE_AGENTS = new Set(["explorer", "planner", "coder", "reviewer", "qa", "security"]);

interface AgentMeta {
  id: string;
  name: string;
  role: string;
  extend?: string;
  description?: string;
  excludeTools?: string[];
  filePath: string;
  stable: boolean;
}

async function loadAgentMeta(id: string): Promise<AgentMeta | null> {
  const filePath = getOmkPath(`agents/roles/${id}.yaml`);
  if (!(await pathExists(filePath))) return null;

  const content = await readFile(filePath, "utf-8");
  const doc = YAML.parse(content) as Record<string, unknown>;
  const agent = (doc?.agent ?? {}) as Record<string, unknown>;

  return {
    id,
    name: (agent.name as string | undefined) ?? id,
    role: ((agent.system_prompt_args as Record<string, unknown> | undefined)?.OMK_ROLE as string | undefined) ?? id,
    extend: agent.extend as string | undefined,
    description: (agent.description as string | undefined) ?? (agent.prompt as string | undefined)?.replace(/\s+/g, " ").slice(0, 200),
    excludeTools: agent.exclude_tools as string[] | undefined,
    filePath,
    stable: STABLE_AGENTS.has(id),
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
      console.log(`  ${bullet} ${style.gray(tool)}`);
    }
  }
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

  for (const a of agents) {
    const content = await readFile(a.filePath, "utf-8");
    if (!content.includes("agent:")) {
      issues.push(`${a.id}: missing 'agent:' root key`);
    }
    if (!a.role) {
      issues.push(`${a.id}: missing OMK_ROLE in system_prompt_args`);
    }
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
      console.log(`  ${bullet} ${issue}`);
    }
  }
}
