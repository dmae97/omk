import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.ts";
import { resolveCursorWireModel, streamCursor } from "../src/providers/cursor.ts";
import { field, ProtoMessage } from "../src/providers/devin-protobuf.ts";
import type { Context } from "../src/types.ts";

const context: Context = {
	systemPrompt: "Be brief.",
	messages: [{ role: "user", content: "Reply with the single word: pong", timestamp: 1 }],
};

function frame(payload: Uint8Array, flags = 0): Buffer {
	const out = Buffer.alloc(5 + payload.length);
	out[0] = flags;
	out.writeUInt32BE(payload.length, 1);
	out.set(payload, 5);
	return out;
}

interface CapturedClient {
	runRequest?: ProtoMessage;
	execResults: ProtoMessage[];
	throws: ProtoMessage[];
	streamCloses: ProtoMessage[];
	kvResults: ProtoMessage[];
	interactionResponses: ProtoMessage[];
	heartbeats: number;
}

interface ServerBehavior {
	/** Frames the server sends immediately after the run request arrives. */
	respond?: (send: (payload: Uint8Array, flags?: number) => void) => void;
	onExecRequestContext?: boolean;
	onGetBlob?: (blobData: Uint8Array | undefined) => void;
	onRunRequest?: (request: ProtoMessage) => void;
}

function startServer(
	behavior: ServerBehavior,
): Promise<{ url: string; captured: CapturedClient; close: () => Promise<void> }> {
	const captured: CapturedClient = {
		execResults: [],
		throws: [],
		streamCloses: [],
		kvResults: [],
		interactionResponses: [],
		heartbeats: 0,
	};
	const server = http2.createServer();
	const pendingClose = new Promise<void>((resolve) => {
		server.on("stream", (stream, headers) => {
			if (headers[":path"] !== "/agent.v1.AgentService/Run") {
				stream.close();
				return;
			}
			stream.respond({ ":status": 200, "content-type": "application/connect+proto" });
			const send = (payload: Uint8Array, flags = 0) => {
				if (!stream.destroyed) stream.write(frame(payload, flags));
			};
			let pending = Buffer.alloc(0);
			stream.on("data", (chunk: Buffer) => {
				pending = Buffer.concat([pending, chunk]);
				let consumed = 0;
				while (consumed + 5 <= pending.length) {
					const length = pending.readUInt32BE(consumed + 1);
					if (consumed + 5 + length > pending.length) break;
					const payload = pending.subarray(consumed + 5, consumed + 5 + length);
					consumed += 5 + length;
					const message = new ProtoMessage(payload);
					if (message.has(1)) {
						const request = message.messages(1)[0];
						captured.runRequest = request;
						behavior.onRunRequest?.(request);
						behavior.respond?.(send);
						// Server half-close: the client keeps writing exec/kv answers on the
						// same stream, but this is what makes its `end` handler fire.
						stream.end();
						continue;
					}
					if (message.has(2)) {
						for (const exec of message.messages(2)) {
							captured.execResults.push(exec);
						}
						continue;
					}
					if (message.has(3)) {
						for (const kv of message.messages(3)) {
							captured.kvResults.push(kv);
							if (kv.has(2)) {
								const result = kv.messages(2)[0];
								behavior.onGetBlob?.(result.bytes(1));
							}
						}
						continue;
					}
					if (message.has(5)) {
						for (const control of message.messages(5)) {
							if (control.has(1)) captured.streamCloses.push(control.messages(1)[0]);
							if (control.has(2)) captured.throws.push(control.messages(2)[0]);
						}
						continue;
					}
					if (message.has(6)) {
						for (const response of message.messages(6)) captured.interactionResponses.push(response);
						continue;
					}
					if (message.has(7)) captured.heartbeats++;
				}
				pending = pending.subarray(consumed);
			});
			stream.on("end", () => {
				stream.end();
			});
			stream.on("close", () => {
				resolve();
			});
		});
	});
	return new Promise((resolveListen) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			resolveListen({
				url: `http://127.0.0.1:${port}`,
				captured,
				close: async () => {
					await pendingClose.catch(() => {});
					await new Promise<void>((resolve) => server.close(() => resolve()));
				},
			});
		});
	});
}

