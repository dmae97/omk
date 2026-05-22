import { createHash } from "crypto";
import {
  WEB_BRIDGE_SCHEMA_VERSION,
  assertReadOnlyWebBridgeRequest,
  createWebBridgeErrorResponse,
  createWebBridgeOkResponse,
  getDefaultWebBridgeCapabilities,
  isWebBridgeMutation,
  sanitizeWebBridgePageSnapshot,
  validateWebBridgeRequest,
  type WebBridgePageSnapshot,
  type WebBridgeRequestEnvelope,
  type WebBridgeResponseEnvelope,
} from "../contracts/web-bridge.js";
import {
  getWebBridgeStatus,
  readLatestWebBridgePageContext,
  writeWebBridgePageContext,
} from "./status.js";

interface BridgeHostOptions {
  root?: string;
  now?: Date;
}

export async function handleWebBridgeRequest(
  rawRequest: unknown,
  options: BridgeHostOptions = {}
): Promise<WebBridgeResponseEnvelope> {
  let request: WebBridgeRequestEnvelope;
  try {
    request = validateWebBridgeRequest(rawRequest);
  } catch (err) {
    return createWebBridgeErrorResponse("unknown", "invalid_schema", err instanceof Error ? err.message : String(err));
  }

  if (isWebBridgeMutation(request.method)) {
    const approvalError = validateMutationApproval(request, options.now ?? new Date());
    if (approvalError) return createWebBridgeErrorResponse(request.requestId, "approval_required", approvalError, { retryable: false });
    return createWebBridgeErrorResponse(request.requestId, "unsafe_mutation", "Approved browser mutations are not executed by the read-only OMK web bridge v1", { retryable: false });
  }

  try {
    assertReadOnlyWebBridgeRequest(request);
    switch (request.method) {
      case "bridge.ping":
        return createWebBridgeOkResponse(request.requestId, { pong: true, schemaVersion: WEB_BRIDGE_SCHEMA_VERSION });
      case "bridge.capabilities":
        return createWebBridgeOkResponse(request.requestId, getDefaultWebBridgeCapabilities());
      case "bridge.status":
        return createWebBridgeOkResponse(request.requestId, await getWebBridgeStatus({ root: options.root }));
      case "browser.tabs.list": {
        const snapshot = await readLatestWebBridgePageContext(options.root);
        const tabs = extractTabsFromParams(request.params) ?? snapshot?.tabs ?? (snapshot?.tab ? [snapshot.tab] : []);
        return createWebBridgeOkResponse(request.requestId, { tabs });
      }
      case "browser.page.read": {
        const snapshot = extractSnapshotFromParams(request.params) ?? await readLatestWebBridgePageContext(options.root);
        if (!snapshot) return createWebBridgeErrorResponse(request.requestId, "not_connected", "No web bridge page snapshot is available", { retryable: true });
        return createWebBridgeOkResponse(request.requestId, sanitizeWebBridgePageSnapshot(snapshot));
      }
      case "browser.selection.read": {
        const snapshot = extractSnapshotFromParams(request.params) ?? await readLatestWebBridgePageContext(options.root);
        return createWebBridgeOkResponse(request.requestId, { selectedText: snapshot?.selectedText ?? "" });
      }
      case "browser.dom.query": {
        const snapshot = extractSnapshotFromParams(request.params) ?? await readLatestWebBridgePageContext(options.root);
        if (!snapshot?.dom) return createWebBridgeErrorResponse(request.requestId, "not_connected", "No DOM snapshot is available", { retryable: true });
        return createWebBridgeOkResponse(request.requestId, { dom: snapshot.dom });
      }
      case "browser.screenshot.capture": {
        const snapshot = extractSnapshotFromParams(request.params) ?? await readLatestWebBridgePageContext(options.root);
        if (!snapshot?.screenshot) return createWebBridgeErrorResponse(request.requestId, "not_connected", "No screenshot artifact is available", { retryable: true });
        return createWebBridgeOkResponse(request.requestId, { screenshot: snapshot.screenshot });
      }
      case "orchestration.context.write": {
        const snapshot = extractSnapshotFromParams(request.params);
        if (!snapshot) return createWebBridgeErrorResponse(request.requestId, "invalid_schema", "orchestration.context.write requires a snapshot payload");
        const runId = extractRunIdFromParams(request.params);
        const written = await writeWebBridgePageContext(snapshot, { root: options.root, runId });
        return createWebBridgeOkResponse(request.requestId, written);
      }
      default:
        return createWebBridgeErrorResponse(request.requestId, "unknown_method", `Unknown web bridge method: ${request.method}`);
    }
  } catch (err) {
    return createWebBridgeErrorResponse(request.requestId, "internal_error", err instanceof Error ? err.message : String(err));
  }
}

function validateMutationApproval(request: WebBridgeRequestEnvelope, now: Date): string | null {
  const approval = request.approval;
  if (!approval) return "Mutating browser actions require explicit approval";
  if (approval.method !== request.method) return "Approval is bound to a different method";
  const expiresAt = Date.parse(approval.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return "Approval is expired or invalid";
  const expectedDigest = digestParams(request.params);
  if (approval.argsDigest !== expectedDigest) return "Approval args digest does not match the requested action";
  return null;
}

export function digestParams(params: unknown): string {
  return createHash("sha256").update(JSON.stringify(params ?? null)).digest("hex").slice(0, 24);
}

function extractSnapshotFromParams(params: unknown): WebBridgePageSnapshot | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const record = params as Record<string, unknown>;
  const snapshot = record.snapshot ?? record.page ?? record.context;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return sanitizeWebBridgePageSnapshot(snapshot as WebBridgePageSnapshot);
}

function extractTabsFromParams(params: unknown): WebBridgePageSnapshot["tabs"] | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const tabs = (params as Record<string, unknown>).tabs;
  if (!Array.isArray(tabs)) return null;
  return sanitizeWebBridgePageSnapshot({ tabs }).tabs ?? [];
}

function extractRunIdFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const runId = (params as Record<string, unknown>).runId;
  return typeof runId === "string" && runId.trim() ? runId : undefined;
}
