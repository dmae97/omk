export type RuntimeSandboxLevel =
  | "env-only"
  | "read-only-fs"
  | "workspace-write"
  | "no-network"
  | "network-allowlist"
  | "isolated-home";

export type RuntimeNetworkPolicy = "off" | "on" | { readonly allowHosts: readonly string[] };

export type RuntimeEnvPolicy = "safe-default" | "explicit-grants";

export interface RuntimeSandboxProfile {
  readonly level: RuntimeSandboxLevel;
  readonly cwd: string;
  readonly writableRoots: readonly string[];
  readonly readableRoots: readonly string[];
  readonly network: RuntimeNetworkPolicy;
  readonly envPolicy: RuntimeEnvPolicy;
}

export interface CreateRuntimeSandboxProfileOptions {
  readonly cwd: string;
  readonly level?: RuntimeSandboxLevel;
  readonly writableRoots?: readonly string[];
  readonly readableRoots?: readonly string[];
  readonly network?: RuntimeNetworkPolicy;
  readonly envPolicy?: RuntimeEnvPolicy;
}

export function createRuntimeSandboxProfile(
  options: CreateRuntimeSandboxProfileOptions
): RuntimeSandboxProfile {
  const level = options.level ?? "env-only";
  return {
    level,
    cwd: options.cwd,
    writableRoots: options.writableRoots ?? (level === "workspace-write" ? [options.cwd] : []),
    readableRoots: options.readableRoots ?? [options.cwd],
    network: options.network ?? "off",
    envPolicy: options.envPolicy ?? "explicit-grants",
  };
}