const update = (payload: Buffer) => field(1, payload);
const textDelta = (text: string) => update(field(1, field(1, text)));
const thinkingDelta = (text: string) => update(field(4, field(1, text)));
const tokenDelta = (tokens: number) => update(field(8, field(1, tokens)));
const turnEnded = () => update(field(14, field(1, "done")));
const execServerMessage = (id: number, execId: string, caseField: Buffer) =>
	field(2, Buffer.concat([field(1, id), field(15, execId), caseField]));
const kvGetBlob = (id: number, blobId: Uint8Array) =>
	field(4, Buffer.concat([field(1, id), field(2, field(1, blobId))]));
describe("Cursor wire model resolution", () => {
	it("splits OpenAI-family effort slugs into base id + reasoning parameter", () => {
		const { modelId, parameters } = resolveCursorWireModel("gpt-5.4-mini-low");
		expect(modelId).toBe("gpt-5.4-mini");
		expect(parameters).toHaveLength(1);
		const param = new ProtoMessage(parameters[0]);
		expect(param.string(1)).toBe("reasoning");
		expect(param.string(2)).toBe("low");
	});

	it("keeps the fast lane while splitting effort", () => {
		expect(resolveCursorWireModel("gpt-5.2-low-fast").modelId).toBe("gpt-5.2-fast");
	});

	it("drops the reasoning parameter for the none tier", () => {
		expect(resolveCursorWireModel("gpt-5.5-none")).toEqual({ modelId: "gpt-5.5", parameters: [] });
	});

	it("pins composer-2.5 to the standard tier", () => {
		const { modelId, parameters } = resolveCursorWireModel("composer-2.5");
		expect(modelId).toBe("composer-2.5");
		const param = new ProtoMessage(parameters[0]);
		expect(param.string(1)).toBe("fast");
		expect(param.string(2)).toBe("false");
	});

	it("passes non-OpenAI slugs through unchanged", () => {
		expect(resolveCursorWireModel("claude-opus-5-thinking-high")).toEqual({
			modelId: "claude-opus-5-thinking-high",
			parameters: [],
		});
	});
});

