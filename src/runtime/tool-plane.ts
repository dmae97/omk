import { readFile } from "fs/promises";

import { collectMcpConfigs, writeBuiltinMcpConfig, writeRuntimeMcpConfig } from "../util/fs.js";
import type { OmkRuntimeScope } from "../util/resource-profile.js";

export interface OmkToolPlaneManifest {
  readonly mcpServers: readonly string[];
  readonly mcpConfigFile?: string;
  readonly skills: readonly string[];
  readonly hooks: readonly string[];
  readonly tools: readonly string[];
  readonly runtimeOwnsMcp: false;
  readonly requiresRuntimeMcp: boolean;
}

export interface BuildOmkToolPlaneManifestInput {
  readonly mcpScope: OmkRuntimeScope;
  readonly mcpAllowlist?: readonly string[];
  readonly skills?: readonly string[];
  readonly hooks?: readonly string[];
  readonly tools?: readonly string[];
  readonly requiresRuntimeMcp?: boolean;
}

export async function buildOmkToolPlaneManifest(
  input: BuildOmkToolPlaneManifestInput
): Promise<OmkToolPlaneManifest> {
  const mcpConfigFile = await resolveRuntimeMcpConfigFile(input.mcpScope, input.mcpAllowlist);
  const mcpServers = mcpConfigFile ? await readMcpServerNames(mcpConfigFile) : [];
  return {
    mcpServers,
    mcpConfigFile: mcpConfigFile ?? undefined,
    skills: unique(input.skills ?? []),
    hooks: unique(input.hooks ?? []),
    tools: unique(input.tools ?? []),
    runtimeOwnsMcp: false,
    requiresRuntimeMcp: input.requiresRuntimeMcp === true,
  };
}

async function resolveRuntimeMcpConfigFile(
  scope: OmkRuntimeScope,
  allowlist: readonly string[] | undefined
): Promise<string | null> {
  if (scope === "none") return null;
  const configPaths = await collectMcpConfigs(scope);
  const builtinMcp = await writeBuiltinMcpConfig();
  const runtimeAllowlist = allowlist !== undefined
    ? unique([...allowlist, "omk-project"])
    : undefined;
  return writeRuntimeMcpConfig(
    builtinMcp ? [...configPaths, builtinMcp] : configPaths,
    runtimeAllowlist
  );
}

async function readMcpServerNames(configFile: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(configFile, "utf-8")) as { mcpServers?: unknown };
    const servers = parsed.mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];
    return unique(Object.keys(servers));
  } catch {
    return [];
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
