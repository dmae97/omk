import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { FrameDecoder, FrameEncoder, MAX_PAYLOAD_BYTES, MAX_STREAM_BYTES } from "../src/core/native-agent/framing.ts";
import { decodeReply, PROTOCOL_VERSION, parseMessage } from "../src/core/native-agent/protocol.ts";

const identity = {
	version: PROTOCOL_VERSION,
	launchId: 'launch-{"type":"execute"}\u2028\u2029😀',
	generation: 1,
	sessionId: "session",
	promptId: "prompt",
	toolCallId: "tool",
	attempt: 1,
	scopeEpochId: "epoch",
	grantDigest: "a".repeat(64),
} as const;
const hello = { type: "hello", data: { identity, controlSeq: 1 } } as const;
const execute = { type: "execute", data: { identity, controlSeq: 2 } } as const;
const ready = {
	type: "ready",
	data: { identity, controlSeq: 1, capabilities: { offlineOnly: true, backend: false, execute: false } },
};
const unsupported = { type: "result", data: { identity, controlSeq: 2, status: "unsupported", started: false } };
const text = JSON.stringify(hello);
const bytes = (value: string) => Buffer.from(value, "utf8");
const frames = (value: Uint8Array) => {
	const decoder = new FrameDecoder();
	const result: string[] = [];
	decoder.push(value, (frame) => result.push(frame));
	decoder.finish();
	return result;
};

describe("private native wire framing", () => {
	it.each([1, 2, 3, 17, 65536])("preserves multiple Unicode frames in %i-byte chunks", (size) => {
		const encoder = new FrameEncoder();
		const input = Buffer.concat([encoder.encode(text), encoder.encode(JSON.stringify(execute))]);
		const decoder = new FrameDecoder();
		const output: string[] = [];
		for (let offset = 0; offset < input.length; offset += size)
			decoder.push(input.subarray(offset, offset + size), (line) => output.push(line));
		decoder.finish();
		expect(output.map(parseMessage)).toEqual([hello, execute]);
	});
	it.each([
		Buffer.alloc(0),
		bytes("\n"),
		bytes("{}\r\n"),
		Buffer.from([239, 187, 191, 123, 125, 10]),
		Buffer.from([0xc3, 0x28, 10]),
		bytes("{}"),
		bytes("{}\n{"),
	])("rejects malformed framing %j", (input) => {
		expect(() => frames(input)).toThrow();
	});
	it("accepts the exact payload limit and refuses one extra byte before delivery", () => {
		const payload = "x".repeat(MAX_PAYLOAD_BYTES);
		expect(frames(new FrameEncoder().encode(payload))).toEqual([payload]);
		let delivered = false;
		expect(() =>
			new FrameDecoder().push(bytes(`${payload}x\n`), () => {
				delivered = true;
			}),
		).toThrow();
		expect(delivered).toBe(false);
		expect(() => new FrameEncoder().encode(`${payload}x`)).toThrow();
		expect(() => new FrameEncoder().encode("界".repeat(MAX_PAYLOAD_BYTES / 3 + 1))).toThrow();
	});
	it("bounds total input and output including LF without a pending frame queue", () => {
		const encoder = new FrameEncoder();
		const decoder = new FrameDecoder();
		const payload = "x".repeat(MAX_PAYLOAD_BYTES - 1);
		let delivered = 0;
		for (let n = 0; n < MAX_STREAM_BYTES / MAX_PAYLOAD_BYTES; n++)
			decoder.push(encoder.encode(payload), () => {
				delivered++;
			});
		expect(delivered).toBe(32);
		expect(() => decoder.push(bytes("x\n"), () => {})).toThrow();
		expect(() => encoder.encode("x")).toThrow();
		expect(() => new FrameDecoder().push(new Uint8Array(MAX_STREAM_BYTES + 1), () => {})).toThrow();
	});
	it("seals a failed or finished decoder", () => {
		const failed = new FrameDecoder();
		expect(() => failed.push(bytes("\n"), () => {})).toThrow();
		expect(() => failed.push(bytes("{}\n"), () => {})).toThrow();
		const done = new FrameDecoder();
		done.push(bytes("{}\n"), () => {});
		done.finish();
		expect(() => done.push(bytes("{}\n"), () => {})).toThrow();
	});
});

