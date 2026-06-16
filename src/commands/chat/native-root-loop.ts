import type {
  ApprovalPolicy,
  ExecutionStrategy,
  TaskResult,
  TaskRunner,
} from "../../contracts/orchestration.js";
import type { RuntimeBootstrap } from "../../runtime/runtime-bootstrap.js";
import type { ChatLayout } from "./utils.js";
import { style } from "../../util/theme.js";
import { getRunArtifactPath } from "../../util/run-store.js";
import { runShell } from "../../util/shell.js";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { createDag, type Dag, type DagNode } from "../../orchestration/dag.js";
import {
  applyCapabilityInjectionToRouting,
  buildCapabilityInjection,
} from "../../runtime/capability-injection.js";
import { capabilityScopesFromRouting } from "../../orchestration/capability-routing.js";
import {
  decideToolAuthority,
  type ToolOp,
} from "../../safety/tool-authority-gate.js";
import { resolveToolAuthorityMode } from "../../runtime/tool-dispatch-contracts.js";
import {
  compileBloatToNlp,
  type DebloatRisk,
} from "../../runtime/debloat-nlp.js";
import {
  buildPromptEnvelope,
  renderPromptEnvelope,
} from "../../runtime/prompt-envelope.js";
import { buildTaskRunContext } from "../../runtime/worker-manifest.js";
import {
  buildInputEnvelope,
  normalizeMcpScope,
  type InputEnvelope,
  type InputSlashCommandEnvelope,
} from "../../input/input-envelope.js";
import { persistInputEnvelope } from "../../input/input-artifacts.js";
import { buildDagCompileResult } from "../../orchestration/dag-compiler.js";
import { persistDagCompileArtifacts } from "../../orchestration/dag-artifacts.js";
import { evidenceObservationsFromResult, evidenceRequirementsFromOutputs } from "../../runtime/contracts/evidence.js";
import { TerminalOwner } from "../../util/terminal-owner.js";
import { resumeInteractiveInput } from "../../util/terminal-input.js";
import type { CliRenderer } from "../../cli/ui/renderer.js";
import type { TaskRunContext } from "../../contracts/worker-context.js";
import { executeHarnessRun } from "../../harness/execute-harness-run.js";
import type { ProviderPolicy } from "../../providers/types.js";
import { normalizeProviderId, readProviderRegistry, type ProviderRegistryEntry } from "../../providers/model-registry.js";
import { renderProviderModelTable } from "../../providers/model-table.js";
import {
  ALL_PROVIDER_TAB,
  buildProviderTabs,
  createModelPickerState,
  debugModelTabs,
  handleModelPickerKey,
  initializeModelPickerState,
  normalizeProviderTab,
  providerTabIdForProvider,
} from "../../providers/model-tabs.js";
import { formatThinkingModelVariant, nextThinkingLevel, thinkingLevelsFor } from "../../providers/thinking-levels.js";
import { buildChatTurnDag } from "./chat-turn-dag.js";
import { createSlashCommandContext } from "./slash/context.js";
import { buildNativeChatSlashCommands } from "./slash/commands/index.js";
import { parseSlashInput, type ParsedSlashInput } from "./slash/parser.js";
import { createSlashCommandRegistry } from "./slash/registry.js";
import {
  emitSlashResult,
  okSlashResult,
  printSlashResult,
} from "./slash/result.js";
import type { OmkBrandThemeName, OmkTuiMotion } from "../../brand/theme.js";
import type { TuiView } from "../../tui/model.js";
import type {
  SlashCommandContext,
  SlashCommandResult,
  SlashCommandSpec,
} from "./slash/types.js";
import { LocalGraphMemoryStore } from "../../memory/local-graph-memory-store.js";

export interface NativeRootLoopInput {
  bootstrap: RuntimeBootstrap;
  taskRunner: TaskRunner;
  runId: string;
  root: string;
  rootSource?: string;
  activeCwd?: string;
  env: Record<string, string>;
  layout: ChatLayout;
  agentFile: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  workers?: number;
  executionPrompt?: string;
  renderer?: CliRenderer;
  onData?: (data: string) => void;
  onTodoSync?: (output: string) => void;
}

export interface NativeRootSessionState {
  bootstrap: RuntimeBootstrap;
  provider: string;
  model?: string;
  thinking?: string;
  approvalPolicy?: string;
  theme?: OmkBrandThemeName;
  view?: TuiView;
  animation?: OmkTuiMotion;
  modelPickerOpen?: boolean;
  thinkingPickerOpen?: boolean;
  activeProviderTab?: string;
  updatedAt?: string;
}

async function runSlashHandler(
  handler: SlashCommandSpec,
  parsed: ParsedSlashInput,
  ctx: SlashCommandContext,
  options: { suppressOutput?: boolean } = {},
): Promise<SlashCommandResult> {
  const result = await handler.handler(ctx, parsed.args);
  const normalized = result ?? okSlashResult();
  if (normalized.statePatch) Object.assign(ctx.state, normalized.statePatch);
  const visibleResult = options.suppressOutput
    ? { ...normalized, text: undefined, json: undefined, events: [] }
    : normalized;
  if (ctx.renderer) emitSlashResult(visibleResult, ctx.renderer);
  else printSlashResult(visibleResult);
  return normalized;
}

function isModelSlashCommand(parsed: ParsedSlashInput): boolean {
  return parsed.command === "/model" || parsed.command === "/m";
}

function isModelShowSlash(parsed: ParsedSlashInput): boolean {
  return isModelSlashCommand(parsed)
    && parsed.args.positional.length === 0
    && parsed.args.flags.json !== true;
}

function explicitProviderTabFromModelLine(
  line: string,
  providerIds: readonly string[],
): string | undefined {
  const trimmed = line.trim();
  if (!/^\/(?:model|m)(?:\s|$)/.test(trimmed)) {
    return undefined;
  }

  const tokens = trimmed.split(/\s+/);
  const rawArg = tokens[1];
  if (!rawArg) {
    return undefined;
  }

  const slashIndex = rawArg.indexOf("/");
  const providerPart = (slashIndex > 0 ? rawArg.slice(0, slashIndex) : rawArg)
    .split(":")[0]
    ?.trim()
    .toLowerCase();
  if (!providerPart) {
    return undefined;
  }

  const tabs = buildProviderTabs(providerIds);
  if (tabs.includes(providerPart)) {
    return providerPart;
  }

  const normalized = normalizeProviderId(providerPart);
  const normalizedTab = normalized === "auto" ? null : providerTabIdForProvider(normalized);
  if (normalizedTab && tabs.includes(normalizedTab)) {
    return normalizedTab;
  }

  return undefined;
}

function isModelPickerLine(line: string, state: NativeRootSessionState): boolean {
  const trimmed = line.trim();
  return /^\/(?:model|m)(?:\s|$)/.test(trimmed)
    || (state.modelPickerOpen === true && state.thinkingPickerOpen !== true && trimmed.length === 0);
}

function isThinkingPickerLine(line: string, state: NativeRootSessionState): boolean {
  const trimmed = line.trim();
  return (state.thinkingPickerOpen === true && trimmed.length === 0)
    || (state.modelPickerOpen !== true && trimmed.length === 0);
}

function isThinkingSlashCommand(parsed: ParsedSlashInput): boolean {
  return parsed.command === "/think" || parsed.command === "/thinking" || parsed.command === ":think";
}

function isThinkingShowSlash(parsed: ParsedSlashInput): boolean {
  return isThinkingSlashCommand(parsed)
    && parsed.args.positional.length === 0
    && parsed.args.flags.json !== true;
}

function isThinkingFollowupSlash(parsed: ParsedSlashInput): boolean {
  return parsed.command === "/model"
    || parsed.command === "/m"
    || parsed.command === "/use"
    || parsed.command === ":use";
}

function shouldOpenThinkingPickerAfterSlash(
  parsed: ParsedSlashInput,
  result: SlashCommandResult,
): boolean {
  if (!result.ok || !isThinkingFollowupSlash(parsed)) return false;
  if (parsed.args.positional.length === 0) return false;
  if (result.statePatch?.thinking) return false;
  return Boolean(result.statePatch?.model || result.statePatch?.provider || result.statePatch?.bootstrap);
}

