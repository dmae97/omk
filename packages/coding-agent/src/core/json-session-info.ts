/**
 * Spec 112: `OMK_JSON_SESSION_INFO=1` adds `omk_session_info` lines to the `--mode json` stream.
 *
 * Each line carries the system prompt and tool definitions together with the same
 * `systemHash` / `toolsHash` the `llm-call` run log records (`omk-ai/prompt-hash`).
 * The first line follows the session header; a new line (seq + 1) is written only when
 * either hash changes. Nothing is masked here: the spec 110 exporter masks every string.
 *
 * With the flag off (anything but exactly "1") no sink is installed and
 * {@link createJsonSessionInfoStreamFn} returns its inner stream itself.
 */

import type { StreamFn } from "omk-agent-core";
import type { Context } from "omk-ai";
import { serializePromptTools, systemHash, toolsHash } from "omk-ai/prompt-hash";
import { isDefaultOnEnvFlag } from "./env-flag.ts";

export const JSON_SESSION_INFO_ENV = "OMK_JSON_SESSION_INFO";

export function jsonSessionInfoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return isDefaultOnEnvFlag(env[JSON_SESSION_INFO_ENV]);
}

export type JsonSessionInfoContext = Pick<Context, "systemPrompt" | "tools">;

export interface JsonSessionInfoLine {
	type: "omk_session_info";
	seq: number;
	systemHash: string;
	toolsHash: string;
	systemPrompt: string;
	tools: Array<{ name: string; description: string; parameters: unknown }>;
}

export interface JsonSessionInfoEmitter {
	/** Writes a line when the hashes differ from the last written line; returns whether it wrote. */
	observe(context: JsonSessionInfoContext): boolean;
}

export function createJsonSessionInfoEmitter(write: (line: string) => void): JsonSessionInfoEmitter {
	let seq = 0;
	let lastSystemHash: string | undefined;
	let lastToolsHash: string | undefined;
	return {
		observe(context) {
			const nextSystemHash = systemHash(context);
			const nextToolsHash = toolsHash(context);
			if (nextSystemHash === lastSystemHash && nextToolsHash === lastToolsHash) return false;
			lastSystemHash = nextSystemHash;
			lastToolsHash = nextToolsHash;
			seq += 1;
			const line: JsonSessionInfoLine = {
				type: "omk_session_info",
				seq,
				systemHash: nextSystemHash,
				toolsHash: nextToolsHash,
				systemPrompt: context.systemPrompt ?? "",
				// Same projection and key order as the toolsHash input.
				tools: JSON.parse(serializePromptTools(context)),
			};
			write(`${JSON.stringify(line)}\n`);
			return true;
		},
	};
}

let activeEmitter: JsonSessionInfoEmitter | undefined;

/** Print mode (json + flag on) installs the emitter; `undefined` removes it. */
export function setJsonSessionInfoEmitter(emitter: JsonSessionInfoEmitter | undefined): void {
	activeEmitter = emitter;
}

/**
 * Observes each provider request's context (the same object the run log hashes) and hands it
 * to the active emitter. Never changes the request; observer errors are swallowed.
 */
export function createJsonSessionInfoStreamFn(inner: StreamFn, env: NodeJS.ProcessEnv = process.env): StreamFn {
	if (!jsonSessionInfoEnabled(env)) return inner;
	const wrapped: StreamFn = (model, context, options) => {
		try {
			activeEmitter?.observe(context);
		} catch {
			// best effort: the session-info line never changes the call
		}
		return inner(model, context, options);
	};
	for (const key of Object.getOwnPropertySymbols(inner)) {
		const descriptor = Object.getOwnPropertyDescriptor(inner, key);
		if (descriptor) Object.defineProperty(wrapped, key, descriptor);
	}
	return wrapped;
}
