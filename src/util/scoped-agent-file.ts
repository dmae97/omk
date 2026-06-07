import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "path";

import { createHash } from "crypto";

import YAML from "yaml";

import { getOmkResourceSettings, type OmkRuntimeScope } from "./resource-profile.js";

export interface AgentCapabilityScopes {
  mcpScope: OmkRuntimeScope;
  skillsScope: OmkRuntimeScope;
  hooksScope: OmkRuntimeScope;
  mcpNames?: string[];
  skillNames?: string[];
  hookNames?: string[];
  toolNames?: string[];
  reasoningVariant?: string;
}

export interface ScopedSubagentRef {
  alias: string;
  path: string;
  description?: string;
}

export interface ScopedAgentFileOptions {
  baseAgentFile: string;
  outputFile: string;
  role: string;
  name?: string;
  resources?: AgentCapabilityScopes;
  systemPromptPath?: string;
  subagents?: ScopedSubagentRef[];
}

export const OMK_AGENT_CAPABILITY_FLAGS = [
  "OMK_MCP_ENABLED",
  "OMK_SKILLS_ENABLED",
  "OMK_HOOKS_ENABLED",
] as const;

export function capabilityFlagValue(scope: OmkRuntimeScope): "true" | "false" {
  return scope === "none" ? "false" : "true";
}

function scopedCapabilityEnabled(scope: OmkRuntimeScope, names: string[] | undefined): "true" | "false" {
  return scope !== "none" || normalizeHintValues(names ?? []).length > 0 ? "true" : "false";
}

export async function resolveAgentCapabilityScopes(
  resources?: AgentCapabilityScopes
): Promise<AgentCapabilityScopes> {
  if (resources) return resources;
  const settings = await getOmkResourceSettings();
  return {
    mcpScope: settings.mcpScope,
    skillsScope: settings.skillsScope,
    hooksScope: settings.hooksScope,
  };
}

export function sanitizeAgentFilePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

export function defaultScopedRoleAgentFile(root: string, runId: string | undefined, role: string, nodeId?: string): string {
  const suffix = nodeId ? `-${sanitizeAgentFilePart(nodeId)}` : "";
  return join(root, ".omk", "runs", sanitizeAgentFilePart(runId ?? `runtime-${process.pid}`), "agents", "roles", `${sanitizeAgentFilePart(role)}${suffix}.yaml`);
}

export async function readBaseAgentExcludeTools(baseAgentFile: string): Promise<string[]> {
  const raw = await readFile(baseAgentFile, "utf-8");
  const doc = YAML.parse(raw) as Record<string, unknown>;
  const agent = (doc?.agent ?? {}) as Record<string, unknown>;
  const excludeTools = (agent.exclude_tools ?? []) as string[];
  return Array.isArray(excludeTools) ? excludeTools : [];
}

