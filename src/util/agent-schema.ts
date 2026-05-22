import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";

import YAML from "yaml";

export type AgentYamlIssueSeverity = "error" | "warning";

export interface AgentYamlIssue {
  severity: AgentYamlIssueSeverity;
  file: string;
  message: string;
  code?: string;
}

export interface AgentYamlValidationReport {
  ok: boolean;
  issues: AgentYamlIssue[];
  errors: AgentYamlIssue[];
  warnings: AgentYamlIssue[];
}

export interface AgentYamlRepairReport {
  changedFiles: string[];
  skipped: string[];
  convertedArgs: number;
}

export const CANONICAL_ROOT_SUBAGENT_ALIASES = [
  "explorer",
  "explore",
  "planner",
  "plan",
  "router",
  "architect",
  "coder",
  "reviewer",
  "security",
  "qa",
  "tester",
  "researcher",
  "integrator",
  "aggregator",
  "interviewer",
  "ontology",
  "vision-debugger",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function displayPath(root: string, filePath: string): string {
  const rel = relative(root, filePath).replace(/\\/g, "/");
  return rel && !rel.startsWith("..") ? rel : filePath;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function issue(
  issues: AgentYamlIssue[],
  root: string,
  filePath: string,
  message: string,
  code: string,
  severity: AgentYamlIssueSeverity = "error"
): void {
  issues.push({ severity, file: displayPath(root, filePath), message, code });
}

async function listProjectAgentYamlFiles(root: string): Promise<string[]> {
  const files = [
    join(root, ".omk", "agents", "okabe.yaml"),
    join(root, ".omk", "agents", "root.yaml"),
  ];
  const rolesDir = join(root, ".omk", "agents", "roles");
  try {
    const entries = await readdir(rolesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".yaml")) {
        files.push(join(rolesDir, entry.name));
      }
    }
  } catch {
    // Missing roles directory is reported elsewhere by scaffold checks.
  }
  return files;
}

async function projectAgentYamlState(root: string): Promise<{
  rootAgent: string;
  okabeAgent: string;
  agentsDir: string;
  rootExists: boolean;
  okabeExists: boolean;
  agentsDirExists: boolean;
}> {
  const agentsDir = join(root, ".omk", "agents");
  const rootAgent = join(agentsDir, "root.yaml");
  const okabeAgent = join(agentsDir, "okabe.yaml");
  const [rootExists, okabeExists] = await Promise.all([pathExists(rootAgent), pathExists(okabeAgent)]);
  let agentsDirExists = false;
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    agentsDirExists = entries.length >= 0;
  } catch {
    agentsDirExists = false;
  }
  return { rootAgent, okabeAgent, agentsDir, rootExists, okabeExists, agentsDirExists };
}

function resolveAgentPath(fromFile: string, rawPath: string): string {
  return isAbsolute(rawPath) ? rawPath : resolve(dirname(fromFile), rawPath);
}

function isCanonicalProjectRootAgent(root: string, filePath: string): boolean {
  return resolve(filePath) === resolve(root, ".omk", "agents", "root.yaml");
}

function shouldValidatePromptPath(filePath: string): boolean {
  return basename(filePath) === "root.yaml" || basename(filePath) === "chat-agent.yaml";
}

