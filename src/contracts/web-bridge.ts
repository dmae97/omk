import { maskSensitiveText } from "../util/secret-mask.js";

export const WEB_BRIDGE_SCHEMA_VERSION = 1 as const;
export const WEB_BRIDGE_NATIVE_HOST_NAME = "io.omk.web_bridge";
export const WEB_BRIDGE_MCP_SERVER_NAME = "omk-web-bridge";
export const WEB_BRIDGE_MAX_TEXT_CHARS = 120_000;
export const WEB_BRIDGE_MAX_PAYLOAD_BYTES = 1_000_000;

export type WebBridgeReadMethod =
  | "bridge.ping"
  | "bridge.status"
  | "bridge.capabilities"
  | "browser.tabs.list"
  | "browser.page.read"
  | "browser.selection.read"
  | "browser.dom.query"
  | "browser.screenshot.capture"
  | "orchestration.context.write";

export type WebBridgeMutationMethod = "browser.action.request";
export type WebBridgeMethod = WebBridgeReadMethod | WebBridgeMutationMethod;

export type WebBridgeActionKind =
  | "click"
  | "formFill"
  | "download"
  | "upload"
  | "post"
  | "clipboardWrite"
  | "navigate";

export interface WebBridgeApproval {
  token: string;
  expiresAt: string;
  method: WebBridgeMutationMethod;
  target: string;
  argsDigest: string;
}

export interface WebBridgeRequestEnvelope<TParams = unknown> {
  schemaVersion: typeof WEB_BRIDGE_SCHEMA_VERSION;
  requestId: string;
  method: WebBridgeMethod;
  params?: TParams;
  origin?: string;
  nonce?: string;
  approval?: WebBridgeApproval;
}

export interface WebBridgeError {
  code:
    | "invalid_schema"
    | "unknown_method"
    | "payload_too_large"
    | "unsafe_mutation"
    | "approval_required"
    | "not_connected"
    | "internal_error";
  message: string;
  retryable?: boolean;
}

export interface WebBridgeResponseEnvelope<TResult = unknown> {
  schemaVersion: typeof WEB_BRIDGE_SCHEMA_VERSION;
  requestId: string;
  ok: boolean;
  result?: TResult;
  error?: WebBridgeError;
}

export interface WebBridgeTabInfo {
  id: string | number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: string | number;
}

export interface WebBridgePageMetadata {
  url?: string;
  title?: string;
  description?: string;
  language?: string;
  contentType?: string;
  capturedAt?: string;
  source?: "chrome-extension" | "native-host" | "mock" | "artifact";
  [key: string]: unknown;
}

export interface WebBridgeScreenshotRef {
  mimeType: "image/png" | "image/jpeg";
  bytes?: string;
  artifactPath?: string;
  redacted?: boolean;
}

export interface WebBridgePageSnapshot {
  tab?: WebBridgeTabInfo;
  tabs?: WebBridgeTabInfo[];
  metadata?: WebBridgePageMetadata;
  text?: string;
  selectedText?: string;
  dom?: string;
  screenshot?: WebBridgeScreenshotRef;
  warnings?: string[];
}

export interface WebBridgeCapabilities {
  schemaVersion: typeof WEB_BRIDGE_SCHEMA_VERSION;
  readOnlyDefault: true;
  supportsTabs: boolean;
  supportsPageText: boolean;
  supportsSelection: boolean;
  supportsDom: boolean;
  supportsScreenshot: boolean;
  supportsMutations: false;
  mutationsRequireApproval: true;
  forbiddenData: string[];
  methods: WebBridgeMethod[];
}

const READ_METHODS: readonly WebBridgeReadMethod[] = [
  "bridge.ping",
  "bridge.status",
  "bridge.capabilities",
  "browser.tabs.list",
  "browser.page.read",
  "browser.selection.read",
  "browser.dom.query",
  "browser.screenshot.capture",
  "orchestration.context.write",
] as const;

const MUTATION_METHODS: readonly WebBridgeMutationMethod[] = ["browser.action.request"] as const;
const METHODS = new Set<string>([...READ_METHODS, ...MUTATION_METHODS]);

const SENSITIVE_KEY_RE = /(?:cookie|set-cookie|authorization|proxy-authorization|password|passwd|token|secret|credential|localstorage|sessionstorage|indexeddb|auth|privatekey|api[-_]?key)/iu;

export function getDefaultWebBridgeCapabilities(): WebBridgeCapabilities {
  return {
    schemaVersion: WEB_BRIDGE_SCHEMA_VERSION,
    readOnlyDefault: true,
    supportsTabs: true,
    supportsPageText: true,
    supportsSelection: true,
    supportsDom: true,
    supportsScreenshot: true,
    supportsMutations: false,
    mutationsRequireApproval: true,
    forbiddenData: [
      "cookies",
      "passwords",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "authorization headers",
      "raw secrets",
    ],
    methods: [...READ_METHODS, ...MUTATION_METHODS],
  };
}

