import type { PromptOptions } from "./prompt-options.ts";

const continuations = new WeakSet<PromptOptions>();

/** An extension-settlement follow-up continues the current task's skill selection. */
export function continuationPromptOptions(options?: PromptOptions): PromptOptions {
	const next = { ...options };
	continuations.add(next);
	return next;
}

export function isPromptContinuation(options?: PromptOptions): boolean {
	return options !== undefined && continuations.has(options);
}
