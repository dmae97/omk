import { Buffer } from "node:buffer";
import { MAX_PAYLOAD_BYTES } from "./framing.ts";

export const PROTOCOL_VERSION = "omk.native-agent.v1";
const IDENTITY_KEYS = [
	"version",
	"launchId",
	"generation",
	"sessionId",
	"promptId",
	"toolCallId",
	"attempt",
	"scopeEpochId",
	"grantDigest",
] as const;

export interface NativeIdentity {
	readonly version: typeof PROTOCOL_VERSION;
	readonly launchId: string;
	readonly generation: number;
	readonly sessionId: string;
	readonly promptId: string;
	readonly toolCallId: string;
	readonly attempt: number;
	readonly scopeEpochId: string;
	readonly grantDigest: string;
}
type ControlData<S extends 1 | 2> = { readonly identity: NativeIdentity; readonly controlSeq: S };
export type ParentMessage =
	| { readonly type: "hello"; readonly data: ControlData<1> }
	| { readonly type: "execute"; readonly data: ControlData<2> };
export type WorkerMessage =
	| {
			readonly type: "ready";
			readonly data: ControlData<1> & {
				readonly capabilities: { readonly offlineOnly: true; readonly backend: false; readonly execute: false };
			};
	  }
	| {
			readonly type: "result";
			readonly data: ControlData<2> & { readonly status: "unsupported"; readonly started: false };
	  };
export type NativeMessage = ParentMessage | WorkerMessage;

export class NativeProtocolError extends Error {
	constructor(code: "JSON" | "SCHEMA" | "IDENTITY" | "SEQUENCE") {
		super(code);
		this.name = "NativeProtocolError";
	}
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.keys(value).length !== keys.length ||
		!keys.every((key) => Object.hasOwn(value, key))
	)
		throw new NativeProtocolError("SCHEMA");
	return value as Record<string, unknown>;
}
function opaque(value: unknown): string {
	if (
		typeof value !== "string" ||
		!value ||
		value.length > 128 ||
		/[\uD800-\uDFFF]/u.test(value) ||
		Buffer.byteLength(value, "utf8") > 128
	)
		throw new NativeProtocolError("SCHEMA");
	return value;
}
function positiveInteger(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new NativeProtocolError("SCHEMA");
	return value;
}
function readIdentity(value: unknown): NativeIdentity {
	const fields = record(value, IDENTITY_KEYS);
	if (
		fields.version !== PROTOCOL_VERSION ||
		typeof fields.grantDigest !== "string" ||
		!/^[0-9a-f]{64}$/.test(fields.grantDigest)
	)
		throw new NativeProtocolError("SCHEMA");
	return {
		version: PROTOCOL_VERSION,
		launchId: opaque(fields.launchId),
		generation: positiveInteger(fields.generation),
		sessionId: opaque(fields.sessionId),
		promptId: opaque(fields.promptId),
		toolCallId: opaque(fields.toolCallId),
		attempt: positiveInteger(fields.attempt),
		scopeEpochId: opaque(fields.scopeEpochId),
		grantDigest: fields.grantDigest,
	};
}

/** Compact JSON equality rejects duplicates before typed admission, including escaped-equivalent keys. */
export function parseMessage(text: string): NativeMessage {
	if (text.length > MAX_PAYLOAD_BYTES || Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES)
		throw new NativeProtocolError("JSON");
	let value: unknown;
	try {
		value = JSON.parse(text);
		if (JSON.stringify(value) !== text) throw new NativeProtocolError("JSON");
	} catch {
		throw new NativeProtocolError("JSON");
	}
	const message = record(value, ["type", "data"]);
	if (message.type !== "hello" && message.type !== "execute" && message.type !== "ready" && message.type !== "result")
		throw new NativeProtocolError("SCHEMA");
	const keys = [
		"identity",
		"controlSeq",
		...(message.type === "ready" ? ["capabilities"] : message.type === "result" ? ["status", "started"] : []),
	];
	const data = record(message.data, keys);
	const identity = readIdentity(data.identity);
	const sequence = positiveInteger(data.controlSeq);
	if (sequence !== (message.type === "hello" || message.type === "ready" ? 1 : 2))
		throw new NativeProtocolError("SEQUENCE");
	switch (message.type) {
		case "hello":
			return { type: "hello", data: { identity, controlSeq: 1 } };
		case "execute":
			return { type: "execute", data: { identity, controlSeq: 2 } };
		case "ready": {
			const capabilities = record(data.capabilities, ["offlineOnly", "backend", "execute"]);
			if (capabilities.offlineOnly !== true || capabilities.backend !== false || capabilities.execute !== false)
				throw new NativeProtocolError("SCHEMA");
			return {
				type: "ready",
				data: { identity, controlSeq: 1, capabilities: { offlineOnly: true, backend: false, execute: false } },
			};
		}
		case "result":
			if (data.status !== "unsupported" || data.started !== false) throw new NativeProtocolError("SCHEMA");
			return { type: "result", data: { identity, controlSeq: 2, status: "unsupported", started: false } };
	}
}

export function decodeReply(text: string, expected: NativeIdentity, phase: "ready" | "result"): WorkerMessage {
	const message = parseMessage(text);
	if ((message.type !== "ready" && message.type !== "result") || message.type !== phase)
		throw new NativeProtocolError("SEQUENCE");
	if (!IDENTITY_KEYS.every((key) => message.data.identity[key] === expected[key]))
		throw new NativeProtocolError("IDENTITY");
	return message;
}
