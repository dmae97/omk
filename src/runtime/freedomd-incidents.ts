/**
 * Freedomd provider incident monitor.
 *
 * Reads local incident overrides from `.omk/provider-incidents.json` and
 * optional per-project policy files. This avoids scraping public web pages by
 * default while still letting operators react to events like Fable 5 quickly.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProviderIncidentState } from "./provider-sovereignty.js";

export interface ProviderIncidentFile {
  readonly schemaVersion?: string;
  readonly updatedAt?: string;
  readonly incidents: readonly ProviderIncidentState[];
}

export interface LoadIncidentsOptions {
  readonly projectRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly feedUrls?: readonly string[];
  readonly fetch?: (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;
}

function parseIncidentFile(raw: string): ProviderIncidentState[] {
  try {
    const parsed = JSON.parse(raw) as ProviderIncidentFile;
    if (!Array.isArray(parsed.incidents)) return [];
    return parsed.incidents.filter(isValidIncident);
  } catch {
    return [];
  }
}

function isValidIncident(value: unknown): value is ProviderIncidentState {
  if (!value || typeof value !== "object") return false;
  const incident = value as Partial<ProviderIncidentState>;
  return (
    typeof incident.providerId === "string" &&
    typeof incident.kind === "string" &&
    typeof incident.severity === "string" &&
    ["availability", "policy", "export-control", "retention", "jurisdiction"].includes(incident.kind) &&
    ["info", "warn", "block"].includes(incident.severity)
  );
}

function incidentsFromEnv(env: NodeJS.ProcessEnv): ProviderIncidentState[] {
  const raw = env.OMK_PROVIDER_INCIDENTS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter(isValidIncident);
    if (parsed && typeof parsed === "object" && "incidents" in parsed) {
      return ((parsed as ProviderIncidentFile).incidents ?? []).filter(isValidIncident);
    }
    return [];
  } catch {
    return [];
  }
}

export async function loadProviderIncidents(options: LoadIncidentsOptions = {}): Promise<ProviderIncidentState[]> {
  const root = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;

  const filePath = join(root, ".omk", "provider-incidents.json");
  let fileIncidents: ProviderIncidentState[] = [];
  try {
    const raw = await readFile(filePath, "utf-8");
    fileIncidents = parseIncidentFile(raw);
  } catch {
    // Missing or unreadable file is fine; fall back to env.
  }

  const envIncidents = incidentsFromEnv(env);
  const feedIncidents = await fetchFeedIncidents(options.feedUrls ?? [], options.fetch);

  // Merge by providerId+kind, preferring the most recent and most severe.
  const map = new Map<string, ProviderIncidentState>();
  for (const incident of [...fileIncidents, ...envIncidents, ...feedIncidents]) {
    const key = `${incident.providerId}:${incident.kind}:${incident.runtimeMode ?? ""}`;
    const existing = map.get(key);
    if (!existing || severityRank(incident.severity) > severityRank(existing.severity)) {
      map.set(key, incident);
    }
  }

  return [...map.values()];
}

async function fetchFeedIncidents(
  urls: readonly string[],
  fetchImpl?: LoadIncidentsOptions["fetch"],
): Promise<ProviderIncidentState[]> {
  if (urls.length === 0) return [];
  const fetcher = fetchImpl ?? defaultFetch;
  const results: ProviderIncidentState[] = [];
  for (const url of urls) {
    try {
      const response = await fetcher(url);
      if (!response.ok) continue;
      const text = await response.text();
      const parsed = parseIncidentFile(text);
      results.push(...parsed);
    } catch {
      // Best-effort: individual feed failures must not block routing.
    }
  }
  return results;
}

async function defaultFetch(url: string): Promise<{ ok: boolean; text: () => Promise<string> }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  return { ok: response.ok, text: () => response.text() };
}

function severityRank(severity: string): number {
  if (severity === "block") return 2;
  if (severity === "warn") return 1;
  return 0;
}
