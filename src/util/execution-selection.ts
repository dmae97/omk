import type {
  ExecutionPromptPolicy,
  ExecutionSelectionDecision,
  ExecutionSelectionSource,
  ExecutionStrategy,
  UserIntent,
} from "../contracts/orchestration.js";
import { UsageError } from "./cli-contract.js";

export const EXECUTION_PROMPT_POLICIES: readonly ExecutionPromptPolicy[] = [
  "ask",
  "auto",
  "parallel",
  "sequential",
] as const;

export const EXECUTION_PROMPT_CHOICES: readonly ExecutionStrategy[] = [
  "parallel",
  "sequential",
  "plan-only",
] as const;

export function normalizeExecutionPromptPolicy(value: string | undefined): ExecutionPromptPolicy | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "one-by-one" || normalized === "one_by_one" || normalized === "serial") return "sequential";
  if (normalized === "agents" || normalized === "subagents") return "parallel";
  if (EXECUTION_PROMPT_POLICIES.includes(normalized as ExecutionPromptPolicy)) {
    return normalized as ExecutionPromptPolicy;
  }
  return undefined;
}

export function parseExecutionPromptPolicy(value: string | undefined, sourceLabel = "--execution"): ExecutionPromptPolicy | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const policy = normalizeExecutionPromptPolicy(value);
  if (policy) return policy;
  throw new UsageError(`Invalid ${sourceLabel}: ${value}. Expected ask | auto | parallel | sequential.`);
}

export function isNonTrivialIntent(intent: UserIntent): boolean {
  return intent.complexity !== "simple" || intent.estimatedWorkers > 1 || intent.parallelizable === true;
}

export function resolveExecutionSelectionDecision(input: {
  cliValue?: string;
  configValue?: string | ExecutionPromptPolicy;
  intent: UserIntent;
  isTTY: boolean;
}): ExecutionSelectionDecision {
  const cliPolicy = parseExecutionPromptPolicy(input.cliValue, "--execution");
  const configPolicy = typeof input.configValue === "string"
    ? parseExecutionPromptPolicy(input.configValue, "execution config")
    : input.configValue;
  const policy = cliPolicy ?? configPolicy ?? "ask";
  const source: ExecutionSelectionSource = cliPolicy ? "cli" : configPolicy ? "config" : "default";
  const isNonTrivial = isNonTrivialIntent(input.intent);

  if (policy === "parallel") {
    return makeDecision(policy, source, "parallel", "execution policy forces parallel agents", input.isTTY, isNonTrivial);
  }
  if (policy === "sequential") {
    return makeDecision(policy, source, "sequential", "execution policy forces one-by-one execution", input.isTTY, isNonTrivial);
  }
  if (policy === "auto") {
    const strategy = shouldAutoParallel(input.intent) ? "parallel" : "sequential";
    return makeDecision(
      policy,
      source,
      strategy,
      strategy === "parallel"
        ? "auto selected parallel agents for a non-trivial or parallelizable intent"
        : "auto selected one-by-one execution for a simple intent",
      input.isTTY,
      isNonTrivial
    );
  }

  if (input.isTTY && isNonTrivial) {
    return makeDecision(policy, source, "prompt", "TTY non-trivial intent must ask before execution", input.isTTY, isNonTrivial);
  }

  const strategy = isNonTrivial ? "parallel" : "sequential";
  return makeDecision(
    policy,
    source,
    strategy,
    isNonTrivial
      ? "non-TTY ask policy cannot prompt, so complex work defaults to parallel agents"
      : "simple intent can run one by one without prompting",
    input.isTTY,
    isNonTrivial
  );
}

export function resolvePromptExecutionDecision(
  base: ExecutionSelectionDecision,
  strategy: Exclude<ExecutionStrategy, "prompt">
): ExecutionSelectionDecision {
  return {
    ...base,
    source: "prompt",
    strategy,
    reason: strategy === "parallel"
      ? "user selected parallel agents"
      : strategy === "sequential"
        ? "user selected one-by-one execution"
        : "user selected plan-only",
  };
}

function shouldAutoParallel(intent: UserIntent): boolean {
  return intent.complexity === "complex" || intent.estimatedWorkers > 1 || intent.parallelizable === true;
}

function makeDecision(
  policy: ExecutionPromptPolicy,
  source: ExecutionSelectionSource,
  strategy: ExecutionStrategy,
  reason: string,
  isTTY: boolean,
  isNonTrivial: boolean
): ExecutionSelectionDecision {
  return { policy, source, strategy, reason, isTTY, isNonTrivial };
}
