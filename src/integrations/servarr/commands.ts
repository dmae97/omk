import { style, status as themeStatus, header, label } from "../../util/theme.js";
import {
  getDefaultServarrConfigPath,
  listServarrInstances,
  loadServarrConfig,
  requestServarr,
  resolveServarrConfigPath,
  selectServarrInstance,
  serviceEndpoint,
  ServarrIntegrationError,
} from "./adapter.js";
import { normalizeServarrType, type ServarrType } from "./schema.js";

export interface ServarrCommandOptions {
  readonly configFile?: string;
  readonly servarrName?: string;
  readonly json?: boolean;
  readonly limit?: string;
  readonly timeoutMs?: string;
}

type ServarrAction = () => Promise<void>;

export async function servarrConfigPathCommand(options: ServarrCommandOptions = {}): Promise<void> {
  await withServarrErrors(options, async () => {
    const path = options.configFile ? await resolveServarrConfigPath(options.configFile) : getDefaultServarrConfigPath();
    emit(options, { ok: true, path }, label("Servarr config", path));
  });
}

export async function servarrInstancesCommand(options: ServarrCommandOptions = {}): Promise<void> {
  await withServarrErrors(options, async () => {
    const loaded = await loadServarrConfig(options.configFile);
    const instances = listServarrInstances(loaded.config);
    if (options.json) {
      emit(options, { ok: true, configFile: loaded.path, instances }, "");
      return;
    }
    if (instances.length === 0) {
      console.log(themeStatus.warn(`No Servarr instances configured in ${loaded.path}`));
      return;
    }
    console.log(header("Servarr instances"));
    for (const instance of instances) {
      const name = instance.name ? ` ${style.gray(`(${instance.name})`)}` : "";
      console.log(
        `  ${style.mint(instance.type)}${name} ${style.gray(instance.baseUrl)} ${style.gray(`token:${instance.tokenSource}`)}`
      );
    }
  });
}

export async function servarrStatusCommand(type: string, options: ServarrCommandOptions = {}): Promise<void> {
  await servarrReadCommand(type, "system/status", "status", options);
}

export async function servarrHealthCommand(type: string, options: ServarrCommandOptions = {}): Promise<void> {
  await servarrReadCommand(type, "health", "health", options);
}

export async function servarrTasksCommand(type: string, options: ServarrCommandOptions = {}): Promise<void> {
  await servarrReadCommand(type, "system/task", "tasks", options);
}

export async function servarrLogsCommand(type: string, options: ServarrCommandOptions = {}): Promise<void> {
  const limit = parsePositiveInt(options.limit, 20, "limit");
  await servarrReadCommand(type, "log", "logs", options, {
    page: 1,
    pageSize: limit,
    sortKey: "time",
    sortDirection: "descending",
  });
}

export async function servarrListCommand(type: string, options: ServarrCommandOptions = {}): Promise<void> {
  await withServarrErrors(options, async () => {
    const service = normalizeServarrType(type);
    const endpoint = serviceEndpoint(service, "library");
    await emitServarrRequest(service, endpoint, "library", options);
  });
}

export async function servarrSearchCommand(
  type: string,
  term: string,
  options: ServarrCommandOptions = {}
): Promise<void> {
  await withServarrErrors(options, async () => {
    const service = normalizeServarrType(type);
    const endpoint = serviceEndpoint(service, "search");
    await emitServarrRequest(service, endpoint, "search", options, { term });
  });
}

async function servarrReadCommand(
  type: string,
  endpoint: string,
  command: string,
  options: ServarrCommandOptions,
  query?: Record<string, string | number | boolean | undefined>
): Promise<void> {
  await withServarrErrors(options, async () => {
    const service = normalizeServarrType(type);
    await emitServarrRequest(service, endpoint, command, options, query);
  });
}

async function emitServarrRequest(
  service: ServarrType,
  endpoint: string,
  command: string,
  options: ServarrCommandOptions,
  query?: Record<string, string | number | boolean | undefined>
): Promise<void> {
  const loaded = await loadServarrConfig(options.configFile);
  const instance = selectServarrInstance(loaded.config, service, options.servarrName);
  const response = await requestServarr(instance, endpoint, loaded.configDir, {
    query,
    timeoutMs: parsePositiveInt(options.timeoutMs, 15_000, "timeout-ms"),
  });
  if (options.json) {
    emit(options, { ok: true, command: `servarr ${command}`, configFile: loaded.path, ...response }, "");
    return;
  }
  console.log(header(`Servarr ${command}: ${service}${instance.name ? `/${instance.name}` : ""}`));
  console.log(label("Endpoint", response.endpoint));
  console.log(label("Status", String(response.status)));
  if (command === "health" && Array.isArray(response.data) && response.data.length === 0) {
    console.log(themeStatus.ok("No health issues reported."));
  } else {
    console.log(JSON.stringify(response.data, null, 2));
  }
}

async function withServarrErrors(options: ServarrCommandOptions, action: ServarrAction): Promise<void> {
  try {
    await action();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(themeStatus.error(message));
    }
    process.exitCode = err instanceof ServarrIntegrationError ? err.exitCode : 1;
  }
}

function emit(options: ServarrCommandOptions, data: unknown, human: string): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(human);
  }
}

function parsePositiveInt(value: string | undefined, fallback: number, labelText: string): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ServarrIntegrationError(`Invalid ${labelText}: ${value}`);
  }
  return parsed;
}
