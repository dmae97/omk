import { readFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";
import YAML from "yaml";

import { getProjectRoot, pathExists } from "../../util/fs.js";
import {
  SERVARR_SERVICE_PROFILES,
  parseServarrConfig,
  redactServarrInstance,
  type RedactedServarrInstance,
  type ServarrConfig,
  type ServarrInstance,
  type ServarrType,
} from "./schema.js";

export interface LoadedServarrConfig {
  readonly path: string;
  readonly configDir: string;
  readonly config: ServarrConfig;
}

export interface ServarrRequestOptions {
  readonly timeoutMs?: number;
  readonly query?: Record<string, string | number | boolean | undefined>;
}

export interface ServarrResponse {
  readonly service: ServarrType;
  readonly instance: RedactedServarrInstance;
  readonly endpoint: string;
  readonly url: string;
  readonly status: number;
  readonly data: unknown;
}

export class ServarrIntegrationError extends Error {
  constructor(message: string, public readonly exitCode = 1) {
    super(message);
    this.name = "ServarrIntegrationError";
  }
}

const DEFAULT_CONFIG_NAMES = ["servarr.yml", "servarr.yaml", "servarr.json"] as const;

export function getDefaultServarrConfigPath(root = getProjectRoot()): string {
  return join(root, ".omk", "servarr.yml");
}

export async function resolveServarrConfigPath(configFile?: string): Promise<string> {
  if (configFile) return resolve(configFile);
  const root = getProjectRoot();
  for (const name of DEFAULT_CONFIG_NAMES) {
    const candidate = join(root, ".omk", name);
    if (await pathExists(candidate)) return candidate;
  }
  return getDefaultServarrConfigPath(root);
}

export async function loadServarrConfig(configFile?: string): Promise<LoadedServarrConfig> {
  const configPath = await resolveServarrConfigPath(configFile);
  if (!(await pathExists(configPath))) {
    throw new ServarrIntegrationError(
      `Servarr config not found: ${configPath}. Create it or pass --config-file.`
    );
  }
  const raw = await readFile(configPath, "utf-8");
  const parsed = configPath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  return {
    path: configPath,
    configDir: dirname(configPath),
    config: parseServarrConfig(parsed),
  };
}

export function listServarrInstances(config: ServarrConfig): RedactedServarrInstance[] {
  return config.instances.map(redactServarrInstance);
}

export function selectServarrInstance(
  config: ServarrConfig,
  type: ServarrType,
  name?: string
): ServarrInstance {
  const candidates = config.instances.filter((instance) => instance.type === type);
  if (candidates.length === 0) {
    throw new ServarrIntegrationError(`No ${type} instance configured`);
  }
  if (!name) return candidates[0];
  const found = candidates.find((instance) => instance.name === name);
  if (!found) {
    throw new ServarrIntegrationError(`No ${type} instance named "${name}" configured`);
  }
  return found;
}

export async function requestServarr(
  instance: ServarrInstance,
  endpoint: string,
  configDir: string,
  options: ServarrRequestOptions = {}
): Promise<ServarrResponse> {
  const token = await resolveApiToken(instance, configDir);
  const url = buildServarrUrl(instance, endpoint, options.query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-api-key": token,
        ...instance.headers,
      },
      signal: controller.signal,
    });
    const data = await parseResponseBody(response);
    if (!response.ok) {
      throw new ServarrIntegrationError(
        `${instance.type} request failed (${response.status} ${response.statusText}) for ${endpoint}: ${redactSensitiveText(summarizeBody(data))}`
      );
    }
    return {
      service: instance.type,
      instance: redactServarrInstance(instance),
      endpoint,
      url,
      status: response.status,
      data,
    };
  } catch (err) {
    if (err instanceof ServarrIntegrationError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ServarrIntegrationError(`${instance.type} request timed out for ${endpoint}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ServarrIntegrationError(`${instance.type} request failed for ${endpoint}: ${redactSensitiveText(message)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function serviceEndpoint(type: ServarrType, kind: "library" | "search"): string {
  const profile = SERVARR_SERVICE_PROFILES[type];
  return kind === "library" ? profile.libraryEndpoint : profile.searchEndpoint;
}

async function resolveApiToken(instance: ServarrInstance, configDir: string): Promise<string> {
  if (instance.apiTokenEnv) {
    const token = process.env[instance.apiTokenEnv];
    if (!token) throw new ServarrIntegrationError(`Missing API token env var: ${instance.apiTokenEnv}`);
    return token;
  }
  if (instance.apiTokenFile) {
    const tokenPath = resolve(configDir, instance.apiTokenFile);
    const resolvedConfigDir = resolve(configDir);
    if (!tokenPath.startsWith(resolvedConfigDir + sep) && tokenPath !== resolvedConfigDir) {
      throw new ServarrIntegrationError("apiTokenFile must be inside the config directory");
    }
    const token = (await readFile(tokenPath, "utf-8")).trim();
    if (!token) throw new ServarrIntegrationError(`API token file is empty: ${tokenPath}`);
    return token;
  }
  if (instance.apiToken) return instance.apiToken;
  throw new ServarrIntegrationError(
    `Missing API token for ${instance.type}${instance.name ? `/${instance.name}` : ""}`
  );
}

function buildServarrUrl(
  instance: ServarrInstance,
  endpoint: string,
  query: ServarrRequestOptions["query"] = {}
): string {
  const normalizedEndpoint = endpoint.replace(/^\/+/u, "");
  const base = `${instance.baseUrl}/api/${instance.apiVersion}/`;
  const url = new URL(normalizedEndpoint, base);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function summarizeBody(body: unknown): string {
  const value = typeof body === "string" ? body : JSON.stringify(body);
  if (!value) return "empty response";
  return value.length > 300 ? `${value.slice(0, 300)}…` : value;
}

function redactSensitiveText(input: string): string {
  return input
    .replace(/(x-api-key|api[_-]?key|api[_-]?token|authorization|cookie)(["'\s:=]+)([^"',\s}]+)/giu, "$1$2[REDACTED]")
    .replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/giu, "$1[REDACTED]@");
}
