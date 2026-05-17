import { z } from "zod";

export const SERVARR_TYPES = ["radarr", "sonarr", "lidarr"] as const;
export type ServarrType = typeof SERVARR_TYPES[number];

export interface ServarrServiceProfile {
  readonly type: ServarrType;
  readonly defaultPort: number;
  readonly apiVersion: "v1" | "v3";
  readonly libraryEndpoint: string;
  readonly searchEndpoint: string;
}

export const SERVARR_SERVICE_PROFILES: Record<ServarrType, ServarrServiceProfile> = {
  radarr: {
    type: "radarr",
    defaultPort: 7878,
    apiVersion: "v3",
    libraryEndpoint: "movie",
    searchEndpoint: "movie/lookup",
  },
  sonarr: {
    type: "sonarr",
    defaultPort: 8989,
    apiVersion: "v3",
    libraryEndpoint: "series",
    searchEndpoint: "series/lookup",
  },
  lidarr: {
    type: "lidarr",
    defaultPort: 8686,
    apiVersion: "v1",
    libraryEndpoint: "artist",
    searchEndpoint: "artist/lookup",
  },
};

export interface ServarrInstance {
  readonly type: ServarrType;
  readonly name?: string;
  readonly baseUrl: string;
  readonly apiVersion: "v1" | "v3";
  readonly apiToken?: string;
  readonly apiTokenEnv?: string;
  readonly apiTokenFile?: string;
  readonly headers: Record<string, string>;
}

export interface ServarrConfig {
  readonly instances: ServarrInstance[];
}

export interface RedactedServarrInstance {
  readonly type: ServarrType;
  readonly name?: string;
  readonly baseUrl: string;
  readonly apiVersion: "v1" | "v3";
  readonly tokenSource: "inline" | "env" | "file" | "missing";
  readonly headers: string[];
}

const servarrTypeSchema = z.enum(SERVARR_TYPES);
const apiVersionSchema = z.enum(["v1", "v3"]);
const stringRecordSchema = z.record(z.string());

const rawInstanceSchema = z.object({
  type: servarrTypeSchema.optional(),
  name: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  base_url: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  ssl: z.boolean().optional(),
  apiVersion: apiVersionSchema.optional(),
  api_version: apiVersionSchema.optional(),
  apiToken: z.string().min(1).optional(),
  api_token: z.string().min(1).optional(),
  apiTokenEnv: z.string().min(1).optional(),
  api_token_env: z.string().min(1).optional(),
  apiTokenFile: z.string().min(1).optional(),
  api_token_file: z.string().min(1).optional(),
  headers: stringRecordSchema.optional(),
  customHeaders: stringRecordSchema.optional(),
  custom_headers: stringRecordSchema.optional(),
}).passthrough();

const rawConfigSchema = z.object({
  instances: z.array(rawInstanceSchema).optional(),
  radarr: z.array(rawInstanceSchema).optional(),
  sonarr: z.array(rawInstanceSchema).optional(),
  lidarr: z.array(rawInstanceSchema).optional(),
}).passthrough();

type RawInstance = z.infer<typeof rawInstanceSchema>;

export function parseServarrConfig(input: unknown): ServarrConfig {
  const parsed = rawConfigSchema.parse(input ?? {});
  const instances: ServarrInstance[] = [];

  for (const raw of parsed.instances ?? []) {
    instances.push(normalizeServarrInstance(raw));
  }
  for (const type of SERVARR_TYPES) {
    for (const raw of parsed[type] ?? []) {
      instances.push(normalizeServarrInstance(raw, type));
    }
  }

  return { instances };
}

export function normalizeServarrType(value: string): ServarrType {
  const lower = value.toLowerCase();
  const parsed = servarrTypeSchema.safeParse(lower);
  if (!parsed.success) {
    throw new Error(`Unsupported Servarr type: ${value}. Supported: ${SERVARR_TYPES.join(", ")}`);
  }
  return parsed.data;
}

export function redactServarrInstance(instance: ServarrInstance): RedactedServarrInstance {
  return {
    type: instance.type,
    name: instance.name,
    baseUrl: instance.baseUrl,
    apiVersion: instance.apiVersion,
    tokenSource: tokenSource(instance),
    headers: Object.keys(instance.headers),
  };
}

function normalizeServarrInstance(raw: RawInstance, forcedType?: ServarrType): ServarrInstance {
  const type = forcedType ?? raw.type;
  if (!type) {
    throw new Error("Servarr instance is missing a type");
  }
  const profile = SERVARR_SERVICE_PROFILES[type];
  const apiToken = raw.apiToken ?? raw.api_token;
  const apiTokenEnv = raw.apiTokenEnv ?? raw.api_token_env;
  const apiTokenFile = raw.apiTokenFile ?? raw.api_token_file;
  const tokenCount = [apiToken, apiTokenEnv, apiTokenFile].filter(Boolean).length;
  if (tokenCount > 1) {
    throw new Error(`Servarr ${type}${raw.name ? `/${raw.name}` : ""} must use exactly one API token source`);
  }

  const baseUrl = normalizeBaseUrl(raw.baseUrl ?? raw.base_url ?? raw.uri ?? buildHostUrl(raw, profile));
  const headers = {
    ...(raw.headers ?? {}),
    ...(raw.customHeaders ?? raw.custom_headers ?? {}),
  };

  return {
    type,
    name: raw.name,
    baseUrl,
    apiVersion: raw.apiVersion ?? raw.api_version ?? profile.apiVersion,
    apiToken,
    apiTokenEnv,
    apiTokenFile,
    headers,
  };
}

function normalizeBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid Servarr base URL: ${url}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported Servarr URL scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("Servarr base URL must not include embedded credentials");
  }
  return parsed.toString().replace(/\/+$/u, "");
}

function buildHostUrl(raw: RawInstance, profile: ServarrServiceProfile): string {
  const scheme = raw.ssl ? "https" : "http";
  const host = raw.host ?? "localhost";
  const port = raw.port ? Number.parseInt(String(raw.port), 10) : profile.defaultPort;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid port for ${profile.type}: ${String(raw.port)}`);
  }
  return `${scheme}://${host}:${port}`;
}

function tokenSource(instance: ServarrInstance): RedactedServarrInstance["tokenSource"] {
  if (instance.apiTokenEnv) return "env";
  if (instance.apiTokenFile) return "file";
  if (instance.apiToken) return "inline";
  return "missing";
}
