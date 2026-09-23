import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel, getSupportedThinkingLevels } from "../src/models.ts";
import { encodeFrame } from "../src/providers/devin-connect.ts";
import { field, ProtoMessage } from "../src/providers/devin-protobuf.ts";
import { completeSimple, streamSimple } from "../src/stream.ts";
import type { AssistantMessageEvent, Context } from "../src/types.ts";
import { isContextOverflow } from "../src/utils/overflow.ts";
import { isRetryableAssistantError } from "../src/utils/retry.ts";

const token = "devin-session-token$fixture-only";
const context: Context = {
	systemPrompt: "Use the supplied tools.",
	messages: [{ role: "user", content: "Add two numbers", timestamp: 1 }],
	tools: [{ name: "add", description: "Add", parameters: Type.Object({ a: Type.Number() }) }],
};
const bytes = (...parts: Uint8Array[]) => Buffer.concat(parts);
const end = () => encodeFrame(Buffer.from("{}"), 2);
const STANDARD_WINDOW = 262144;
const LONG_WINDOW = 1_000_000;
/** Each effort declares a standard lane and, unless `lanes` says otherwise, a separate 1M-context lane. */
function catalog(
	efforts = ["medium", "high", "max"],
	lanes: readonly ("standard" | "1m")[] = ["standard", "1m"],
): Buffer {
	return bytes(
		...efforts.flatMap((effort) =>
			lanes.map((lane) =>
				field(
					1,
					bytes(
						field(1, `SWE-2 ${effort}${lane === "1m" ? " 1M" : ""}`),
						field(22, `fixture-swe2-${effort}${lane === "1m" ? "-1m" : ""}`),
						field(18, lane === "1m" ? LONG_WINDOW : STANDARD_WINDOW),
						field(23, bytes(field(13, 65536))),
						field(
							30,
							bytes(
								field(1, "SWE-2"),
								field(2, bytes(field(1, "Reasoning Effort"), field(2, bytes(field(2, effort))))),
								field(
									2,
									bytes(
										field(1, "1M Context"),
										field(2, bytes(field(1, lane === "1m" ? 1 : 0), field(2, lane === "1m" ? "On" : "Off"))),
									),
								),
							),
						),
					),
				),
			),
		),
	);
}
function mockApi(frames: Uint8Array[], models = catalog()) {
	const requests: Request[] = [];
	const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push(request);
		if (request.url.endsWith("GetUserJwt")) return new Response(field(1, "fixture-user-jwt"));
		if (request.url.endsWith("GetCliModelConfigs")) return new Response(models);
		return new Response(
			new ReadableStream({
				start(controller) {
					for (const frame of frames) {
						// Fragment both the frame prefix and payload across reads.
						controller.enqueue(frame.slice(0, 2));
						controller.enqueue(frame.slice(2, 7));
						controller.enqueue(frame.slice(7));
					}
					controller.close();
				},
			}),
		);
	});
	vi.stubGlobal("fetch", mock);
	return { mock, requests };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("Devin SWE-2 via the public stream API", () => {
	it("keeps the Connect frame cap local so a stale unary module cannot fail named import", () => {
		const source = readFileSync(new URL("../src/providers/devin-connect-stream.ts", import.meta.url), "utf8");
		expect(source).not.toMatch(/import\s*\{[^}]*\bMAX_FRAME_BYTES\b/);
		expect(source).toMatch(/const MAX_FRAME_BYTES = 16 \* 1024 \* 1024/);
	});

	it("exposes exactly the documented reasoning ladder and a 1M-token local budget", () => {
		const model = getModel("devin", "swe-2");
		expect(getSupportedThinkingLevels(model)).toEqual(["medium", "high", "max"]);
		expect(model.contextWindow).toBe(LONG_WINDOW);
	});

	it.each(["medium", "high", "max"] as const)(
		"routes %s to the account catalog UID, with tools and usage",
		async (reasoning) => {
			const { requests } = mockApi([
				encodeFrame(field(9, "Plan")),
				encodeFrame(gzipSync(field(3, "Answer")), 1),
				encodeFrame(bytes(field(5, 2), field(7, bytes(field(2, 10), field(3, 20), field(4, 3), field(5, 5))))),
				end(),
			]);
			const events: AssistantMessageEvent[] = [];
			const stream = streamSimple(getModel("devin", "swe-2"), context, {
				apiKey: token,
				reasoning,
				sessionId: "fixture-session",
			});
			for await (const event of stream) events.push(event);
			const output = await stream.result();
			expect(output.errorMessage).toBeUndefined();
			expect(output.content).toEqual([
				{ type: "thinking", thinking: "Plan" },
				{ type: "text", text: "Answer" },
			]);
			expect(output.usage).toMatchObject({ input: 10, output: 20, cacheWrite: 3, cacheRead: 5, totalTokens: 38 });
			expect(events.map((event) => event.type)).toEqual([
				"start",
				"thinking_start",
				"thinking_delta",
				"thinking_end",
				"text_start",
				"text_delta",
				"text_end",
				"done",
			]);
			const chat = requests.find((request) => request.url.endsWith("GetChatMessage"));
			expect(chat).toBeDefined();
			const body = Buffer.from(await chat!.arrayBuffer());
			const wire = new ProtoMessage(body.subarray(5));
			expect(wire.string(21)).toBe(`fixture-swe2-${reasoning}-1m`);
			expect(wire.string(2)).toBe(context.systemPrompt);
			expect(wire.string(16)).toBe("fixture-session");
			expect(wire.messages(10)[0].string(1)).toBe("add");
			expect(wire.messages(1)[0].string(3)).toBe(token);
			expect(wire.messages(1)[0].string(21)).toBe("fixture-user-jwt");
			expect(requests.every((request) => request.redirect === "error")).toBe(true);
		},
	);

	it("preserves cumulative and incremental tool arguments and sends the result on the next turn", async () => {
		const { requests } = mockApi([
			encodeFrame(field(6, bytes(field(1, "call-1"), field(2, "add"), field(3, '{"a":')))),
			encodeFrame(field(6, bytes(field(3, '{"a":2')))),
			encodeFrame(field(6, bytes(field(3, "}")))),
			encodeFrame(field(5, 10)),
			end(),
		]);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token, reasoning: "max" });
		expect(result.stopReason).toBe("toolUse");
		expect(result.content).toEqual([{ type: "toolCall", id: "call-1", name: "add", arguments: { a: 2 } }]);
		await completeSimple(
			getModel("devin", "swe-2"),
			{
				...context,
				messages: [
					...context.messages,
					result,
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "add",
						isError: false,
						content: [{ type: "text", text: "2" }],
						timestamp: 2,
					},
				],
			},
			{ apiKey: token, reasoning: "max" },
		);
		const last = requests.at(-1)!;
		const wire = new ProtoMessage(Buffer.from(await last.arrayBuffer()).subarray(5));
		const history = wire.messages(3);
		expect(history[1].messages(6)[0].string(3)).toBe('{"a":2}');
		expect(history[2].number(2)).toBe(4);
		expect(history[2].string(7)).toBe("call-1");
	});

	it("never silently downgrades max when the account lacks that route", async () => {
		const { requests } = mockApi([], catalog(["medium", "high"]));
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token, reasoning: "max" });
		expect(result.errorMessage).toMatch(/SWE-2.*max.*unavailable/i);
		expect(requests.some((request) => request.url.endsWith("GetChatMessage"))).toBe(false);
	});

	it("uses the standard lane when models.json lowers the budget below 1M", async () => {
		const { requests } = mockApi([encodeFrame(field(3, "OK")), end()]);
		const model = { ...getModel("devin", "swe-2"), contextWindow: 128_000 };
		const result = await completeSimple(model, context, { apiKey: token, reasoning: "high" });
		expect(result.errorMessage).toBeUndefined();
		const chat = requests.find((request) => request.url.endsWith("GetChatMessage"));
		const wire = new ProtoMessage(Buffer.from(await chat!.arrayBuffer()).subarray(5));
		expect(wire.string(21)).toBe("fixture-swe2-high");
	});

	it("fails closed when no lane can serve the 1M budget instead of shrinking it", async () => {
		const { requests } = mockApi([], catalog(["medium", "high", "max"], ["standard"]));
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token, reasoning: "max" });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toMatch(
			/standard lane declares a 262144-token context window; lower the models.json contextWindow/,
		);
		expect(requests.some((request) => request.url.endsWith("GetChatMessage"))).toBe(false);
	});

	it("accepts a standard lane that already serves the full budget", async () => {
		const wide = bytes(
			field(
				1,
				bytes(
					field(22, "fixture-swe2-max-wide"),
					field(18, LONG_WINDOW),
					field(
						30,
						bytes(field(1, "SWE-2"), field(2, bytes(field(1, "Effort"), field(2, bytes(field(2, "max")))))),
					),
				),
			),
		);
		const { requests } = mockApi([encodeFrame(field(3, "OK")), end()], wide);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token, reasoning: "max" });
		expect(result.errorMessage).toBeUndefined();
		const chat = requests.find((request) => request.url.endsWith("GetChatMessage"));
		const wire = new ProtoMessage(Buffer.from(await chat!.arrayBuffer()).subarray(5));
		expect(wire.string(21)).toBe("fixture-swe2-max-wide");
	});

	it("does not send credentials to a model endpoint override", async () => {
		const { mock } = mockApi([]);
		const model = { ...getModel("devin", "swe-2"), baseUrl: "https://untrusted.example" };
		const result = await completeSimple(model, context, { apiKey: token });
		expect(result.errorMessage).toMatch(/origin/i);
		expect(mock).not.toHaveBeenCalled();
	});

	it("classifies resource_exhausted as quota, not a retryable rate limit", async () => {
		mockApi([encodeFrame(Buffer.from('{"error":{"code":"resource_exhausted","message":"quota exceeded"}}'), 2)]);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token });
		expect(result.errorMessage).toBe("Devin quota exceeded");
		expect(result.errorMessage).not.toMatch(/rate limit/i);
		expect(isRetryableAssistantError(result)).toBe(false);
		expect(isContextOverflow(result, 262000)).toBe(false);
	});

	it("does not treat a body-less invalid_argument as context overflow", async () => {
		mockApi([
			encodeFrame(Buffer.from('{"error":{"code":"invalid_argument","message":"temperature must be positive"}}'), 2),
		]);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token });
		expect(result.errorMessage).toBe("Devin stream error: invalid_argument");
		expect(isContextOverflow(result, 262000)).toBe(false);
	});

	it.each([
		["truncated", [Buffer.from([0, 0, 0, 0, 9, 1])]],
		["oversized", [Buffer.from([0, 127, 255, 255, 255])]],
		["missing terminal", [encodeFrame(field(3, "partial"))]],
		["invalid trailer", [encodeFrame(Buffer.from("not json"), 2)]],
		[
			"server failure",
			[encodeFrame(Buffer.from('{"error":{"code":"resource_exhausted","message":"quota exceeded"}}'), 2)],
		],
	] as const)("fails closed on %s streams", async (_name, frames) => {
		mockApi([...frames]);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).not.toContain(token);
	});

	it("rejects an authentication redirect before forwarding the session token", async () => {
		const { mock } = mockApi([]);
		mock.mockImplementationOnce(
			async () => new Response(bytes(field(1, "fixture-jwt"), field(2, "https://untrusted.example"))),
		);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token });
		expect(result.errorMessage).toMatch(/origin/);
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it("fails once on rejected credentials without echoing or retrying the response", async () => {
		const { mock } = mockApi([]);
		mock.mockImplementationOnce(async () => new Response(token, { status: 401 }));
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token });
		expect(result.errorMessage).toBe("Devin request failed (HTTP 401)");
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it("keeps auth metadata out of the payload observer", async () => {
		mockApi([encodeFrame(field(3, "OK")), end()]);
		const onPayload = vi.fn((payload: unknown) => {
			expect(payload).toBeInstanceOf(Uint8Array);
			if (!(payload instanceof Uint8Array)) throw new Error("Expected protobuf bytes");
			expect(new ProtoMessage(payload).messages(1)).toEqual([]);
			expect(Buffer.from(payload).toString()).not.toContain(token);
		});
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token, onPayload });
		expect(result.stopReason).toBe("stop");
		expect(onPayload).toHaveBeenCalledOnce();
	});

	it("does not execute a partially received tool call", async () => {
		mockApi([encodeFrame(field(6, bytes(field(1, "call"), field(2, "add"), field(3, '{"a":')))), end()]);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toMatch(/incomplete tool arguments/);
	});

	it.each([0, -0.1, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects unsupported temperature %s before sending credentials",
		async (temperature) => {
			const { mock } = mockApi([encodeFrame(field(3, "OK")), end()]);
			const result = await completeSimple(getModel("devin", "swe-2"), context, {
				apiKey: token,
				temperature,
			});
			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/temperature.*greater than 0/i);
			expect(mock).not.toHaveBeenCalled();
		},
	);

	it.each([undefined, 0.2, 1])("preserves supported temperature %s", async (temperature) => {
		const { requests } = mockApi([encodeFrame(field(3, "OK")), end()]);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token, temperature });
		expect(result.stopReason).toBe("stop");
		const wire = new ProtoMessage(Buffer.from(await requests.at(-1)!.arrayBuffer()).subarray(5));
		expect(wire.messages(8)[0].number(5)).toBe(temperature ?? 1);
	});

	it.each([
		["0123456789abcdef0123456789abcdef", " (trace ID: 0123456789abcdef0123456789abcdef)"],
		["<script>alert(1)</script>", ""],
		["a".repeat(80), ""],
	])("retains only a bounded hex trace ID: %s", async (traceId, suffix) => {
		const { mock } = mockApi([
			encodeFrame(
				Buffer.from(
					JSON.stringify({
						error: { code: "invalid_argument", message: `private ${token} (trace ID: ${traceId})` },
					}),
				),
				2,
			),
		]);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token });
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe(`Devin stream error: invalid_argument${suffix}`);
		expect(result.errorMessage).not.toContain(token);
		expect(result.errorMessage).not.toContain("private");
		expect(mock).toHaveBeenCalledTimes(3);
	});

	it("rejects unsupported reasoning before sending credentials", async () => {
		const { mock } = mockApi([]);
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token, reasoning: "low" });
		expect(result.errorMessage).toMatch(/does not support low/);
		expect(mock).not.toHaveBeenCalled();
	});

	it("honors cancellation before any credential request", async () => {
		const { mock } = mockApi([]);
		const signal = AbortSignal.abort();
		const result = await completeSimple(getModel("devin", "swe-2"), context, { apiKey: token, signal });
		expect(result.stopReason).toBe("aborted");
		expect(mock).not.toHaveBeenCalled();
	});
});