async function validateAgentYamlFileInternal(
  filePath: string,
  root: string,
  issues: AgentYamlIssue[],
  visited: Set<string>
): Promise<void> {
  const resolvedFile = resolve(filePath);
  if (visited.has(resolvedFile)) return;
  visited.add(resolvedFile);

  let raw = "";
  try {
    raw = await readFile(resolvedFile, "utf-8");
  } catch {
    issue(issues, root, resolvedFile, "agent YAML file is missing", "missing-agent-yaml");
    return;
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    issue(issues, root, resolvedFile, `invalid YAML: ${message}`, "invalid-yaml");
    return;
  }

  if (!isRecord(parsed)) {
    issue(issues, root, resolvedFile, "document must be a mapping", "document-not-mapping");
    return;
  }

  const agent = parsed.agent;
  if (!isRecord(agent)) {
    issue(issues, root, resolvedFile, "agent must be a mapping", "agent-not-mapping");
    return;
  }

  const extend = agent.extend;
  if (extend !== undefined) {
    if (typeof extend !== "string") {
      issue(issues, root, resolvedFile, "extend must be a string", "extend-not-string");
    } else if (extend.trim() && extend !== "default") {
      const extendedPath = resolveAgentPath(resolvedFile, extend);
      if (!(await pathExists(extendedPath))) {
        issue(issues, root, resolvedFile, `extend target is missing: ${extend}`, "missing-extend-target");
      } else {
        await validateAgentYamlFileInternal(extendedPath, root, issues, visited);
      }
    }
  }

  const promptPath = agent.system_prompt_path;
  if (promptPath !== undefined) {
    if (typeof promptPath !== "string") {
      issue(issues, root, resolvedFile, "system_prompt_path must be a string", "prompt-path-not-string");
    } else if (shouldValidatePromptPath(resolvedFile)) {
      const resolvedPrompt = resolveAgentPath(resolvedFile, promptPath);
      if (!(await pathExists(resolvedPrompt))) {
        issue(issues, root, resolvedFile, `system prompt is missing: ${promptPath}`, "missing-system-prompt");
      }
    }
  }

  const promptArgs = agent.system_prompt_args;
  if (promptArgs !== undefined) {
    if (!isRecord(promptArgs)) {
      issue(issues, root, resolvedFile, "system_prompt_args must be a mapping", "prompt-args-not-mapping");
    } else {
      for (const [key, value] of Object.entries(promptArgs)) {
        if (typeof value !== "string") {
          issue(
            issues,
            root,
            resolvedFile,
            `system_prompt_args.${key} must be a string (found ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value})`,
            "prompt-arg-not-string"
          );
        }
      }
    }
  }

  const subagents = agent.subagents;
  if (subagents === undefined && isCanonicalProjectRootAgent(root, resolvedFile)) {
    issue(
      issues,
      root,
      resolvedFile,
      `root subagents: missing canonical subagent aliases (${CANONICAL_ROOT_SUBAGENT_ALIASES.join(", ")})`,
      "missing-subagents"
    );
  }
  if (subagents !== undefined) {
    if (!isRecord(subagents)) {
      issue(issues, root, resolvedFile, "subagents must be a mapping", "subagents-not-mapping");
    } else {
      const canonicalRoleDir = join(root, ".omk", "agents", "roles");
      const enforceProjectRolePath = isCanonicalProjectRootAgent(root, resolvedFile);
      if (enforceProjectRolePath) {
        const missingAliases = CANONICAL_ROOT_SUBAGENT_ALIASES.filter((alias) =>
          !Object.prototype.hasOwnProperty.call(subagents, alias)
        );
        if (missingAliases.length > 0) {
          issue(
            issues,
            root,
            resolvedFile,
            `root subagents: missing canonical aliases (${missingAliases.join(", ")})`,
            "missing-canonical-subagent-aliases"
          );
        }
        for (const alias of missingAliases) {
            issue(
              issues,
              root,
              resolvedFile,
              `root subagent ${alias}: missing canonical alias`,
              "missing-canonical-subagent-alias"
            );
        }
      }
      for (const [alias, value] of Object.entries(subagents)) {
        if (!isRecord(value)) {
          issue(issues, root, resolvedFile, `root subagent ${alias}: entry must be a mapping`, "subagent-entry-not-mapping");
          continue;
        }
        const rawPath = value.path;
        if (typeof rawPath !== "string" || !rawPath.trim()) {
          issue(issues, root, resolvedFile, `root subagent ${alias}: path must be a string`, "subagent-path-not-string");
          continue;
        }
        const target = resolveAgentPath(resolvedFile, rawPath);
        if (extname(target) !== ".yaml") {
          issue(issues, root, resolvedFile, `root subagent ${alias}: path must reference a .yaml file`, "subagent-path-not-yaml");
          continue;
        }
        if (enforceProjectRolePath && !isInside(canonicalRoleDir, target)) {
          issue(issues, root, resolvedFile, `root subagent ${alias}: invalid role path ${rawPath}`, "subagent-path-outside-roles");
          continue;
        }
        if (!(await pathExists(target))) {
          const role = basename(target, extname(target));
          issue(issues, root, resolvedFile, `root subagent ${alias}: missing role agent ${role}`, "missing-subagent-role");
          continue;
        }
        await validateAgentYamlFileInternal(target, root, issues, visited);
      }
    }
  }
}

