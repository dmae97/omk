import { createHash } from "node:crypto";
import type { Message } from "omk-ai";
import type { SingleResult } from "./subagent-runtime-types.ts";

export const SUBAGENT_OUTPUT_LIMITS = {
	stdoutBytes: 8 * 1024 * 1024,
	stderrBytes: 256 * 1024,
	lineBytes: 1024 * 1024,
	events: 20_000,
	messages: 1024,
} as const;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonnegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Bounds are per process attempt, including ignored events and incomplete lines. */
export function createSubagentStream(result: SingleResult, onMessage: () => void) {
	let pending = "";
	let terminal = false;
	let assistantSeen = false;
	const stdoutHash = createHash("sha256");
	const stderrHash = createHash("sha256");
	const stats = { stdoutBytes: 0, stderrBytes: 0, events: 0, messages: 0, usageUnknown: false };
	let failure: string | undefined;
	const fail = (reason: string): never => {
		failure ??= reason;
		throw new Error(failure);
	};
	const processLine = (line: string) => {
		if (!line.trim()) return;
		if (++stats.events > SUBAGENT_OUTPUT_LIMITS.events) fail("subagent.output.events_limit");
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			fail("subagent.stream.invalid_json");
		}
		if (!record(event) || typeof event.type !== "string") return fail("subagent.stream.invalid_event");
		if (event.type === "prompt_settled") {
			if (terminal) fail("subagent.stream.duplicate_terminal");
			terminal = true;
			if (event.outcome !== "completed") fail("subagent.stream.prompt_not_completed");
			return;
		}
		if (event.type !== "message_end" && event.type !== "tool_result_end") return;
		if (terminal) fail("subagent.stream.message_after_terminal");
		const message = event.message;
		if (!record(message) || typeof message.role !== "string") return fail("subagent.stream.invalid_message");
		// The CLI also emits custom session and user messages, which are not assistant receipts.
		if (message.role !== "assistant" && message.role !== "toolResult") return;
		if (!Array.isArray(message.content)) return fail("subagent.stream.invalid_content");
		for (const part of message.content) {
			if (!record(part)) return fail("subagent.stream.invalid_content");
			if (part.type === "text" || part.type === "thinking") {
				if (typeof part[part.type] !== "string") fail("subagent.stream.invalid_content");
			} else if (part.type === "toolCall") {
				if (typeof part.name !== "string" || typeof part.id !== "string" || !record(part.arguments))
					fail("subagent.stream.invalid_tool_call");
			} else if (part.type === "image") {
				if (typeof part.data !== "string" || typeof part.mimeType !== "string")
					fail("subagent.stream.invalid_image");
			} else fail("subagent.stream.invalid_content");
		}
		if (stats.messages >= SUBAGENT_OUTPUT_LIMITS.messages) fail("subagent.output.messages_limit");
		if (message.role === "assistant") {
			if (message.model !== undefined && typeof message.model !== "string") fail("subagent.stream.invalid_model");
			if (message.errorMessage !== undefined && typeof message.errorMessage !== "string")
				fail("subagent.stream.invalid_error");
			if (
				message.stopReason !== undefined &&
				!["stop", "length", "toolUse", "error", "aborted"].includes(String(message.stopReason))
			)
				fail("subagent.stream.invalid_stop_reason");
			const usage = message.usage;
			if (usage === undefined) stats.usageUnknown = true;
			else {
				if (!record(usage) || !record(usage.cost)) return fail("subagent.stream.invalid_usage");
				for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
					if (!nonnegative(usage[key])) fail("subagent.stream.invalid_usage");
				}
				for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
					if (!nonnegative(usage.cost[key])) fail("subagent.stream.invalid_usage");
				}
			}
			assistantSeen = true;
		}
		const msg = message as unknown as Message;
		result.messages.push(msg);
		stats.messages++;
		if (msg.role === "assistant") {
			result.usage.turns++;
			if (msg.usage) {
				result.usage.input += msg.usage.input;
				result.usage.output += msg.usage.output;
				result.usage.cacheRead += msg.usage.cacheRead;
				result.usage.cacheWrite += msg.usage.cacheWrite;
				result.usage.cost += msg.usage.cost.total;
				result.usage.contextTokens = Math.max(result.usage.contextTokens, msg.usage.totalTokens);
				if (Object.values(result.usage).some((value) => !nonnegative(value)))
					fail("subagent.stream.usage_overflow");
			}
			result.model ??= msg.model;
			if (msg.stopReason) result.stopReason = msg.stopReason;
			if (msg.errorMessage) result.errorMessage = msg.errorMessage;
		}
		onMessage();
	};
	return {
		stdout(chunk: string) {
			if (failure) throw new Error(failure);
			stats.stdoutBytes += Buffer.byteLength(chunk, "utf8");
			stdoutHash.update(chunk);
			if (stats.stdoutBytes > SUBAGENT_OUTPUT_LIMITS.stdoutBytes) fail("subagent.output.stdout_limit");
			let start = 0;
			while (start < chunk.length) {
				const newline = chunk.indexOf("\n", start);
				const fragment = chunk.slice(start, newline < 0 ? undefined : newline);
				if (
					Buffer.byteLength(pending, "utf8") + Buffer.byteLength(fragment, "utf8") >
					SUBAGENT_OUTPUT_LIMITS.lineBytes
				)
					fail("subagent.output.line_limit");
				pending += fragment;
				if (newline < 0) break;
				const line = pending;
				pending = "";
				processLine(line);
				start = newline + 1;
			}
		},
		stderr(chunk: string) {
			if (failure) throw new Error(failure);
			stats.stderrBytes += Buffer.byteLength(chunk, "utf8");
			stderrHash.update(chunk);
			if (stats.stderrBytes > SUBAGENT_OUTPUT_LIMITS.stderrBytes) fail("subagent.output.stderr_limit");
			result.stderr += chunk;
		},
		finish(requireReceipt: boolean) {
			try {
				if (!failure && pending.trim()) processLine(pending);
				if (!failure && requireReceipt && !assistantSeen) fail("subagent.stream.missing_terminal_message");
			} catch {
				failure ??= "subagent.stream.callback_error";
			} finally {
				pending = "";
				result.stream = {
					...stats,
					stdoutDigest: stdoutHash.digest("hex"),
					stderrDigest: stderrHash.digest("hex"),
					...(failure ? { failure } : {}),
				};
			}
			return failure;
		},
	};
}