const malformed = [
	"{",
	"{}{}",
	"[]",
	"null",
	` ${text}`,
	`${text}\n`,
	JSON.stringify({ ...hello, extra: 1 }),
	JSON.stringify({ ...hello, data: [] }),
	JSON.stringify({ ...hello, data: { ...hello.data, extra: 1 } }),
	JSON.stringify({ ...hello, data: { ...hello.data, identity: [] } }),
	JSON.stringify({ ...hello, data: { ...hello.data, identity: { ...identity, extra: 1 } } }),
	text.replace('"type":"hello"', '"type":"hello","type":"hello"'),
	text.replace('"generation":1', '"generation":1,"\\u0067eneration":1'),
	text.replace('"controlSeq":1', '"controlSeq":1,"controlSeq":1'),
	text.replace('"type":"hello"', '"type":"hello","\\u0074ype":"hello"'),
	text.replace('"generation":1', '"generation":1e400'),
	JSON.stringify({ ...ready, data: { ...ready.data, capabilities: [] } }),
	JSON.stringify({ ...ready, data: { ...ready.data, capabilities: { ...ready.data.capabilities, backend: true } } }),
	JSON.stringify({ ...unsupported, data: { ...unsupported.data, started: true } }),
	JSON.stringify({ ...hello, data: { ...hello.data, identity: { ...identity, version: "wrong" } } }),
	JSON.stringify({ ...hello, data: { ...hello.data, identity: { ...identity, launchId: "" } } }),
	JSON.stringify({ ...hello, data: { ...hello.data, identity: { ...identity, launchId: "\ud800" } } }),
	JSON.stringify({ ...hello, data: { ...hello.data, identity: { ...identity, grantDigest: "A".repeat(64) } } }),
	JSON.stringify({ ...hello, data: { ...hello.data, controlSeq: 2 } }),
];
describe("private native wire schema", () => {
	it.each([hello, execute, ready, unsupported])("accepts compact closed message $type", (message) => {
		expect(parseMessage(JSON.stringify(message))).toEqual(message);
	});
	it.each(malformed)("rejects malformed/duplicate/non-object control %s", (input) => {
		expect(() => parseMessage(input)).toThrow();
	});
	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
		"refuses unsafe identity integers %s",
		(value) => {
			for (const field of ["generation", "attempt"])
				expect(() =>
					parseMessage(
						JSON.stringify({ ...hello, data: { ...hello.data, identity: { ...identity, [field]: value } } }),
					),
				).toThrow();
		},
	);
	it("uses UTF-8 byte limits and binds replies to owner and phase", () => {
		const exact = { ...identity, launchId: `${"界".repeat(42)}ab`, generation: Number.MAX_SAFE_INTEGER };
		expect(parseMessage(JSON.stringify({ ...hello, data: { ...hello.data, identity: exact } }))).toBeDefined();
		expect(() =>
			parseMessage(
				JSON.stringify({
					...hello,
					data: { ...hello.data, identity: { ...exact, launchId: `${exact.launchId}x` } },
				}),
			),
		).toThrow();
		expect(decodeReply(JSON.stringify(ready), identity, "ready")).toEqual(ready);
		expect(() => decodeReply(JSON.stringify(ready), { ...identity, generation: 2 }, "ready")).toThrow();
		expect(() => decodeReply(JSON.stringify(unsupported), identity, "ready")).toThrow();
	});
});

const binary = process.env.N02_TEST_BINARY;
const input = `${text}\n${JSON.stringify(execute)}\n`;
function exchange(value: string) {
	if (!binary) throw new Error("N02_TEST_BINARY required for real interop");
	const result = spawnSync(binary, [], {
		input: bytes(value),
		timeout: 5000,
		maxBuffer: MAX_STREAM_BYTES,
		env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
	});
	expect(result.error).toBeUndefined();
	expect(result.signal).toBeNull();
	return result;
}
async function exchangeByByte(value: string): Promise<{ code: number | null; stdout: Buffer; stderr: Buffer }> {
	if (!binary) throw new Error("N02_TEST_BINARY required for real interop");
	const child = spawn(binary, [], {
		env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	return new Promise((resolve, reject) => {
		const stdout: Buffer[] = [],
			stderr: Buffer[] = [];
		let total = 0,
			failure: Error | undefined;
		let awaitingReady = true;
		const timer = setTimeout(() => {
			failure = new Error("fixture timeout");
			child.kill("SIGKILL");
		}, 5000);
		const append = (target: Buffer[], chunk: Buffer) => {
			total += chunk.length;
			if (total > MAX_STREAM_BYTES) {
				failure = new Error("fixture output bound");
				child.kill("SIGKILL");
			} else target.push(chunk);
		};
		child.stdout.on("data", (chunk: Buffer) => {
			append(stdout, chunk);
			if (awaitingReady && chunk.includes(10)) {
				awaitingReady = false;
				for (const byte of bytes(value.slice(value.indexOf("\n") + 1))) child.stdin.write(Uint8Array.of(byte));
				child.stdin.end();
			}
		});
		child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
		child.on("error", (error) => {
			failure = error;
		});
		child.stdin.on("error", (error) => {
			failure = error;
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			if (failure) reject(failure);
			else resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
		});
		for (const byte of bytes(value.slice(0, value.indexOf("\n") + 1))) child.stdin.write(Uint8Array.of(byte));
	});
}
describe.skipIf(!binary)("real Rust executable interop, opt in with N02_TEST_BINARY", () => {
	it("observes ready then typed not-started refusal and direct-child close", () => {
		const result = exchange(input);
		expect(result.status).toBe(0);
		expect(result.stderr.length).toBe(0);
		const output = frames(result.stdout);
		expect(output).toHaveLength(2);
		expect(decodeReply(output[0], identity, "ready")).toEqual(ready);
		expect(decodeReply(output[1], identity, "result")).toEqual(unsupported);
	});
	it("flushes ready before byte-by-byte execute and observes child close", async () => {
		const result = await exchangeByByte(input);
		expect(result.code).toBe(0);
		expect(result.stderr.length).toBe(0);
		expect(frames(result.stdout).map(parseMessage)).toEqual([ready, unsupported]);
	});
	it.each([
		"",
		"\n",
		`\ufeff${input}`,
		input.replaceAll("\n", "\r\n"),
		input.slice(0, -1),
		...malformed
			.filter((value) => !value.includes('"type":"ready"') && !value.includes('"type":"result"'))
			.map((value) => `${value}\n`),
		`${JSON.stringify(execute)}\n`,
		`${text}\n${text}\n`,
		`${text}\n${JSON.stringify({ ...execute, data: { ...execute.data, controlSeq: 3 } })}\n`,
		`${text}\n${JSON.stringify({ ...execute, data: { ...execute.data, identity: { ...identity, generation: 2 } } })}\n`,
	])("rejects invalid real input without executing: %s", (value) => {
		const result = exchange(value);
		expect(result.status).not.toBe(0);
		expect(result.stderr.toString()).toMatch(/^[A-Za-z_]{1,32}\n$/);
		if (result.stdout.length) expect(frames(result.stdout).map(parseMessage)).toEqual([ready]);
	});
});