export async function validateAgentYamlFile(filePath: string, root = process.cwd()): Promise<AgentYamlValidationReport> {
  const issues: AgentYamlIssue[] = [];
  await validateAgentYamlFileInternal(filePath, root, issues, new Set<string>());
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  return { ok: errors.length === 0, issues, errors, warnings };
}

export async function validateProjectAgentYaml(root: string): Promise<AgentYamlValidationReport> {
  const issues: AgentYamlIssue[] = [];
  const state = await projectAgentYamlState(root);
  if (!state.rootExists && !state.okabeExists && !state.agentsDirExists) {
    issue(
      issues,
      root,
      state.agentsDir,
      "project agent YAML is not initialized; run omk init to generate agent files",
      "project-agents-not-initialized",
      "warning"
    );
    return { ok: true, issues, errors: [], warnings: issues };
  }
  const visited = new Set<string>();
  for (const filePath of await listProjectAgentYamlFiles(root)) {
    await validateAgentYamlFileInternal(filePath, root, issues, visited);
  }
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  return { ok: errors.length === 0, issues, errors, warnings };
}

export function formatAgentYamlIssue(issueItem: AgentYamlIssue): string {
  return `${issueItem.file}: ${issueItem.message}`;
}

export function formatAgentYamlIssues(report: AgentYamlValidationReport, limit = 5): string {
  const visible = report.issues.slice(0, limit).map(formatAgentYamlIssue);
  const suffix = report.issues.length > visible.length ? `; +${report.issues.length - visible.length} more` : "";
  return `${visible.join("; ")}${suffix}`;
}

function stringifyPromptArgScalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null) return "";
  return undefined;
}

export async function repairProjectAgentPromptArgStrings(root: string): Promise<AgentYamlRepairReport> {
  const changedFiles: string[] = [];
  const skipped: string[] = [];
  let convertedArgs = 0;

  for (const filePath of await listProjectAgentYamlFiles(root)) {
    let parsed: unknown;
    try {
      parsed = YAML.parse(await readFile(filePath, "utf-8"));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push(`${displayPath(root, filePath)}: invalid YAML (${message})`);
      continue;
    }
    if (!isRecord(parsed) || !isRecord(parsed.agent)) {
      skipped.push(`${displayPath(root, filePath)}: agent must be a mapping`);
      continue;
    }
    const promptArgs = parsed.agent.system_prompt_args;
    if (promptArgs === undefined) continue;
    if (!isRecord(promptArgs)) {
      skipped.push(`${displayPath(root, filePath)}: system_prompt_args must be a mapping`);
      continue;
    }

    let changed = false;
    for (const [key, value] of Object.entries(promptArgs)) {
      if (typeof value === "string") continue;
      const converted = stringifyPromptArgScalar(value);
      if (converted === undefined) {
        skipped.push(`${displayPath(root, filePath)}: system_prompt_args.${key} is not a scalar`);
        continue;
      }
      promptArgs[key] = converted;
      convertedArgs += 1;
      changed = true;
    }

    if (changed) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, YAML.stringify(parsed), "utf-8");
      changedFiles.push(displayPath(root, filePath));
    }
  }

  return { changedFiles, skipped, convertedArgs };
}