export function yamlRelativePath(fromFile: string, toFile: string): string {
  const rel = relative(dirname(fromFile), toFile).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function renderScopedAgentYaml(options: {
  baseAgentFile: string;
  outputFile: string;
  role: string;
  name?: string;
  resources: AgentCapabilityScopes;
  systemPromptPath?: string;
  subagents?: ScopedSubagentRef[];
  excludeTools?: string[];
}): string {
  const lines = [
    "version: 1",
    "agent:",
    `  extend: ${JSON.stringify(yamlRelativePath(options.outputFile, options.baseAgentFile))}`,
    `  name: ${JSON.stringify(options.name ?? `omk-${options.role}`)}`,
  ];
  if (options.systemPromptPath) {
    lines.push(`  system_prompt_path: ${JSON.stringify(options.systemPromptPath)}`);
  }
  lines.push(
    "  system_prompt_args:",
    `    OMK_ROLE: ${JSON.stringify(options.role)}`,
    `    OMK_MCP_ENABLED: "${scopedCapabilityEnabled(options.resources.mcpScope, options.resources.mcpNames)}"`,
    `    OMK_SKILLS_ENABLED: "${scopedCapabilityEnabled(options.resources.skillsScope, options.resources.skillNames)}"`,
    `    OMK_HOOKS_ENABLED: "${scopedCapabilityEnabled(options.resources.hooksScope, options.resources.hookNames)}"`,
    `    OMK_MCP_HINTS: ${JSON.stringify(renderCapabilityHint(options.resources.mcpNames ?? [], options.resources.mcpScope))}`,
    `    OMK_SKILL_HINTS: ${JSON.stringify(renderCapabilityHint(options.resources.skillNames ?? [], options.resources.skillsScope))}`,
    `    OMK_TOOL_HINTS: ${JSON.stringify(renderCapabilityHint(options.resources.toolNames ?? [], "project"))}`,
    `    OMK_HOOK_HINTS: ${JSON.stringify(renderCapabilityHint(options.resources.hookNames ?? [], options.resources.hooksScope))}`,
    `    OMK_CONTEXT_BUDGET: "small"`,
    `    OMK_REASONING_VARIANT: ${JSON.stringify(options.resources.reasoningVariant ?? "balanced-medium")}`,
    `    OMK_ROUTE_READ_ONLY: "false"`
  );
  if (options.excludeTools?.length) {
    lines.push("  exclude_tools:");
    for (const tool of options.excludeTools) {
      lines.push(`    - ${JSON.stringify(tool)}`);
    }
  }
  if (options.subagents?.length) {
    lines.push("  subagents:");
    for (const subagent of options.subagents) {
      lines.push(`    ${subagent.alias}:`);
      lines.push(`      path: ${JSON.stringify(subagent.path)}`);
      if (subagent.description) {
        lines.push(`      description: ${JSON.stringify(subagent.description)}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}


function renderCapabilityHint(values: string[], scope: OmkRuntimeScope): string {
  const normalized = normalizeHintValues(values);
  if (scope === "none" && normalized.length === 0) return "disabled";
  if (normalized.length === 0) return "count=0;digest=000000000000";
  return `count=${normalized.length};digest=${hintDigest(normalized)};top=${normalized.slice(0, 3).join("|")}`;
}

function normalizeHintValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean).map((value) => value.slice(0, 120)))].sort();
}

function hintDigest(values: string[]): string {
  return createHash("sha256").update(values.join("\n")).digest("hex").slice(0, 12);
}

export async function writeScopedAgentFile(options: ScopedAgentFileOptions): Promise<string> {
  const resources = await resolveAgentCapabilityScopes(options.resources);
  const excludeTools = await readBaseAgentExcludeTools(options.baseAgentFile);
  await mkdir(dirname(options.outputFile), { recursive: true });
  await writeFile(options.outputFile, renderScopedAgentYaml({ ...options, resources, excludeTools }), "utf-8");
  return options.outputFile;
}

export async function readRootAgentSubagents(baseAgentFile: string): Promise<Array<ScopedSubagentRef & { baseAgentFile: string; role: string }>> {
  const raw = await readFile(baseAgentFile, "utf-8");
  const doc = YAML.parse(raw) as Record<string, unknown>;
  const agent = (doc?.agent ?? {}) as Record<string, unknown>;
  const subagents = (agent.subagents ?? {}) as Record<string, unknown>;
  const refs: Array<ScopedSubagentRef & { baseAgentFile: string; role: string }> = [];
  for (const [alias, value] of Object.entries(subagents)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const rawPath = typeof entry.path === "string" ? entry.path : undefined;
    if (!rawPath) continue;
    const absolute = resolve(dirname(baseAgentFile), rawPath);
    const extension = extname(absolute);
    const role = basename(absolute, extension);
    refs.push({
      alias,
      path: rawPath,
      description: typeof entry.description === "string" ? entry.description : undefined,
      baseAgentFile: absolute,
      role,
    });
  }
  return refs;
}