function renderThinkingPickerText(state: NativeRootSessionState): string {
  const levels = thinkingLevelsFor(state.provider, state.model);
  const current = state.thinking;
  const levelLine = levels
    .map((level) => {
      const label = `${level === current ? "●" : "○"} ${level}`;
      if (level === current) return style.mintBold(label);
      if (level === "max" || level === "xhigh") return style.cyanBold(label);
      return style.gray(label);
    })
    .join(style.gray("  "));
  const active = current
    ? `${current} (${formatThinkingModelVariant(state.model, current)})`
    : "not selected";
  const firstLevel = levels[0] ?? "medium";
  return [
    style.phosphorBold("\n  OMK Thinking Control · choose level"),
    style.phosphorDim(`  Target: ${state.provider ?? "auto"}/${state.model ?? "auto"}`),
    `  ${levelLine}`,
    style.phosphorDim("  Press Tab on an empty prompt to cycle, or run /think <level>."),
    style.phosphorDim(`  Shortcut: /model ${state.provider ?? "auto"}/${state.model ?? "auto"}:${firstLevel}`),
    style.phosphorDim(`  Active: ${active}\n`),
  ].join("\n");
}

function canUseInteractiveThinkingSelector(
  input: NativeRootLoopInput,
  renderer?: CliRenderer,
): boolean {
  if (renderer) return false;
  if (isDisabledEnvValue(input.env.OMK_INTERACTIVE_THINKING_SELECT)) return false;
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

function applyThinkingLevelToNativeState(
  input: NativeRootLoopInput,
  state: NativeRootSessionState,
  level: string,
): void {
  state.thinking = level;
  state.thinkingPickerOpen = true;
  state.modelPickerOpen = false;
  state.updatedAt = new Date().toISOString();
  input.env.OMK_THINKING = level;
  input.env.OMK_MODEL_VARIANT = formatThinkingModelVariant(state.model, level);
}

async function promptThinkingSelection(
  input: NativeRootLoopInput,
  state: NativeRootSessionState,
  renderer?: CliRenderer,
): Promise<boolean> {
  if (!canUseInteractiveThinkingSelector(input, renderer)) return false;
  const levels = thinkingLevelsFor(state.provider, state.model);
  if (levels.length === 0) return false;
  try {
    const { select } = await import("@inquirer/prompts");
    const selected = await select<string>({
      message: `Select thinking level for ${state.provider ?? "auto"}/${state.model ?? "auto"}`,
      choices: levels.map((level) => ({
        value: level,
        name: `${level === state.thinking ? "● " : ""}${level}`,
        description: formatThinkingModelVariant(state.model, level),
      })),
      pageSize: Math.min(levels.length, 8),
      loop: true,
      default: state.thinking ?? input.env.OMK_THINKING ?? levels[0],
    }, {
      input: process.stdin,
      output: process.stderr,
      clearPromptOnDone: true,
    });
    applyThinkingLevelToNativeState(input, state, selected);
    process.stderr.write(style.phosphorDim(`\n  Thinking variant: ${selected}\n  Active: ${input.env.OMK_MODEL_VARIANT}\n`));
    return true;
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "Error";
    if (name === "ExitPromptError") {
      process.stderr.write(style.phosphorDim("\n  Thinking selection cancelled.\n"));
      return true;
    }
    return false;
  }
}

function countModelPickerRows(
  registry: readonly ProviderRegistryEntry[],
  activeProviderTab: string,
): number {
  return registry
    .filter((entry) => activeProviderTab === ALL_PROVIDER_TAB || providerTabIdForProvider(entry.id) === activeProviderTab)
    .reduce((count, entry) => count + 1 + Object.keys(entry.aliases).length, 0);
}

function isDisabledEnvValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

export function shouldRunNativeParallelTurn(
  executionPrompt: string | undefined,
): boolean {
  return executionPrompt?.trim().toLowerCase() === "parallel";
}

export function buildNativeParallelTurnArgs(input: NativeRootLoopInput, prompt: string): string[] {
  const args = ["dist/cli.js", "parallel", prompt, "--execution", "parallel", "--chat"];
  if (input.workers && input.workers > 0) {
    args.push("--workers", String(input.workers));
  }

  const provider = input.bootstrap.providerPolicy || input.bootstrap.provider;
  if (provider) {
    args.push("--provider", provider);
  }

  const model = input.env.OMK_MODEL_VARIANT
    ?? input.bootstrap.selectedModel
    ?? input.env.OMK_PROVIDER_MODEL
    ?? input.env.OMK_MODEL;
  if (model) {
    args.push("--model", model);
  }

  const mcpScope = input.env.OMK_MCP_SCOPE;
  if (mcpScope === "all" || mcpScope === "project" || mcpScope === "none") {
    args.push("--mcp-scope", mcpScope);
  }

  return args;
}

function buildNativeParallelTurnEnv(input: NativeRootLoopInput): Record<string, string> {
  return {
    ...input.env,
    OMK_PARALLEL_PARENT_RUN_ID: input.runId,
    OMK_PARALLEL_PARENT_MCP: (input.mcpAllowlist ?? []).join(","),
    OMK_PARALLEL_PARENT_SKILLS: (input.skillNames ?? []).join(","),
    OMK_PARALLEL_PARENT_HOOKS: (input.hookNames ?? []).join(","),
  };
}


async function runNativeParallelTurn(
  input: NativeRootLoopInput,
  prompt: string,
  renderer?: CliRenderer,
): Promise<number> {
  const normalizedPrompt = prompt.trim();
  const message = `\n  Spawning parallel: "${normalizedPrompt}"\n`;
  if (renderer) {
    renderer.emit({ type: "control:output", text: message });
  } else {
    console.log(style.phosphorDim(message));
  }
  const result = await runShell(
    process.execPath,
    buildNativeParallelTurnArgs(input, normalizedPrompt),
    {
      cwd: input.root,
      env: buildNativeParallelTurnEnv(input),
      stdio: "inherit",
      timeout: 300000,
    },
  );
  if (result.failed) {
    const errorMessage = `Parallel exited with code ${result.exitCode}`;
    if (renderer) {
      renderer.emit({ type: "turn:error", message: errorMessage });
    } else {
      console.log(style.metricsRed(errorMessage));
    }
  }
  return result.exitCode ?? (result.failed ? 1 : 0);
}

function nativeApprovalPolicy(
  executionPrompt: string | undefined,
): ApprovalPolicy {
  const normalized = executionPrompt?.trim().toLowerCase();
  switch (normalized) {
    case "block":
      return "block";
    case "yolo":
      return "yolo";
    case "auto":
    case "parallel":
    case "sequential":
      return "auto";
    case "ask":
    default:
      return "interactive";
  }
}

function nativeExecutionStrategy(
  executionPrompt: string | undefined,
): ExecutionStrategy | undefined {
  const normalized = executionPrompt?.trim().toLowerCase();
  if (normalized === "sequential" || normalized === "parallel")
    return normalized;
  return undefined;
}

function bootstrapProviderPolicy(bootstrap: RuntimeBootstrap): ProviderPolicy {
  const raw = (bootstrap.providerPolicy || bootstrap.provider || "auto")
    .trim()
    .toLowerCase();
  switch (raw) {
    case "auto":
    case "authority":
    case "codex":
    case "commandcode":
    case "deepseek":
    case "kimi":
    case "local-llm":
    case "mimo":
    case "opencode":
    case "openrouter":
    case "qwen":
      return raw;
    case "local":
    case "llama":
      return "local-llm";
    default:
      return "auto";
  }
}

function nativeTurnRiskToToolOp(risk: string | undefined): ToolOp {
  switch (risk) {
    case "merge":
      return "merge";
    case "shell":
      return "shell";
    case "write":
      return "write";
    default:
      return "read";
  }
}

interface NativeTurnToolAuthorityRecord {
  readonly mode: "shadow" | "warn" | "enforce";
  readonly op: ToolOp;
  readonly decision: "allow" | "ask" | "block";
  readonly enforced: boolean;
  readonly reason: string;
}

/**
 * Turn-level tool-authority checkpoint. Shadow mode records only when tracing is
 * enabled, warn mode emits a diagnostic, and enforce mode fail-closes block/ask
 * verdicts before dispatching the native turn.
 */
function recordNativeTurnToolAuthority(input: {
  node: DagNode;
  env: Record<string, string>;
  renderer?: CliRenderer;
}): NativeTurnToolAuthorityRecord {
  const routing = input.node.routing;
  const scopes = capabilityScopesFromRouting(routing);
  const op = nativeTurnRiskToToolOp(routing?.risk);
  const mode = resolveToolAuthorityMode(input.env);
  const decision = decideToolAuthority({
    op,
    writeAuthority: scopes.writeAuthority,
    shellAuthority: scopes.shellAuthority,
    approvalPolicy: nativeApprovalPolicy(
      routing?.approvalPolicy ?? routing?.executionPrompt,
    ),
    sandboxMode:
      routing?.sandboxMode === "read-only" ? "read-only" : "workspace-write",
    tty: Boolean(process.stdout.isTTY),
  });
  const enforced = mode === "enforce" && decision !== "allow";
  const reason =
    `tool-authority ${decision} for ${op} op ` +
    `(write=${scopes.writeAuthority}, shell=${scopes.shellAuthority}, ` +
    `sandbox=${routing?.sandboxMode ?? "auto"}, mode=${mode})`;
  const traceEnabled =
    mode !== "shadow" ||
    input.env.OMK_DEBUG === "1" ||
    /^(1|true|yes|on)$/i.test(input.env.OMK_TOOL_AUTHORITY_TRACE ?? "");
  if (traceEnabled) {
    const line = `  ${reason}${enforced ? " [enforced]" : ""}\n`;
    if (input.renderer) {
      input.renderer.emit({ type: "control:output", text: style.phosphorDim(line) });
    } else {
      process.stderr.write(style.phosphorDim(line));
    }
  }
  return { mode, op, decision, enforced, reason };
}

function emitNativeTurnRoute(input: {
  node: DagNode;
  env: Record<string, string>;
  heartbeatEnabled: boolean;
  renderer?: CliRenderer;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
}): void {
  if (!input.heartbeatEnabled) return;
  const routing = input.node.routing;
  if (input.renderer) {
    input.renderer.emit({
      type: "turn:route",
      provider: routing?.provider ?? "auto",
      model: routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL,
      risk: String(routing?.risk ?? "read"),
      sandbox: String(routing?.sandboxMode ?? "auto"),
      mcp: input.mcpAllowlist,
      skills: input.skillNames,
      hooks: input.hookNames,
    });
    return;
  }
  process.stderr.write(
    style.phosphorDim(
      `  routing: provider=${routing?.provider ?? "auto"} model=${routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL ?? "auto"} risk=${routing?.risk ?? "read"} sandbox=${routing?.sandboxMode ?? "auto"}\n`,
    ),
  );
}

export function createNativeRootSessionState(input: {
  bootstrap: RuntimeBootstrap;
  executionPrompt?: string;
}): NativeRootSessionState {
  return {
    bootstrap: input.bootstrap,
    provider: input.bootstrap.provider,
    model: input.bootstrap.selectedModel,
    approvalPolicy: input.executionPrompt,
    theme: "system24",
    view: "summary",
  };
}

function buildNativeInputEnvelope(input: {
  loopInput: NativeRootLoopInput;
  state: NativeRootSessionState;
  line: string;
  parsedSlash?: ParsedSlashInput;
}): InputEnvelope {
  return buildInputEnvelope({
    runId: input.loopInput.runId,
    kind: input.parsedSlash ? "slash-command" : "plain-prompt",
    raw: input.line,
    source: "chat",
    cwd: input.loopInput.activeCwd ?? process.cwd(),
    root: input.loopInput.root,
    rootSource: input.loopInput.rootSource,
    provider: input.state.provider,
    model: input.state.model,
    mcpScope: normalizeMcpScope(input.loopInput.env.OMK_MCP_SCOPE),
    ui: input.loopInput.env.OMK_UI ?? input.loopInput.env.OMK_CHAT_UI,
    view: input.state.view ?? input.loopInput.env.OMK_TUI_VIEW,
    theme: input.state.theme,
    constraints: [],
    requestedArtifacts: [],
    slashCommand: input.parsedSlash
      ? slashCommandToEnvelope(input.parsedSlash)
      : undefined,
  });
}

function slashCommandToEnvelope(
  parsed: ParsedSlashInput,
): InputSlashCommandEnvelope {
  const flags: Record<string, boolean | string | string[]> = {};
  for (const [key, value] of Object.entries(parsed.args.flags)) {
    if (Array.isArray(value)) flags[key] = [...(value as readonly string[])];
    else if (typeof value === "boolean" || typeof value === "string")
      flags[key] = value;
  }
  return {
    command: parsed.command,
    argv: [...parsed.args.argv],
    positional: [...parsed.args.positional],
    flags,
  };
}

async function persistNativeInputEnvelope(input: {
  envelope: InputEnvelope;
  root: string;
  renderer?: CliRenderer;
}): Promise<void> {
  try {
    await persistInputEnvelope(input.envelope, { root: input.root });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const text = `InputEnvelope artifact write failed: ${message}`;
    if (input.renderer)
      input.renderer.emit({ type: "turn:error", message: text });
    else process.stderr.write(style.metricsRed(text) + "\n");
  }
}

async function persistNativeDagCompileArtifacts(input: {
  envelope: InputEnvelope;
  dag: Dag;
  root: string;
  workerCount: number;
  executionStrategy: ExecutionStrategy;
  explanation: string;
  renderer?: CliRenderer;
}): Promise<void> {
  try {
    await persistDagCompileArtifacts(
      buildDagCompileResult({
        input: input.envelope,
        dag: input.dag,
        workerCount: input.workerCount,
        executionStrategy: input.executionStrategy,
        explanation: input.explanation,
      }),
      { root: input.root },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const text = `DAG compile artifact write failed: ${message}`;
    if (input.renderer)
      input.renderer.emit({ type: "turn:error", message: text });
    else process.stderr.write(style.metricsRed(text) + "\n");
  }
}

export type NativeTurnRisk = "read" | "write" | "shell" | "merge" | "ask";

export interface NativeTurnRiskTrace {
  readonly risk: NativeTurnRisk;
  readonly confidence: number;
  readonly matchedSignal: string;
  readonly readOnlyOverride: boolean;
}

const API_ADVISORY_PROVIDERS = new Set([
  "deepseek",
  "kimi",
  "local-llm",
  "mimo",
  "openrouter",
  "qwen",
]);

function hasExplicitReadOnlyConstraint(text: string): boolean {
  return (
    /\b(without changing|without editing|do not change|don't change|do not edit|don't edit|no edits?|no file changes?|read[- ]only)\b/.test(
      text,
    ) ||
    /읽기\s*전용|수정하지\s*말|변경하지\s*말|파일\s*(수정|변경)\s*(없이|하지\s*말)|검토만|분석만/.test(
      text,
    )
  );
}

function hasReadOnlyIntent(text: string): boolean {
  return (
    /\b(read|inspect|look|show|list|summarize|explain|describe|review|audit|status|diagnose)\b/.test(
      text,
    ) ||
    /요약|설명|상태|검토|분석|읽어|살펴/.test(text)
  );
}

export function inferNativeTurnRisk(prompt: string): NativeTurnRiskTrace {
  const text = prompt.toLowerCase();
  if (hasExplicitReadOnlyConstraint(text)) {
    return { risk: "read", confidence: 0.95, matchedSignal: "explicit-read-only-constraint", readOnlyOverride: true };
  }
  if (
    /\b(push|publish|release|merge|tag|deploy)\b|푸시|퍼블리시|릴리즈|머지|배포/.test(
      text,
    )
  )
    return { risk: "merge", confidence: 0.9, matchedSignal: "merge/release-keyword", readOnlyOverride: false };
  if (
    /\b(run|test|build|exec|execute|shell|terminal|command|npm|pnpm|yarn|bun|pytest|cargo|go test|tsc|lint|verify|check)\b|테스트|빌드|실행|검증|쉘|터미널/.test(
      text,
    )
  )
    return { risk: "shell", confidence: 0.85, matchedSignal: "shell/execution-keyword", readOnlyOverride: false };
  if (
    /\b(fix|edit|write|implement|modify|patch|refactor|add|create|delete|update|change)\b|수정|구현|패치|리팩터|추가|삭제|변경/.test(
      text,
    )
  )
    return { risk: "write", confidence: 0.85, matchedSignal: "write/modify-keyword", readOnlyOverride: false };
  if (hasReadOnlyIntent(text)) return { risk: "read", confidence: 0.75, matchedSignal: "read-only-intent", readOnlyOverride: false };
  return { risk: "ask", confidence: 0.5, matchedSignal: "no-clear-signal", readOnlyOverride: false };
}

function nativeTurnRoutingPolicy(
  provider: string,
  risk: NativeTurnRisk,
): {
  capabilities: string[];
  readOnly: boolean;
  sandboxMode: "read-only" | "workspace-write";
  providerReasonSuffix?: string;
} {
  if (isApiAdvisoryProvider(provider) && risk !== "read") {
    return {
      capabilities: ["read", "review", "advisory"],
      readOnly: true,
      sandboxMode: "read-only",
      providerReasonSuffix: `; ${provider} API is advisory/read-only for ${risk} intent; OMK owns write, shell, MCP, and merge authority`,
    };
  }
  if (risk === "read" || risk === "ask") {
    return { capabilities: ["read"], readOnly: true, sandboxMode: "read-only" };
  }
  if (risk === "write") {
    return {
      capabilities: ["write", "patch"],
      readOnly: false,
      sandboxMode: "workspace-write",
    };
  }
  if (risk === "merge") {
    return {
      capabilities: ["write", "patch", "shell", "merge"],
      readOnly: false,
      sandboxMode: "workspace-write",
    };
  }
  return {
    capabilities: ["write", "patch", "shell"],
    readOnly: false,
    sandboxMode: "workspace-write",
  };
}

function isApiAdvisoryProvider(provider: string): boolean {
  return API_ADVISORY_PROVIDERS.has(provider);
}

function hashPrompt(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function redactedPromptLabel(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim().replace(/(sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|[A-Za-z0-9+/]{32,}=*)/g, "[redacted]");
  const summary = compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
  return summary ? `native turn: ${summary}` : "native turn";
}

function writePrivatePromptArtifact(input: {
  runId: string;
  nodeId: string;
  promptHash: string;
  userPrompt: string;
  compiledPrompt: string;
}): string | undefined {
  try {
    const rel = `private/prompts/${sanitizeRunIdForPath(input.nodeId)}.json`;
    const artifact = getRunArtifactPath(input.runId, rel);
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, JSON.stringify({
      schemaVersion: "omk.prompt-envelope.v1",
      nodeId: input.nodeId,
      runId: input.runId,
      promptHash: input.promptHash,
      userPrompt: input.userPrompt,
      compiledPrompt: input.compiledPrompt,
      redaction: "private-run-artifact",
      timestamp: new Date().toISOString(),
    }, null, 2), "utf-8");
    return rel;
  } catch {
    return undefined;
  }
}

function debloatRiskFromNativeTurnRisk(risk: NativeTurnRisk): DebloatRisk {
  if (risk === "read" || risk === "ask") return "read";
  if (risk === "write") return "write";
  return "dangerous";
}

function nativeTurnRequiresEvidence(risk: NativeTurnRisk): boolean {
  return risk === "write" || risk === "shell" || risk === "merge";
}

function nativeEvidenceOutputForRisk(risk: NativeTurnRisk): DagNode["outputs"] {
  if (!nativeTurnRequiresEvidence(risk)) return undefined;
  if (risk === "shell") {
    return [{ name: "command evidence", gate: "command-pass", required: true }];
  }
  if (risk === "merge") {
    return [{ name: "release evidence", ref: "## Evidence", gate: "summary", required: true }];
  }
  return [{ name: "change evidence", ref: "## Evidence", gate: "summary", required: true }];
}

export function buildNativeRootLoopTurnNode(input: {
  bootstrap: RuntimeBootstrap;
  prompt: string;
  nodeId?: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  executionPrompt?: string;
  runId?: string;
}): DagNode {
  const id = input.nodeId ?? `turn-${Date.now()}`;
  const riskTrace = inferNativeTurnRisk(input.prompt);
  let turnRisk = riskTrace.risk;
  // Low-confidence prompts fall back to ask/read-only to preserve safety.
  if (riskTrace.confidence < 0.6 && turnRisk !== "read") {
    turnRisk = "ask";
  }
  const evidenceRequired = nativeTurnRequiresEvidence(turnRisk);
  const routingPolicy = nativeTurnRoutingPolicy(
    input.bootstrap.provider,
    turnRisk,
  );
  const capabilityInjection = buildCapabilityInjection({
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
  });
  const envelope = buildPromptEnvelope({
    bootstrap: input.bootstrap,
    prompt: input.prompt,
    capabilities: capabilityInjection,
    role: "root-coordinator",
    nodeId: id,
    executionPrompt: input.executionPrompt,
    turnRisk,
    sandboxMode: routingPolicy.sandboxMode,
  });
  const rawEnvelope = renderPromptEnvelope(envelope);
  const compiled = compileBloatToNlp({
    rawText: rawEnvelope,
    provider: input.bootstrap.provider,
    model: input.bootstrap.selectedModel ?? "auto",
    userPayload: input.prompt,
    risk: debloatRiskFromNativeTurnRisk(turnRisk),
    sandbox: routingPolicy.sandboxMode,
    executionSelection: input.executionPrompt,
    role: "coordinator",
    evidenceRequired,
    capabilityEnvelope: {
      mcpEnabled: capabilityInjection.mcpServers,
      skillsEnabled: capabilityInjection.skills,
      toolsEnabled: capabilityInjection.tools.length > 0,
      liveRequired: capabilityInjection.requiresMcp,
    },
  });
  const selectedMcp = [
    ...compiled.runtimeSidecar.requiredMcp,
    ...compiled.runtimeSidecar.optionalMcp,
  ];
  const selectedCapabilityInjection = buildCapabilityInjection({
    mcpAllowlist: selectedMcp,
    skillNames: compiled.runtimeSidecar.selectedSkills,
    hookNames: input.hookNames,
    tools: capabilityInjection.tools,
    requireMcp: !isApiAdvisoryProvider(input.bootstrap.provider)
      && compiled.runtimeSidecar.requiredMcp.length > 0,
    requiresToolCalling: capabilityInjection.requiresToolCalling,
  });
  const promptHash = hashPrompt(compiled.modelPrompt);
  const promptPayloadRef = input.runId
    ? writePrivatePromptArtifact({ runId: input.runId, nodeId: id, promptHash, userPrompt: input.prompt, compiledPrompt: compiled.modelPrompt })
    : undefined;

  return {
    id,
    name: redactedPromptLabel(input.prompt),
    role: "coordinator",
    dependsOn: [],
    status: "running",
    retries: 0,
    maxRetries: 1,
    outputs: nativeEvidenceOutputForRisk(turnRisk),
    routing: applyCapabilityInjectionToRouting(
      {
        provider: input.bootstrap.provider,
        providerModel: input.bootstrap.selectedModel,
        providerReason: `native-root-loop selected ${input.bootstrap.selectedRuntimeId ?? input.bootstrap.sessionMode}${routingPolicy.providerReasonSuffix ?? ""}`,
        assignedProviderCapabilities: routingPolicy.capabilities,
        contextBudget: "normal",
        readOnly: routingPolicy.readOnly,
        risk: turnRisk,
        riskTrace,
        evidenceRequired,
        promptMode: promptPayloadRef ? "structured-private" : "dnc-nlp",
        promptHash,
        ...(promptPayloadRef && { promptPayloadRef, promptPayloadPrivate: true }),
        runtimeSidecar: {
          ...compiled.runtimeSidecar,
          requiredMcp: [...compiled.runtimeSidecar.requiredMcp],
          optionalMcp: [...compiled.runtimeSidecar.optionalMcp],
          disabledMcp: [...compiled.runtimeSidecar.disabledMcp],
          selectedSkills: [...compiled.runtimeSidecar.selectedSkills],
        },
        executionPrompt: input.executionPrompt,
        approvalPolicy: input.executionPrompt,
        sandboxMode: routingPolicy.sandboxMode,
        rationale: `native-root-loop DNC intent=${compiled.runtimeSidecar.intent}; selected MCP=${selectedMcp.length}; selected skills=${compiled.runtimeSidecar.selectedSkills.length}; optional failures follow required-only policy`,
      },
      selectedCapabilityInjection,
    ),
  };
}

async function writeTurnRoutingArtifact(
  runId: string,
  node: DagNode,
  runContext?: { runId?: string; worker?: { owner?: string } },
): Promise<{ error?: string } | undefined> {
  const artifact = getRunArtifactPath(runId, `turns/${sanitizeRunIdForPath(node.id)}-routing.json`);
  const payload = {
    schemaVersion: "omk.native-turn.routing.v1" as const,
    nodeId: node.id,
    runId,
    workerRunId: runContext?.runId,
    workerOwner: runContext?.worker?.owner,
    routing: node.routing,
    outputs: node.outputs,
    timestamp: new Date().toISOString(),
  };
  try {
    await mkdir(dirname(artifact), { recursive: true });
    await writeFile(artifact, JSON.stringify(payload, null, 2), "utf-8");
    return undefined;
  } catch (err) {
    // Non-fatal: artifact write failures must not block turn execution, but must be observable.
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function appendTurnResultArtifact(
  runId: string,
  node: DagNode,
  result: TaskResult,
): Promise<{ error?: string; artifact?: string } | undefined> {
  const artifact = getRunArtifactPath(runId, `turns/${sanitizeRunIdForPath(node.id)}-result.jsonl`);
  const payload = {
    schemaVersion: "omk.native-turn.result.v1" as const,
    nodeId: node.id,
    runId,
    exitCode: result.exitCode,
    success: result.success,
    evidenceRequired: result.metadata?.evidenceRequired,
    timestamp: new Date().toISOString(),
  };
  try {
    await mkdir(dirname(artifact), { recursive: true });
    await appendFile(artifact, `${JSON.stringify(payload)}\n`, "utf-8");
    return { artifact };
  } catch (err) {
    // Non-fatal: artifact write failures must not block turn execution, but must be observable.
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function sanitizeRunIdForPath(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64);
}

async function sha256File(path: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return undefined;
  }
}

interface ReplayIndexArtifact {
  readonly path: string;
  readonly sha256?: string;
  readonly kind: string;
  readonly updatedAt: string;
}

interface ReplayIndexFile {
  readonly schemaVersion: "omk.replay-index.v1";
  readonly runId: string;
  readonly updatedAt: string;
  readonly artifacts: readonly ReplayIndexArtifact[];
}

function parseReplayIndex(raw: string, runId: string): ReplayIndexFile {
  try {
    const parsed = JSON.parse(raw) as Partial<ReplayIndexFile>;
    if (parsed.schemaVersion !== "omk.replay-index.v1" || parsed.runId !== runId || !Array.isArray(parsed.artifacts)) {
      throw new Error("invalid replay index");
    }
    return {
      schemaVersion: "omk.replay-index.v1",
      runId,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      artifacts: parsed.artifacts.filter((artifact): artifact is ReplayIndexArtifact =>
        Boolean(artifact && typeof artifact.path === "string" && typeof artifact.kind === "string")
      ),
    };
  } catch {
    return { schemaVersion: "omk.replay-index.v1", runId, updatedAt: new Date().toISOString(), artifacts: [] };
  }
}

async function upsertReplayIndexArtifact(input: {
  readonly replayIndexPath: string;
  readonly runId: string;
  readonly artifactPath: string;
  readonly artifactHash?: string;
  readonly artifactKind: string;
}): Promise<void> {
  const now = new Date().toISOString();
  let existing: ReplayIndexFile = { schemaVersion: "omk.replay-index.v1", runId: input.runId, updatedAt: now, artifacts: [] };
  try {
    existing = parseReplayIndex(await readFile(input.replayIndexPath, "utf-8"), input.runId);
  } catch {
    // Missing replay index is expected for the first turn.
  }
  const artifacts = existing.artifacts.filter((artifact) => artifact.path !== input.artifactPath);
  artifacts.push({ path: input.artifactPath, sha256: input.artifactHash, kind: input.artifactKind, updatedAt: now });
  await writeFile(input.replayIndexPath, JSON.stringify({
    schemaVersion: "omk.replay-index.v1",
    runId: input.runId,
    updatedAt: now,
    artifacts,
  }, null, 2), "utf-8");
}

async function recordTurnAuditGraph(input: {
  root: string;
  runId: string;
  node: DagNode;
  result: TaskResult;
  resultArtifact?: string;
}): Promise<void> {
  try {
    const artifactHash = input.resultArtifact ? await sha256File(input.resultArtifact) : undefined;
    const replayIndex = getRunArtifactPath(input.runId, "replay-index.json", input.root);
    await mkdir(dirname(replayIndex), { recursive: true });
    if (input.resultArtifact) {
      await upsertReplayIndexArtifact({
        replayIndexPath: replayIndex,
        runId: input.runId,
        artifactPath: input.resultArtifact,
        artifactHash,
        artifactKind: "turn-result",
      });
    }

    const store = await LocalGraphMemoryStore.create({ projectRoot: input.root, sessionId: input.runId, source: "native-root-loop-audit" });
    await store?.materializeTurnAudit({
      runId: input.runId,
      nodeId: input.node.id,
      provider: String(input.node.routing?.provider ?? "auto"),
      selectedRuntime: typeof input.result.metadata?.selectedRuntime === "string"
        ? input.result.metadata.selectedRuntime
        : typeof input.result.metadata?.runtime === "string"
          ? input.result.metadata.runtime
          : undefined,
      fallbackChain: Array.isArray(input.result.metadata?.fallbackChain)
        ? input.result.metadata.fallbackChain.filter((entry): entry is string => typeof entry === "string")
        : undefined,
      evidenceKind: input.result.success ? "turn-result-pass" : "turn-result-fail",
      evidenceArtifactPath: input.resultArtifact,
      evidenceHash: artifactHash,
      evidenceRequirements: evidenceRequirementsFromOutputs(input.node.outputs),
      evidenceObservations: evidenceObservationsFromResult({
        metadata: input.result.metadata,
        stdout: input.result.stdout,
        artifactPaths: input.resultArtifact ? [input.resultArtifact] : [],
      }),
    });
  } catch {
    // Best-effort audit graph materialization must not block turn completion.
  }
}

function runtimeSidecarIntent(node: DagNode): string | undefined {
  const sidecar = node.routing?.runtimeSidecar;
  if (!sidecar || typeof sidecar !== "object") return undefined;
  const intent = (sidecar as { intent?: unknown }).intent;
  return typeof intent === "string" && intent.trim().length > 0 ? intent : undefined;
}

function describeNativeTurnActivity(node: DagNode): string {
  const intent = runtimeSidecarIntent(node);
  const risk = node.routing?.risk;
  const provider = node.routing?.provider ?? "auto";
  const mcpCount = node.routing?.mcpServers?.length ?? 0;
  const skillCount = node.routing?.skills?.length ?? 0;
  const intentPart = intent ? intent.replace(/_/g, " ") : "agent turn";
  const guardPart = risk && risk !== "read" ? `${risk} gate` : "evidence gate";
  const scopePart = mcpCount > 0 || skillCount > 0
    ? `${mcpCount} MCP/${skillCount} skills`
    : "local ctx";
  return `${intentPart} · ${guardPart} · ${scopePart} · ${provider}`;
}

export async function executeNativeRootTurn(input: {
  taskRunner: TaskRunner;
  node: DagNode;
  env: Record<string, string>;
  signal: AbortSignal;
  heartbeatEnabled: boolean;
  renderer?: CliRenderer;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  runContext?: TaskRunContext;
}): Promise<TaskResult> {
  const startedAt = Date.now();
  const routing = input.node.routing;
  const activity = describeNativeTurnActivity(input.node);
  emitNativeTurnRoute(input);
  const authorityRecord = recordNativeTurnToolAuthority({ node: input.node, env: input.env, renderer: input.renderer });
  if (authorityRecord.enforced) {
    const message = `${authorityRecord.reason}; native turn dispatch blocked`;
    if (input.renderer) {
      input.renderer.emit({ type: "turn:error", message });
    } else {
      process.stderr.write(style.metricsRed(message) + "\n");
    }
    return {
      success: false,
      exitCode: 78,
      stdout: "",
      stderr: message,
      metadata: {
        code: "TOOL_AUTHORITY_BLOCKED",
        nodeId: input.node.id,
        op: authorityRecord.op,
        decision: authorityRecord.decision,
        authorityMode: authorityRecord.mode,
      },
    };
  }

  let heartbeatPrinted = false;
  let heartbeatLineClosed = false;
  const heartbeat = input.heartbeatEnabled
    ? setInterval(() => {
        heartbeatPrinted = true;
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        if (input.renderer) {
          input.renderer.emit({
            type: "turn:heartbeat",
            elapsedMs: sec * 1000,
            provider: routing?.provider ?? "auto",
            model: routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL,
            activity,
          });
        } else {
          process.stderr.write(
            style.phosphorDim(
              `\r  ${activity} · ${sec}s · model=${routing?.providerModel ?? input.env.OMK_PROVIDER_MODEL ?? "auto"}   `,
            ),
          );
        }
      }, 3000)
    : undefined;
  heartbeat?.unref?.();

  const diagnostics: { routingWrite?: string; resultWrite?: string } = {};
  try {
    const turnRunId = input.env.OMK_RUN_ID ?? input.runContext?.goal.runId ?? input.node.id;
    const routingWrite = await writeTurnRoutingArtifact(turnRunId, input.node, input.runContext);
    if (routingWrite?.error) diagnostics.routingWrite = routingWrite.error;
    const result = await input.taskRunner.run(
      input.node,
      input.env,
      input.signal,
      input.runContext,
    );
    const resultWrite = await appendTurnResultArtifact(turnRunId, input.node, result);
    if (resultWrite?.error) diagnostics.resultWrite = resultWrite.error;
    await recordTurnAuditGraph({
      root: input.env.OMK_PROJECT_ROOT ?? process.cwd(),
      runId: turnRunId,
      node: input.node,
      result,
      resultArtifact: resultWrite?.artifact,
    });
    if (Object.keys(diagnostics).length > 0) {
      result.metadata = {
        ...(result.metadata ?? {}),
        artifactWriteDiagnostics: diagnostics,
      };
    }
    if (input.heartbeatEnabled) {
      const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (input.renderer) {
        heartbeatLineClosed = true;
      } else {
        if (heartbeatPrinted) {
          process.stderr.write("\n");
          heartbeatLineClosed = true;
        }
        process.stderr.write(
          style.phosphorDim(
            `  finished in ${sec}s · exit=${result.exitCode}\n`,
          ),
        );
      }
    }
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (heartbeatPrinted && !heartbeatLineClosed && !input.renderer)
      process.stderr.write("\n");
  }
}

async function buildNativeRootLoopTurnDag(input: {
  bootstrap: RuntimeBootstrap;
  prompt: string;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  executionPrompt?: string;
  workers?: number;
  runId?: string;
}): Promise<Dag> {
  const dag = await buildChatTurnDag({
    prompt: input.prompt,
    runId: "native-chat-turn",
    providerPolicy: bootstrapProviderPolicy(input.bootstrap),
    providerModel: input.bootstrap.selectedModel,
    workerCount: input.workers,
    executionStrategy: nativeExecutionStrategy(input.executionPrompt),
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
  });

  if (dag.nodes.length !== 1) return dag;

  const node = buildNativeRootLoopTurnNode({
    bootstrap: input.bootstrap,
    prompt: input.prompt,
    nodeId: dag.nodes[0]?.id,
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
    executionPrompt: input.executionPrompt,
    runId: input.runId,
  });
  return createDag({ nodes: [node] });
}

function combineNativeHarnessResults(
  success: boolean,
  completed: Array<{ node: DagNode; result: TaskResult }>,
): TaskResult {
  const last = completed.at(-1)?.result;
  const stdout = completed
    .map(({ result }) => result.stdout)
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
  const stderr = completed
    .map(({ result }) => result.stderr)
    .filter((text): text is string => Boolean(text))
    .join("\n");
  return {
    success,
    exitCode: success ? 0 : (last?.exitCode ?? 1),
    stdout,
    stderr,
    metadata: {
      ...(last?.metadata ?? {}),
      harness: "dag-executor",
      completedNodes: completed.length,
    },
  };
}

async function executeNativeRootHarnessTurn(input: {
  taskRunner: TaskRunner;
  bootstrap: RuntimeBootstrap;
  prompt: string;
  runId: string;
  root: string;
  env: Record<string, string>;
  signal: AbortSignal;
  heartbeatEnabled: boolean;
  renderer?: CliRenderer;
  mcpAllowlist?: readonly string[];
  skillNames?: readonly string[];
  hookNames?: readonly string[];
  workers?: number;
  executionPrompt?: string;
  inputEnvelope?: InputEnvelope;
}): Promise<TaskResult> {
  const dag = await buildNativeRootLoopTurnDag({
    bootstrap: input.bootstrap,
    prompt: input.prompt,
    mcpAllowlist: input.mcpAllowlist,
    skillNames: input.skillNames,
    hookNames: input.hookNames,
    executionPrompt: input.executionPrompt,
    workers: input.workers,
    runId: input.runId,
  });
  const completed: Array<{ node: DagNode; result: TaskResult }> = [];
  const workerCount = Math.max(1, input.workers ?? 1);
  const executionStrategy =
    nativeExecutionStrategy(input.executionPrompt) ?? "sequential";

  if (input.inputEnvelope) {
    await persistNativeDagCompileArtifacts({
      envelope: input.inputEnvelope,
      dag,
      root: input.root,
      workerCount,
      executionStrategy,
      explanation: "native chat turn compiled for shared harness execution",
      renderer: input.renderer,
    });
  }

  const run = await executeHarnessRun({
    root: input.root,
    runId: input.runId,
    dag,
    runner: input.taskRunner,
    env: input.env,
    workers: workerCount,
    approvalPolicy: nativeApprovalPolicy(input.executionPrompt),
    signal: input.signal,
    onNodeStart: (node) => {
      emitNativeTurnRoute({
        node,
        env: input.env,
        heartbeatEnabled: input.heartbeatEnabled,
        renderer: input.renderer,
        mcpAllowlist: node.routing?.mcpServers ?? input.mcpAllowlist,
        skillNames: node.routing?.skills ?? input.skillNames,
        hookNames: node.routing?.hooks ?? input.hookNames,
      });
      recordNativeTurnToolAuthority({ node, env: input.env, renderer: input.renderer });
    },
    onNodeComplete: (node, result) => {
      completed.push({ node, result });
    },
  });

  const result = combineNativeHarnessResults(run.success, completed);
  result.metadata = {
    ...(result.metadata ?? {}),
    runId: run.state.runId,
    nodeCount: run.state.nodes.length,
    failedNodes: run.state.nodes.filter(
      (node) => node.status === "failed" || node.status === "blocked",
    ).length,
  };
  return result;
}

export async function runNativeOmkRootLoop(
  input: NativeRootLoopInput,
): Promise<number> {
  const { taskRunner, layout, onData } = input;
  const renderer = input.renderer;
  const turnTimeoutMs = Number.parseInt(
    input.env.OMK_TURN_TIMEOUT_MS ?? "120000",
    10,
  );
  const safeTurnTimeoutMs =
    Number.isFinite(turnTimeoutMs) && turnTimeoutMs > 0
      ? turnTimeoutMs
      : 120_000;
  const state = createNativeRootSessionState({
    bootstrap: input.bootstrap,
    executionPrompt: input.executionPrompt,
  });
  const slashRegistry = createSlashCommandRegistry(
    buildNativeChatSlashCommands(),
  );
  const slashContext = createSlashCommandContext(input, state, {
    runParallelTurn: (prompt, activeRenderer) =>
      runNativeParallelTurn(input, prompt, activeRenderer),
  });

  await renderer?.start();
  renderer?.emit({
    type: "session:start",
    runId: input.runId,
    provider: state.provider,
    model: state.model,
    layout,
    root: input.root,
    cwd: input.activeCwd,
    rootSource: input.rootSource,
    brandLabel: input.env.OMK_ENTRY_DISPLAY_NAME,
  });

  // opencode-style: banner handled by PlainModernRenderer session:start event

  const modelProviderRegistry = await readProviderRegistry({ env: input.env }).catch((): ProviderRegistryEntry[] => []);
  const modelProviderIds = modelProviderRegistry.map((entry) => entry.id);
  const modelPickerState = createModelPickerState(ALL_PROVIDER_TAB);
  const renderModelPicker = (key?: string, previousActiveProviderTab?: string): void => {
    const tabs = buildProviderTabs(modelProviderIds);
    const activeProviderTab = normalizeProviderTab(
      modelPickerState.activeProviderTab,
      tabs,
    );
    debugModelTabs({
      providerIds: modelProviderIds,
      tabs,
      activeProviderTab: previousActiveProviderTab ?? activeProviderTab,
      key,
      nextProviderTab: previousActiveProviderTab ? activeProviderTab : undefined,
      runtimeProvider: state.provider,
      runtimeModel: state.model,
      visibleRowCount: countModelPickerRows(modelProviderRegistry, activeProviderTab),
    });
    const text = renderProviderModelTable(modelProviderRegistry, {
      currentProvider: state.provider,
      currentModel: state.model,
      currentThinking: state.thinking,
      activeProviderTab,
    });
    if (renderer) renderer.emit({ type: "control:output", text });
    else process.stdout.write(`${text}\n`);
  };
  const renderThinkingPicker = (): void => {
    const text = renderThinkingPickerText(state);
    if (renderer) renderer.emit({ type: "control:output", text });
    else process.stdout.write(`${text}\n`);
  };

  // Defensive stdin re-validation before the chat readline takes ownership.
  // The first-run GitHub-star / update prompts (@inquirer/prompts) can take
  // over raw mode and leave the shared interactive stdin paused; a paused TTY
  // makes the readline below see an immediate EOF/'close' and exit the loop
  // with "Session ended". This only resumes an explicitly-paused TTY and never
  // touches non-TTY stdin (its EOF/exit behavior must stay unchanged).
  resumeInteractiveInput(process.stdin);

  const { createInterface } = await import("readline");
  const rl = createInterface({
    input: process.stdin,
    output: renderer ? process.stderr : process.stdout,
    completer: (line: string) => {
      if (isModelPickerLine(line, state)) {
        const previousActiveProviderTab = modelPickerState.activeProviderTab;
        const explicitProviderTab = explicitProviderTabFromModelLine(line, modelProviderIds);
        const isFreshQuery = modelPickerState.query !== line;
        if (isFreshQuery) {
          initializeModelPickerState({
            state: modelPickerState,
            providerIds: modelProviderIds,
            explicitProviderTab,
          });
          state.modelPickerOpen = true;
          state.thinkingPickerOpen = false;
          state.activeProviderTab = modelPickerState.activeProviderTab;
          modelPickerState.query = line;
          renderModelPicker(explicitProviderTab ? "/model explicit" : "/model");
        } else if (handleModelPickerKey({
          key: "\t",
          state: modelPickerState,
          providerIds: modelProviderIds,
        })) {
          state.modelPickerOpen = true;
          state.thinkingPickerOpen = false;
          state.activeProviderTab = modelPickerState.activeProviderTab;
          modelPickerState.query = line;
          renderModelPicker("\t", previousActiveProviderTab);
        }
        return [[], line];
      }

      if (/^\/(?:think|thinking)\s*$/.test(line.trim()) && state.thinkingPickerOpen !== true) {
        state.thinkingPickerOpen = true;
        state.modelPickerOpen = false;
        renderThinkingPicker();
        return [[], line];
      }

      if (isThinkingPickerLine(line, state)) {
        const next = nextThinkingLevel(state.thinking ?? input.env.OMK_THINKING, state.provider, state.model);
        state.thinking = next;
        state.thinkingPickerOpen = true;
        state.modelPickerOpen = false;
        state.updatedAt = new Date().toISOString();
        input.env.OMK_THINKING = next;
        input.env.OMK_MODEL_VARIANT = formatThinkingModelVariant(state.model, next);
        renderThinkingPicker();
      }
      return [[], line];
    },
  });
  const modelPickerRawKeyHandler = (chunk: Buffer | string): void => {
    const key = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    if (key !== "\x1b[Z" || state.modelPickerOpen !== true) {
      return;
    }
    const previousActiveProviderTab = modelPickerState.activeProviderTab;
    if (handleModelPickerKey({ key, state: modelPickerState, providerIds: modelProviderIds })) {
      state.activeProviderTab = modelPickerState.activeProviderTab;
      renderModelPicker(key, previousActiveProviderTab);
    }
  };
  process.stdin.on("data", modelPickerRawKeyHandler);

  const terminalOwner = new TerminalOwner(process.stdin);
  const releaseReadlineOwner = terminalOwner.claimReadline();

  let running = true;
  let readlineClosed = false;
  let activeTurnAbort: AbortController | undefined;
  let pendingPastedImageLine: string | undefined;
  const queuedLines: string[] = [];
  let pendingLineResolve: ((value: string | undefined) => void) | undefined;
  const resolveNextLine = (value: string | undefined): void => {
    const resolve = pendingLineResolve;
    pendingLineResolve = undefined;
    resolve?.(value);
  };
  rl.on("line", (line) => {
    rl.pause();
    if (pendingLineResolve) {
      resolveNextLine(line);
    } else {
      queuedLines.push(line);
    }
  });
  rl.once("close", () => {
    process.stdin.off("data", modelPickerRawKeyHandler);
    readlineClosed = true;
    if (queuedLines.length === 0) resolveNextLine(undefined);
  });
  const onSigint = (): void => {
    if (activeTurnAbort && !activeTurnAbort.signal.aborted) {
      activeTurnAbort.abort();
      process.stderr.write(
        style.phosphorDim("\nTurn cancelled. Press Ctrl+C again to exit.\n"),
      );
      return;
    }
    running = false;
    rl.close();
  };
  process.on("SIGINT", onSigint);

  const readPromptLine = async (): Promise<string | undefined> => {
    if (readlineClosed && queuedLines.length === 0) return undefined;
    if (renderer) {
      renderer.emit({ type: "prompt:ready" });
    } else {
      process.stdout.write(style.phosphorDim("omk> "));
    }
    const queued = queuedLines.shift();
    if (queued !== undefined) return queued;
    rl.resume();
    return new Promise<string | undefined>((resolve) => {
      pendingLineResolve = resolve;
      if (readlineClosed) resolveNextLine(undefined);
    });
  };

  while (running) {
    const userInput = await readPromptLine();
    if (userInput === undefined) break;

    let line = userInput.trim();
    if (!line) continue;
    renderer?.emit({ type: "input:submitted", text: line });

    if (["exit", "quit", ":q", "/exit", "/quit"].includes(line.toLowerCase())) {
      running = false;
      break;
    }

    const parsedSlash = parseSlashInput(line);
    if (!parsedSlash && pendingPastedImageLine) {
      line = `${pendingPastedImageLine}\n${line}`;
      pendingPastedImageLine = undefined;
    }
    const inputEnvelope = buildNativeInputEnvelope({
      loopInput: input,
      state,
      line,
      parsedSlash,
    });
    await persistNativeInputEnvelope({
      envelope: inputEnvelope,
      root: input.root,
      renderer,
    });

    if (parsedSlash) {
      const handler = slashRegistry.resolve(parsedSlash);

      if (handler) {
        const modelShow = isModelShowSlash(parsedSlash);
        if (modelShow) {
          initializeModelPickerState({
            state: modelPickerState,
            providerIds: modelProviderIds,
          });
          modelPickerState.query = "";
          state.modelPickerOpen = true;
          state.thinkingPickerOpen = false;
          state.activeProviderTab = modelPickerState.activeProviderTab;
          const tabs = buildProviderTabs(modelProviderIds);
          debugModelTabs({
            providerIds: modelProviderIds,
            tabs,
            activeProviderTab: ALL_PROVIDER_TAB,
            key: "/model",
            runtimeProvider: state.provider,
            runtimeModel: state.model,
            visibleRowCount: countModelPickerRows(modelProviderRegistry, ALL_PROVIDER_TAB),
          });
        } else if (isModelSlashCommand(parsedSlash)) {
          state.modelPickerOpen = false;
          state.activeProviderTab = ALL_PROVIDER_TAB;
        }

        try {
          let slashResult: SlashCommandResult | undefined;
          const thinkingShow = isThinkingShowSlash(parsedSlash);
          const interactiveThinkingSelector = canUseInteractiveThinkingSelector(input, renderer);
          await terminalOwner.withChildProcess(rl, async () => {
            const result = await runSlashHandler(
              handler,
              parsedSlash,
              slashContext,
              { suppressOutput: thinkingShow && interactiveThinkingSelector },
            );
            slashResult = result;
            if (parsedSlash.command === "/paste" && result.ok) {
              const pasteLine = result.text?.trim();
              if (pasteLine) {
                pendingPastedImageLine = pendingPastedImageLine
                  ? `${pendingPastedImageLine}\n${pasteLine}`
                  : pasteLine;
              }
            }
            if (result.exit) running = false;
          });
          const shouldSelectThinking = slashResult
            ? (thinkingShow && interactiveThinkingSelector) || shouldOpenThinkingPickerAfterSlash(parsedSlash, slashResult)
            : false;
          if (shouldSelectThinking) {
            state.modelPickerOpen = false;
            state.thinkingPickerOpen = true;
            state.activeProviderTab = ALL_PROVIDER_TAB;
            const selected = await terminalOwner.withRawSelector(rl, () =>
              promptThinkingSelection(input, state, renderer)
            );
            if (!selected) renderThinkingPicker();
          } else if (isThinkingSlashCommand(parsedSlash)) {
            state.modelPickerOpen = false;
            state.thinkingPickerOpen = true;
          } else if (!modelShow && isThinkingFollowupSlash(parsedSlash)) {
            state.modelPickerOpen = false;
            state.thinkingPickerOpen = false;
          } else if (!modelShow && !isModelSlashCommand(parsedSlash)) {
            state.modelPickerOpen = false;
            state.thinkingPickerOpen = false;
          }
        } catch (err: unknown) {
          const m = err instanceof Error ? err.message : String(err);
          if (renderer) {
            renderer.emit({
              type: "turn:error",
              message: `Command error: ${m}`,
            });
          } else {
            console.error(style.metricsRed(`Command error: ${m}`));
          }
        }
        continue;
      }
      state.modelPickerOpen = false;
      state.thinkingPickerOpen = false;
      const message = `Unknown command: ${parsedSlash.command}. Type /help for commands.`;
      if (renderer) {
        renderer.emit({ type: "turn:error", message });
      } else {
        console.log(style.phosphorDim(message));
      }
      continue;
    }

    state.modelPickerOpen = false;
    state.thinkingPickerOpen = false;

    if (shouldRunNativeParallelTurn(state.approvalPolicy)) {
      const turnStartedAt = Date.now();
      try {
        const exitCode = await terminalOwner.withChildProcess(rl, () =>
          runNativeParallelTurn(input, line, renderer),
        );
        renderer?.emit({
          type: "turn:finish",
          durationMs: Date.now() - turnStartedAt,
          exitCode,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (renderer) {
          renderer.emit({ type: "turn:error", message: msg });
        } else {
          console.error(style.metricsRed(`Error: ${msg}`));
        }
      }
      continue;
    }

    const abort = new AbortController();
    activeTurnAbort = abort;
    const timeout = setTimeout(() => abort.abort(), safeTurnTimeoutMs);

    try {
      const turnStartedAt = Date.now();
      let result: TaskResult;
      if (isDisabledEnvValue(input.env.OMK_CHAT_HARNESS_TURN)) {
        const node = buildNativeRootLoopTurnNode({
          bootstrap: state.bootstrap,
          prompt: line,
          mcpAllowlist: input.mcpAllowlist,
          skillNames: input.skillNames,
          hookNames: input.hookNames,
          executionPrompt: state.approvalPolicy,
        });
        await persistNativeDagCompileArtifacts({
          envelope: inputEnvelope,
          dag: { nodes: [node] },
          root: input.root,
          workerCount: 1,
          executionStrategy:
            nativeExecutionStrategy(state.approvalPolicy) ?? "sequential",
          explanation:
            "native direct chat turn compiled to a single-node DAG artifact",
          renderer,
        });
        const turnMcpAllowlist = node.routing?.mcpServers ?? input.mcpAllowlist;
        const turnSkillNames = node.routing?.skills ?? input.skillNames;
        const turnHookNames = node.routing?.hooks ?? input.hookNames;
        const runContext = buildTaskRunContext({
          runId: input.runId,
          root: input.root,
          node,
          objective: line,
          toolPlane: {
            mcpServers: turnMcpAllowlist,
            mcpConfigFile: input.env.OMK_MCP_CONFIG_FILE,
            skills: turnSkillNames,
            hooks: turnHookNames,
            tools: node.routing?.tools,
            requiresRuntimeMcp: node.routing?.requiresMcp,
          },
          selectedRuntimeId: state.bootstrap.selectedRuntimeId,
          model: state.bootstrap.selectedModel,
        });
        result = await terminalOwner.withChildProcess(rl, () =>
          executeNativeRootTurn({
            taskRunner,
            node,
            env: input.env,
            signal: abort.signal,
            heartbeatEnabled: !isDisabledEnvValue(input.env.OMK_TURN_HEARTBEAT),
            renderer,
            mcpAllowlist: turnMcpAllowlist,
            skillNames: turnSkillNames,
            hookNames: turnHookNames,
            runContext,
          }),
        );
      } else {
        result = await terminalOwner.withChildProcess(rl, () =>
          executeNativeRootHarnessTurn({
            taskRunner,
            bootstrap: state.bootstrap,
            prompt: line,
            runId: input.runId,
            root: input.root,
            env: input.env,
            signal: abort.signal,
            heartbeatEnabled: !isDisabledEnvValue(input.env.OMK_TURN_HEARTBEAT),
            renderer,
            mcpAllowlist: input.mcpAllowlist,
            skillNames: input.skillNames,
            hookNames: input.hookNames,
            workers: input.workers,
            executionPrompt: state.approvalPolicy,
            inputEnvelope,
          }),
        );
      }

      if (result.stdout) {
        if (renderer) {
          renderer.emit({ type: "assistant:final", text: result.stdout });
        } else {
          const toolSummary =
            result.metadata?.harness === "dag-executor"
              ? `dag ${String(result.metadata.nodeCount ?? 1)} nodes`
              : "native turn";
          process.stdout.write(
            style.phosphorDim(`\n  ✓ Done · ${toolSummary}\n`),
          );
        }
        onData?.(result.stdout);
      }
      if (result.stderr && result.exitCode !== 0) {
        if (renderer) {
          renderer.emit({ type: "turn:error", message: result.stderr });
        } else {
          process.stderr.write(style.metricsRed(result.stderr) + "\n");
        }
      }
      if (!result.stdout && result.exitCode !== 0) {
        const metaError =
          result.metadata &&
          typeof result.metadata === "object" &&
          "error" in result.metadata
            ? String((result.metadata as Record<string, unknown>).error)
            : undefined;
        const message = metaError
          ? `Turn exited with code ${result.exitCode}: ${metaError}`
          : `Turn exited with code ${result.exitCode}`;
        if (renderer) {
          renderer.emit({ type: "turn:error", message });
        } else {
          process.stderr.write(style.metricsRed(message) + "\n");
        }
      }
      if (input.onTodoSync && result.stdout) {
        input.onTodoSync(result.stdout);
      }
      renderer?.emit({
        type: "turn:finish",
        durationMs: Date.now() - turnStartedAt,
        exitCode: result.exitCode ?? 0,
      });
    } catch (err) {
      const msg = abort.signal.aborted
        ? `Turn timed out after ${safeTurnTimeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      if (renderer) {
        renderer.emit({ type: "turn:error", message: msg });
      } else {
        console.error(style.metricsRed(`Error: ${msg}`));
      }
    } finally {
      activeTurnAbort = undefined;
      clearTimeout(timeout);
    }
  }

  process.off("SIGINT", onSigint);
  releaseReadlineOwner();
  if (!readlineClosed) rl.close();
  if (renderer) {
    renderer.emit({ type: "session:stop", exitCode: 0 });
    await renderer.stop();
  } else {
    console.log(
      style.phosphorDim(
        `\n  Session ended. Run ${style.cream("omk runs")} to see history.\n`,
      ),
    );
  }
  return 0;
}