describe("Cursor stream", () => {
	it("streams text, thinking, and usage to a done result", async () => {
		const server = await startServer({
			respond: (send) => {
				send(thinkingDelta("thinking "));
				send(textDelta("po"));
				send(textDelta("ng"));
				send(tokenDelta(7));
				send(turnEnded());
				send(Buffer.from("{}"), 2);
			},
		});
		const model = { ...getModel("cursor", "default"), baseUrl: server.url };
		const result = await streamCursor(model, context, { apiKey: "fixture-token" }).result();
		await server.close();
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "thinking ", thinkingSignature: "" },
			{ type: "text", text: "pong" },
		]);
		expect(result.usage.output).toBe(7);
	});

	it("sends runRequest with conversation state, action, and requested model", async () => {
		const server = await startServer({
			respond: (send) => {
				send(turnEnded());
				send(Buffer.from("{}"), 2);
			},
		});
		const model = { ...getModel("cursor", "default"), baseUrl: server.url };
		await streamCursor(model, context, { apiKey: "fixture-token" }).result();
		await server.close();
		const request = server.captured.runRequest!;
		expect(request.messages(1)[0].bytesList(1).length).toBeGreaterThan(0); // conversationState blobs
		const action = request.messages(2)[0];
		expect(action.has(1)).toBe(true); // userMessageAction
		const userMessage = action.messages(1)[0].messages(1)[0];
		expect(userMessage.string(1)).toBe("Reply with the single word: pong");
		const requestedModel = request.messages(9)[0];
		expect(requestedModel.string(1)).toBe("default");
	});

	it("answers getBlobArgs with the stored blob data", async () => {
		let blobJson = "";
		const server = await startServer({
			respond: (send) => {
				// Ask for the first blob in rootPromptMessagesJson.
				const request = server.captured.runRequest!;
				const blobId = request.messages(1)[0].bytesList(1)[0];
				send(kvGetBlob(3, blobId));
				send(turnEnded());
				send(Buffer.from("{}"), 2);
			},
			onGetBlob: (data) => {
				blobJson = new TextDecoder().decode(data ?? new Uint8Array(0));
			},
		});
		const model = { ...getModel("cursor", "default"), baseUrl: server.url };
		await streamCursor(model, context, { apiKey: "fixture-token" }).result();
		await server.close();
		expect(JSON.parse(blobJson)).toEqual({ role: "system", content: "Be brief." });
	});

	it("answers requestContextArgs with rules carrying the system prompt", async () => {
		const server = await startServer({
			respond: (send) => {
				send(execServerMessage(11, "exec-1", field(10, new Uint8Array(0))));
				send(turnEnded());
				send(Buffer.from("{}"), 2);
			},
		});
		const model = { ...getModel("cursor", "default"), baseUrl: server.url };
		await streamCursor(model, context, { apiKey: "fixture-token" }).result();
		await server.close();
		expect(server.captured.execResults).toHaveLength(1);
		const exec = server.captured.execResults[0];
		expect(exec.number(1)).toBe(11);
		const result = exec.messages(10)[0].messages(1)[0].messages(1)[0];
		const rules = result.messages(2);
		expect(rules.length).toBeGreaterThan(0);
		expect(rules[0].string(2)).toBe("Be brief.");
	});

	it("throws on unimplemented exec frames instead of stalling", async () => {
		const server = await startServer({
			respond: (send) => {
				send(execServerMessage(9, "exec-9", field(2, new Uint8Array(0)))); // shellArgs
				send(turnEnded());
				send(Buffer.from("{}"), 2);
			},
		});
		const model = { ...getModel("cursor", "default"), baseUrl: server.url };
		await streamCursor(model, context, { apiKey: "fixture-token" }).result();
		await server.close();
		expect(server.captured.throws).toHaveLength(1);
		expect(server.captured.throws[0].number(1)).toBe(9);
		expect(server.captured.throws[0].string(2)).toContain("not implemented");
		expect(server.captured.streamCloses).toHaveLength(1);
	});

	it("approves hosted search queries and rejects interactive ones", async () => {
		const server = await startServer({
			respond: (send) => {
				const query = (id: number, fieldNo: number) =>
					field(7, Buffer.concat([field(1, id), field(fieldNo, new Uint8Array(0))]));
				send(query(1, 2)); // webSearchRequestQuery → approved
				send(query(2, 3)); // askQuestion → rejected
				send(turnEnded());
				send(Buffer.from("{}"), 2);
			},
		});
		const model = { ...getModel("cursor", "default"), baseUrl: server.url };
		await streamCursor(model, context, { apiKey: "fixture-token" }).result();
		await server.close();
		const [search, ask] = server.captured.interactionResponses;
		expect(search.has(2) && search.messages(2)[0].has(1)).toBe(true); // approved {}
		expect(ask.has(3) && ask.messages(3)[0].has(3)).toBe(true); // rejected { reason }
	});

	it("surfaces Connect end-stream errors", async () => {
		const server = await startServer({
			respond: (send) => {
				send(
					new TextEncoder().encode(
						JSON.stringify({ error: { code: "permission_denied", message: "plan required" } }),
					),
					2,
				);
			},
		});
		const model = { ...getModel("cursor", "default"), baseUrl: server.url };
		const result = await streamCursor(model, context, { apiKey: "fixture-token" }).result();
		await server.close();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("permission_denied");
	});

	it("rejects non-Cursor origins before writing credentials", async () => {
		const model = { ...getModel("cursor", "default"), baseUrl: "https://untrusted.example" };
		const result = await streamCursor(model, context, { apiKey: "fixture-token" }).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("cursor");
	});
});
