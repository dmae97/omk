export interface ContextPreflightOptions {
  provider: string;
  model?: string;
  contextWindow?: number;
  reservedOutputTokens?: number;
  safetyMarginTokens?: number;
  runId?: string;
  nodeId?: string;
  projectRoot?: string;
}

export interface ContextPreflightReport {
  provider: string;
  model?: string;
  contextWindow?: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  maxInputTokens: number | null;
  inputTokensEstimated: number;
  inputTokensAfterCompaction: number;
  originalChars: number;
  finalChars: number;
  compacted: boolean;
  ok: boolean;
  reason?: string;
  runId?: string;
  nodeId?: string;
  projectRoot?: string;
}

export interface InputPreflightResult {
  ok: boolean;
  input: string;
  report: ContextPreflightReport;
}

export interface PreflightMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface MessagesPreflightResult {
  ok: boolean;
  messages: PreflightMessage[];
  report: ContextPreflightReport;
}

const DEFAULT_RESERVED_OUTPUT_TOKENS = 4096;
const DEFAULT_SAFETY_MARGIN_TOKENS = 1024;
const MIN_INPUT_TOKENS = 64;
const CHARS_PER_TOKEN = 4;

export async function preflightProviderInput(
  input: string,
  options: ContextPreflightOptions,
): Promise<InputPreflightResult> {
  const normalizedInput = String(input ?? "");
  const compacted = compactTextToBudget(normalizedInput, resolveInputBudget(options));
  return {
    ok: compacted.ok,
    input: compacted.text,
    report: buildReport(options, normalizedInput, compacted.text, compacted.ok, compacted.reason),
  };
}

export async function preflightProviderMessages(
  messages: readonly PreflightMessage[],
  options: ContextPreflightOptions,
): Promise<MessagesPreflightResult> {
  const normalizedMessages = messages.map((message) => ({
    role: message.role,
    content: String(message.content ?? ""),
  }));
  const budget = resolveInputBudget(options);
  const estimates = normalizedMessages.map((message) => estimateTokens(message.content));
  let totalTokens = estimates.reduce((sum, value) => sum + value, 0);

  if (budget == null || totalTokens <= budget) {
    return {
      ok: true,
      messages: normalizedMessages,
      report: buildReport(options, joinMessages(normalizedMessages), joinMessages(normalizedMessages), true, undefined),
    };
  }

  const nextMessages = normalizedMessages.map((message) => ({ ...message }));
  for (let index = nextMessages.length - 1; index >= 0 && totalTokens > budget; index -= 1) {
    const current = nextMessages[index];
    const otherTokens = totalTokens - estimates[index];
    const allowedTokens = Math.max(MIN_INPUT_TOKENS, budget - otherTokens);
    if (allowedTokens >= estimates[index]) continue;
    const compacted = compactTextToBudget(current.content, allowedTokens);
    nextMessages[index] = { ...current, content: compacted.text };
    estimates[index] = estimateTokens(compacted.text);
    totalTokens = otherTokens + estimates[index];
  }

  const finalText = joinMessages(nextMessages);
  const ok = budget == null ? true : estimateTokens(finalText) <= budget;
  return {
    ok,
    messages: nextMessages,
    report: buildReport(
      options,
      joinMessages(normalizedMessages),
      finalText,
      ok,
      ok ? undefined : `Estimated input tokens exceed budget (${estimateTokens(finalText)} > ${budget})`,
    ),
  };
}

export function contextPreflightErrorMessage(report: ContextPreflightReport): string {
  const budget = report.maxInputTokens == null ? "unknown" : String(report.maxInputTokens);
  const lines = [
    `[omk] ${report.provider} context preflight blocked this request.`,
    `  model: ${report.model ?? "auto"}`,
    `  estimated input tokens: ${report.inputTokensEstimated}`,
    `  budget: ${budget}`,
  ];
  if (report.reason) lines.push(`  reason: ${report.reason}`);
  if (report.contextWindow != null) lines.push(`  context window: ${report.contextWindow}`);
  lines.push(`  reserved output tokens: ${report.reservedOutputTokens}`);
  lines.push(`  safety margin tokens: ${report.safetyMarginTokens}`);
  return lines.join("\n");
}

function resolveInputBudget(options: ContextPreflightOptions): number | null {
  if (!Number.isFinite(options.contextWindow) || options.contextWindow == null || options.contextWindow <= 0) {
    return null;
  }
  const reservedOutputTokens = options.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
  const safetyMarginTokens = options.safetyMarginTokens ?? DEFAULT_SAFETY_MARGIN_TOKENS;
  return Math.max(MIN_INPUT_TOKENS, options.contextWindow - reservedOutputTokens - safetyMarginTokens);
}

function buildReport(
  options: ContextPreflightOptions,
  originalText: string,
  finalText: string,
  ok: boolean,
  reason?: string,
): ContextPreflightReport {
  const reservedOutputTokens = options.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
  const safetyMarginTokens = options.safetyMarginTokens ?? DEFAULT_SAFETY_MARGIN_TOKENS;
  return {
    provider: options.provider,
    model: options.model,
    contextWindow: options.contextWindow,
    reservedOutputTokens,
    safetyMarginTokens,
    maxInputTokens: resolveInputBudget(options),
    inputTokensEstimated: estimateTokens(originalText),
    inputTokensAfterCompaction: estimateTokens(finalText),
    originalChars: originalText.length,
    finalChars: finalText.length,
    compacted: originalText !== finalText,
    ok,
    reason,
    runId: options.runId,
    nodeId: options.nodeId,
    projectRoot: options.projectRoot,
  };
}

function compactTextToBudget(text: string, budget: number | null): { ok: boolean; text: string; reason?: string } {
  if (budget == null || estimateTokens(text) <= budget) {
    return { ok: true, text };
  }

  const maxChars = Math.max(MIN_INPUT_TOKENS * CHARS_PER_TOKEN, budget * CHARS_PER_TOKEN);
  const compacted = compactText(text, maxChars);
  if (estimateTokens(compacted) <= budget) {
    return { ok: true, text: compacted };
  }

  return {
    ok: false,
    text: compacted,
    reason: `Estimated input tokens exceed budget (${estimateTokens(compacted)} > ${budget})`,
  };
}

function compactText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const headChars = Math.max(80, Math.floor(maxChars * 0.7));
  const tailChars = Math.max(40, Math.floor(maxChars * 0.2));
  const omitted = Math.max(0, trimmed.length - headChars - tailChars);
  const marker = `\n\n[truncated: ${omitted} chars omitted]\n\n`;
  const budgetForBody = Math.max(0, maxChars - marker.length);
  const safeHead = Math.max(40, Math.floor(budgetForBody * 0.7));
  const safeTail = Math.max(20, budgetForBody - safeHead);
  return `${trimmed.slice(0, safeHead)}${marker}${trimmed.slice(-safeTail)}`;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(String(text ?? "").length / CHARS_PER_TOKEN));
}

function joinMessages(messages: readonly PreflightMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
}