export function isWebBridgeMethod(value: string): value is WebBridgeMethod {
  return METHODS.has(value);
}

export function isWebBridgeMutation(method: WebBridgeMethod): method is WebBridgeMutationMethod {
  return (MUTATION_METHODS as readonly string[]).includes(method);
}

export function createWebBridgeErrorResponse(
  requestId: string,
  code: WebBridgeError["code"],
  message: string,
  options: { retryable?: boolean } = {}
): WebBridgeResponseEnvelope {
  return {
    schemaVersion: WEB_BRIDGE_SCHEMA_VERSION,
    requestId,
    ok: false,
    error: {
      code,
      message: maskSensitiveText(message),
      ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
    },
  };
}

export function createWebBridgeOkResponse<TResult>(
  requestId: string,
  result: TResult
): WebBridgeResponseEnvelope<TResult> {
  return {
    schemaVersion: WEB_BRIDGE_SCHEMA_VERSION,
    requestId,
    ok: true,
    result: redactWebBridgeValue(result),
  };
}

export function validateWebBridgeRequest(input: unknown): WebBridgeRequestEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Web bridge request must be an object");
  }
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== WEB_BRIDGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported web bridge schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (typeof value.requestId !== "string" || value.requestId.trim() === "") {
    throw new Error("Web bridge requestId must be a non-empty string");
  }
  if (typeof value.method !== "string" || !isWebBridgeMethod(value.method)) {
    throw new Error(`Unknown web bridge method: ${String(value.method)}`);
  }
  const origin = typeof value.origin === "string" ? maskSensitiveText(value.origin) : undefined;
  const nonce = typeof value.nonce === "string" ? value.nonce : undefined;
  const approval = parseApproval(value.approval);
  return {
    schemaVersion: WEB_BRIDGE_SCHEMA_VERSION,
    requestId: value.requestId,
    method: value.method,
    ...(value.params === undefined ? {} : { params: redactWebBridgeValue(value.params) }),
    ...(origin === undefined ? {} : { origin }),
    ...(nonce === undefined ? {} : { nonce }),
    ...(approval === undefined ? {} : { approval }),
  };
}

export function assertReadOnlyWebBridgeRequest(request: WebBridgeRequestEnvelope): void {
  if (!isWebBridgeMutation(request.method)) return;
  throw new Error("Mutating browser actions require explicit approval and are disabled by default");
}

export function sanitizeWebBridgePageSnapshot(snapshot: WebBridgePageSnapshot): WebBridgePageSnapshot {
  const sanitized = redactWebBridgeValue(snapshot);
  return {
    ...sanitized,
    text: truncateBridgeText(sanitized.text),
    selectedText: truncateBridgeText(sanitized.selectedText),
    dom: truncateBridgeText(sanitized.dom),
    warnings: normalizeWarnings(sanitized.warnings),
  };
}

export function redactWebBridgeValue<T>(value: T): T {
  return redactUnknown(value) as T;
}

export function truncateBridgeText(value: string | undefined, maxChars = WEB_BRIDGE_MAX_TEXT_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const masked = maskSensitiveText(value)
    .replace(/\b(localStorage|sessionStorage|indexedDB)\s*[:=]\s*[^\n\r;]+/giu, "$1: [redacted]")
    .replace(/(<input\b[^>]*type=["']?password["']?[^>]*)(value=["'][^"']*["'])/giu, "$1value=" + JSON.stringify("[redacted]") );
  if (masked.length <= maxChars) return masked;
  return `${masked.slice(0, maxChars)}\n[truncated:${masked.length - maxChars}]`;
}

function redactUnknown(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateBridgeText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (typeof value !== "object") return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = redactUnknown(nested);
  }
  return output;
}

function parseApproval(value: unknown): WebBridgeApproval | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.token !== "string" ||
    typeof raw.expiresAt !== "string" ||
    raw.method !== "browser.action.request" ||
    typeof raw.target !== "string" ||
    typeof raw.argsDigest !== "string"
  ) {
    return undefined;
  }
  return {
    token: "[redacted]",
    expiresAt: raw.expiresAt,
    method: "browser.action.request",
    target: maskSensitiveText(raw.target),
    argsDigest: raw.argsDigest,
  };
}

function normalizeWarnings(value: string[] | undefined): string[] {
  const warnings = Array.isArray(value) ? value : [];
  return [...new Set(warnings.map((item) => maskSensitiveText(String(item))).filter(Boolean))].slice(0, 20);
}
