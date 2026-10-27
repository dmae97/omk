/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `omk -p "prompt"` - text output
 * - `omk --mode json "prompt"` - JSON event stream
 */

import type { AssistantMessage, ImageContent } from "omk-ai";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { OVERFLOW_RECOVERY_FAILED } from "../core/compaction/overflow-recovery-progress.ts";
import {
	createJsonSessionInfoEmitter,
	type JsonSessionInfoEmitter,
	jsonSessionInfoEnabled,
	setJsonSessionInfoEmitter,
} from "../core/json-session-info.ts";
import { flushRawStdout, writeRawStdout } from "../core/output-guard.ts";
import { formatPinnedQuotaFailoverNotice } from "../core/pinned-quota-failover-notice.ts";
import type { PromptSettlementOutcome } from "../core/prompt-settlement.ts";
import { startRunBudgetClock } from "../core/remaining-budget.ts";
import { formatSessionTermination, type SessionTermination } from "../core/session-termination.ts";
import { taskResultSurfaceLine } from "../core/task-result-format.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	mode: "text" | "json";
	/** Array of additional prompts to send after initialMessage */
	messages?: string[];
	/** First message to send (may contain @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
	const { mode, messages = [], initialMessage, initialImages } = options;
	// Spec 036: the headless run owns the one budget clock (origin = process start).
	startRunBudgetClock();
	let exitCode = 0;
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let disposed = false;
	let promptStarted = false;
	let latestTermination: SessionTermination | undefined;
	let latestOutcome: PromptSettlementOutcome | undefined;
	// Spec 061: overflow recovery gave up, but the run still settles "completed" on the overflowing reply.
	let overflowRecoveryFailure: string | undefined;
	let renderedTermination: SessionTermination | undefined;
	const signalCleanupHandlers: Array<() => void> = [];
	// Spec 112: only json mode with OMK_JSON_SESSION_INFO on (default; `0`/`false`/`off` opts out) creates an emitter; otherwise nothing changes.
	const sessionInfo: JsonSessionInfoEmitter | undefined =
		mode === "json" && jsonSessionInfoEnabled() ? createJsonSessionInfoEmitter(writeRawStdout) : undefined;

	const renderTermination = (termination: SessionTermination): void => {
		if (termination.kind === "completed" || renderedTermination === termination) return;
		renderedTermination = termination;
		if (mode === "json") {
			writeRawStdout(`${JSON.stringify({ type: "session_termination", termination })}\n`);
		} else {
			console.error(formatSessionTermination(termination));
		}
	};

	const renderFailure = (fallback: string): void => {
		const termination = latestTermination ?? (!promptStarted ? session.lastTermination : undefined);
		if (termination && termination.kind !== "completed") {
			renderTermination(termination);
			return;
		}
		console.error(fallback);
	};

	const promptFailed = (): boolean => {
		if (overflowRecoveryFailure !== undefined) {
			console.error(overflowRecoveryFailure);
			return true;
		}
		const last = session.state.messages.at(-1);
		const assistantFailed =
			last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted");
		const failed =
			latestOutcome !== undefined
				? latestOutcome !== "completed"
				: assistantFailed || (latestTermination !== undefined && latestTermination.kind !== "completed");
		if (failed)
			renderFailure(
				assistantFailed ? last.errorMessage || `Request ${last.stopReason}` : "Prompt did not complete.",
			);
		return failed;
	};

	const disposeRuntime = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		unsubscribe?.();
		await runtimeHost.dispose();
	};

	const registerSignalHandlers = (): void => {
		const signals: Array<"SIGTERM" | "SIGHUP"> = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				session.recordProcessSignal(signal);
				killTrackedDetachedChildren();
				void disposeRuntime().finally(() => {
					process.exit(signal === "SIGHUP" ? 129 : 143);
				});
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	registerSignalHandlers();

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		promptStarted = false;
		latestTermination = undefined;
		latestOutcome = undefined;
		overflowRecoveryFailure = undefined;
		await session.bindExtensions({
			mode: mode === "json" ? "json" : "print",
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, navigateOptions) => {
					const result = await session.navigateTree(targetId, {
						summarize: navigateOptions?.summarize,
						customInstructions: navigateOptions?.customInstructions,
						replaceInstructions: navigateOptions?.replaceInstructions,
						label: navigateOptions?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, switchOptions) => {
					return runtimeHost.switchSession(sessionPath, switchOptions);
				},
				reload: async () => {
					await session.reload();
				},
			},
			onError: (err) => {
				console.error(`Extension error (${err.extensionPath}): ${err.error}`);
			},
		});

		if (sessionInfo) {
			// First line right after the header; later provider requests re-emit only on a hash change.
			sessionInfo.observe({ systemPrompt: session.agent.state.systemPrompt, tools: session.agent.state.tools });
			setJsonSessionInfoEmitter(sessionInfo);
		}

		unsubscribe?.();
		unsubscribe = session.subscribe((event) => {
			if (event.type === "prompt_settled") latestOutcome = event.outcome;
			// Spec 096 (flag on only): stdout and the exit code stay unchanged; json mode gets the raw event below.
			if (mode === "text") {
				// Spec 100: the downgrade line is the TUI's line too.
				const taskResultLine = taskResultSurfaceLine(event);
				if (taskResultLine !== undefined) process.stderr.write(`${taskResultLine}\n`);
			}
			if (event.type === "pinned_quota_failover")
				process.stderr.write(`${formatPinnedQuotaFailoverNotice(event)}\n`);
			if (
				event.type === "compaction_end" &&
				event.reason === "overflow" &&
				!event.willRetry &&
				event.errorMessage?.startsWith(OVERFLOW_RECOVERY_FAILED)
			)
				overflowRecoveryFailure = event.errorMessage;
			if (event.type === "session_termination") {
				latestTermination = event.termination;
				if (mode === "text") {
					renderTermination(event.termination);
				} else {
					renderedTermination = event.termination;
				}
			}
			if (mode === "json") {
				writeRawStdout(`${JSON.stringify(event)}\n`);
			}
		});

		const startupTermination = session.lastTermination;
		if (startupTermination?.kind === "process_crash" && startupTermination.source === "inferred_on_resume") {
			renderTermination(startupTermination);
		}
	};

	try {
		if (mode === "json") {
			const header = session.sessionManager.getHeader();
			if (header) {
				writeRawStdout(`${JSON.stringify(header)}\n`);
			}
		}

		await rebindSession();

		const hasPrompt =
			!!initialMessage?.trim() ||
			messages.some((m) => typeof m === "string" && m.trim().length > 0) ||
			!!(initialImages && initialImages.length > 0);
		if (!hasPrompt) {
			// Bare `omk` with no prompt used to exit silently in print mode.
			console.error('No prompt provided. Use: omk -p "..."  or run `omk` in an interactive terminal.');
			exitCode = 2;
			return exitCode;
		}

		if (initialMessage) {
			promptStarted = true;
			latestTermination = undefined;
			latestOutcome = undefined;
			overflowRecoveryFailure = undefined;
			await session.prompt(initialMessage, { images: initialImages });
			if (promptFailed()) return 1;
		}

		for (const message of messages) {
			promptStarted = true;
			latestTermination = undefined;
			latestOutcome = undefined;
			overflowRecoveryFailure = undefined;
			await session.prompt(message);
			if (promptFailed()) return 1;
		}

		if (mode === "text") {
			const state = session.state;
			const lastMessage = state.messages[state.messages.length - 1];

			if (lastMessage?.role === "assistant") {
				const assistantMsg = lastMessage as AssistantMessage;
				if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
					renderFailure(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
					exitCode = 1;
				} else {
					for (const content of assistantMsg.content) {
						if (content.type === "text") {
							writeRawStdout(`${content.text}\n`);
						}
					}
				}
			}
		}

		return exitCode;
	} catch (error: unknown) {
		renderFailure(error instanceof Error ? error.message : String(error));
		return 1;
	} finally {
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		await disposeRuntime();
		if (sessionInfo) setJsonSessionInfoEmitter(undefined);
		await flushRawStdout();
	}
}
