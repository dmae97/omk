import { sanitizeUserVisibleOutput } from "../../util/user-visible-output.js";

const UNSUPPORTED_RUNTIME_NODE_RE = /No runtime supports(?: task)?(?: for)? node\s+([A-Za-z0-9_.:/-]+)/i;

export function isUnsupportedRuntimeError(message: string): boolean {
  return UNSUPPORTED_RUNTIME_NODE_RE.test(message);
}

export function extractUnsupportedRuntimeNode(message: string): string | null {
  const match = message.match(UNSUPPORTED_RUNTIME_NODE_RE);
  return match?.[1] ?? null;
}

export function renderRouteBlockedPanel(message: string, options: { width?: number } = {}): string {
  const width = Math.min(100, Math.max(56, Math.round(options.width ?? 80)));
  const innerWidth = width - 4;
  const node = extractUnsupportedRuntimeNode(message) ?? "unknown";
  const safeMessage = sanitizeUserVisibleOutput(message).replace(/\s+/g, " ").trim();
  const lines = [
    "No runtime supports this task.",
    "",
    `Node        ${node}`,
    "Provider    auto / check configured runtimes",
    "Capability  provider capability mismatch",
    safeMessage && safeMessage !== message ? `Detail      ${safeMessage}` : "",
    "",
    "Suggested   omk doctor · /provider auto · /mode plan",
    "Inspect     omk runtimes · omk mcp doctor",
  ].filter(Boolean);

  const label = "ROUTE BLOCKED";
  const top = `╭─ ${label} ${"─".repeat(Math.max(0, width - label.length - 5))}╮`;
  const bottom = `╰${"─".repeat(width - 2)}╯`;
  const body = lines.map((line) => `│ ${truncate(line, innerWidth).padEnd(innerWidth)} │`);
  return [top, ...body, bottom].join("\n");
}

function truncate(value: string, width: number): string {
  const chars = [...value];
  if (chars.length <= width) return value;
  return `${chars.slice(0, Math.max(1, width - 1)).join("")}…`;
}
