import { createServer } from "node:http";
import { createServer as createHttp2Server, type ServerHttp2Session } from "node:http2";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamBedrock } from "../src/providers/amazon-bedrock.ts";

// AWS event-stream-encoded messageStart, contentBlockDelta ("hello"), and messageStop fixtures.
const START = Buffer.from(
	"AAAAdgAAAFKW1freDTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcADG1lc3NhZ2VTdGFydA06Y29udGVudC10eXBlBwAQYXBwbGljYXRpb24vanNvbnsicm9sZSI6ImFzc2lzdGFudCJ9HMa+GA==",
	"base64",
);
const DELTA = Buffer.from(
	"AAAAlwAAAFfzC+A+DTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcAEWNvbnRlbnRCbG9ja0RlbHRhDTpjb250ZW50LXR5cGUHABBhcHBsaWNhdGlvbi9qc29ueyJjb250ZW50QmxvY2tJbmRleCI6MCwiZGVsdGEiOnsidGV4dCI6ImhlbGxvIn19Kqnv4g==",
	"base64",
);
const STOP = Buffer.from(
	"AAAAegAAAFHKLEZlDTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcAC21lc3NhZ2VTdG9wDTpjb250ZW50LXR5cGUHABBhcHBsaWNhdGlvbi9qc29ueyJzdG9wUmVhc29uIjoiZW5kX3R1cm4ifT3DO/o=",
	"base64",
);

afterEach(() => vi.unstubAllEnvs());

describe("Bedrock client lifecycle", () => {
	it("closes an owned HTTP connection after an error response", async () => {
		vi.stubEnv("NO_PROXY", "*");
		vi.stubEnv("no_proxy", "*");
		vi.stubEnv("AWS_BEDROCK_FORCE_HTTP1", "1");
		vi.stubEnv("AWS_BEDROCK_SKIP_AUTH", "1");
		vi.stubEnv("AWS_REGION", "us-east-1");
		vi.stubEnv("AWS_PROFILE", "");
		const sockets = new Set<Socket>();
		const server = createServer((_req, res) => {
			res.writeHead(400, { "content-type": "application/json", "content-length": "2" });
			res.end("{}");
		});
		server.on("connection", (socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing address");
			const model = {
				...getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8"),
				baseUrl: `http://127.0.0.1:${address.port}`,
			};
			const result = await streamBedrock(model, {
				messages: [{ role: "user", content: "test", timestamp: 0 }],
			}).result();
			expect(result.stopReason).toBe("error");
			await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 2_000, interval: 10 });
		} finally {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it.each(["complete", "abort"] as const)("closes its client after a real HTTP event stream: %s", async (mode) => {
		vi.stubEnv("NO_PROXY", "*");
		vi.stubEnv("no_proxy", "*");
		vi.stubEnv("AWS_BEDROCK_FORCE_HTTP1", "1");
		vi.stubEnv("AWS_BEDROCK_SKIP_AUTH", "1");
		vi.stubEnv("AWS_REGION", "us-east-1");
		vi.stubEnv("AWS_PROFILE", "");
		const sockets = new Set<Socket>();
		const server = createServer((_req, res) => {
			res.writeHead(200, { "content-type": "application/vnd.amazon.eventstream" });
			res.write(START);
			res.write(DELTA);
			if (mode === "complete") setTimeout(() => res.end(STOP), 25);
		});
		server.on("connection", (socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing address");
			const model = {
				...getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8"),
				baseUrl: `http://127.0.0.1:${address.port}`,
			};
			const controller = new AbortController();
			const stream = streamBedrock(
				model,
				{ messages: [{ role: "user", content: "test", timestamp: 0 }] },
				{ signal: controller.signal },
			);
			let text = "";
			for await (const event of stream) {
				if (event.type === "text_delta") {
					text += event.delta;
					if (mode === "abort") controller.abort();
				}
			}
			const result = await stream.result();
			expect(text).toBe("hello");
			expect(result.stopReason).toBe(mode === "abort" ? "aborted" : "stop");
			await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 2_000, interval: 10 });
		} finally {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("closes its default HTTP/2 session after receiving the complete event stream", async () => {
		vi.stubEnv("NO_PROXY", "*");
		vi.stubEnv("no_proxy", "*");
		vi.stubEnv("AWS_BEDROCK_FORCE_HTTP1", "0");
		vi.stubEnv("AWS_BEDROCK_SKIP_AUTH", "1");
		vi.stubEnv("AWS_REGION", "us-east-1");
		vi.stubEnv("AWS_PROFILE", "");
		const sessions = new Set<ServerHttp2Session>();
		const server = createHttp2Server();
		server.on("session", (session) => {
			sessions.add(session);
			session.on("close", () => sessions.delete(session));
		});
		server.on("stream", (stream) => {
			stream.respond({ ":status": 200, "content-type": "application/vnd.amazon.eventstream" });
			stream.write(START);
			stream.write(DELTA);
			setTimeout(() => stream.end(STOP), 25);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing address");
			const model = {
				...getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8"),
				baseUrl: `http://127.0.0.1:${address.port}`,
			};
			const stream = streamBedrock(model, { messages: [{ role: "user", content: "test", timestamp: 0 }] });
			let text = "";
			for await (const event of stream) if (event.type === "text_delta") text += event.delta;
			expect(text).toBe("hello");
			expect((await stream.result()).stopReason).toBe("stop");
			await vi.waitFor(() => expect(sessions.size).toBe(0), { timeout: 2_000, interval: 10 });
		} finally {
			for (const session of sessions) session.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
