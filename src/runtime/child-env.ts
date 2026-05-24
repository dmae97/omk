export type ChildEnvSource = Readonly<Record<string, string | undefined>>;

export const DEFAULT_CHILD_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  "CI",
  "COLORTERM",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "OMK_ORIGINAL_HOME",
  "OMK_PROJECT_ROOT",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

export interface ChildEnvOptions {
  readonly parentEnv?: ChildEnvSource;
  readonly overrideEnv?: ChildEnvSource;
  readonly inheritParentEnv?: boolean;
  readonly allowedParentEnvNames?: readonly string[];
}

export interface RuntimeChildEnvMetadata {
  readonly runtimeId?: string;
  readonly runId?: string;
  readonly nodeId?: string;
  readonly role?: string;
  readonly goal?: string;
}

const SECRET_LIKE_ENV_NAME =
  /(?:^|_)(?:API_?KEY|AUTH|COOKIE|CREDENTIAL|PASS(?:WORD)?|PRIVATE|SECRET|SESSION|TOKEN)(?:_|$)/iu;

function normalizeEnvName(name: string): string {
  return process.platform === "win32" ? name.toUpperCase() : name;
}

function envNameSet(names: readonly string[]): Set<string> {
  return new Set(names.map((name) => normalizeEnvName(name)));
}

function validEnvName(name: string): boolean {
  return name.length > 0 && !name.includes("=") && !name.includes("\0");
}

function validEnvValue(value: string | undefined): value is string {
  return value !== undefined && !value.includes("\0");
}

export function isSecretLikeEnvName(name: string): boolean {
  return SECRET_LIKE_ENV_NAME.test(name);
}

export function buildChildEnv(options: ChildEnvOptions = {}): Record<string, string> {
  const parentEnv = options.parentEnv ?? process.env;
  const allowedNames = envNameSet(options.allowedParentEnvNames ?? DEFAULT_CHILD_ENV_ALLOWLIST);
  const inheritParentEnv = options.inheritParentEnv ?? false;
  const childEnv: Record<string, string> = {};

  for (const [name, value] of Object.entries(parentEnv)) {
    if (!validEnvName(name) || !validEnvValue(value)) continue;
    const normalizedName = normalizeEnvName(name);
    const isAllowed = allowedNames.has(normalizedName);
    if (!isAllowed && !inheritParentEnv) continue;
    if (!isAllowed && isSecretLikeEnvName(name)) continue;
    childEnv[name] = value;
  }

  for (const [name, value] of Object.entries(options.overrideEnv ?? {})) {
    if (!validEnvName(name) || !validEnvValue(value)) continue;
    childEnv[name] = value;
  }

  return childEnv;
}

export function runtimeMetadataEnv(metadata: RuntimeChildEnvMetadata): Record<string, string> {
  return buildChildEnv({
    parentEnv: {},
    overrideEnv: {
      OMK_RUNTIME_ID: metadata.runtimeId,
      OMK_RUN_ID: metadata.runId,
      OMK_NODE_ID: metadata.nodeId,
      OMK_ROLE: metadata.role,
      OMK_GOAL: metadata.goal,
    },
  });
}
