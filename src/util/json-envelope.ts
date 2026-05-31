import { randomUUID } from "node:crypto";
import {
  OMK_CONTRACT_VERSION,
  OMK_RUNTIME_VERSION,
} from "../version.js";
import type {
  OmkCommandStatus,
  OmkError,
  OmkJsonEnvelope,
  OmkWarning,
} from "../contracts/index.js";
import { getOmkVersionSync } from "./version.js";

export type CreateOmkJsonEnvelopeOptions<TData> = {
  command: string;
  status: OmkCommandStatus;
  data: TData;
  ok?: boolean;
  commit?: string;
  runId?: string;
  traceId?: string;
  warnings?: OmkWarning[];
  errors?: OmkError[];
  provider?: string;
  durationMs: number;
};

export function createOmkJsonEnvelope<TData>(
  options: CreateOmkJsonEnvelopeOptions<TData>
): OmkJsonEnvelope<TData> {
  const ok = options.ok ?? options.status === "passed";
  return {
    ok,
    schemaVersion: OMK_CONTRACT_VERSION,
    command: options.command,
    omkVersion: getOmkVersionSync(),
    runtimeVersion: OMK_RUNTIME_VERSION,
    ...(options.commit ? { commit: options.commit } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
    traceId: options.traceId ?? randomUUID(),
    status: options.status,
    data: options.data,
    warnings: options.warnings ?? [],
    errors: options.errors ?? [],
    metadata: {
      cwd: process.cwd(),
      platform: process.platform,
      nodeVersion: process.version,
      ...(options.provider ? { provider: options.provider } : {}),
      durationMs: options.durationMs,
      timestamp: new Date().toISOString(),
    },
  };
}
