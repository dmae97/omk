import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { AcpAgent, AcpError, type AcpSessionFactory } from "./acp-agent.ts";

/** LF-only JSON-RPC transport, bounded per frame and in-flight request set. */
export async function serveAcp(
	input: Readable,
	output: (message: object) => void,
	createSession: AcpSessionFactory,
	version: string,
): Promise<void> {
	const agent = new AcpAgent(createSession, version, output);
	const pending = new Set<Promise<void>>();
	const ids = new Set<string | number>();
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	const maxBytes = 1024 * 1024;
	const fail = (id: unknown, code: number, message: string) =>
		output({ jsonrpc: "2.0", id, error: { code, message } });
	const receive = (line: string): void => {
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			fail(null, -32700, "Parse error");
			return;
		}
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			fail(null, -32600, "Invalid request");
			return;
		}
		const request = raw as Record<string, unknown>;
		const id = request.id;
		const hasId = Object.hasOwn(request, "id");
		const validId = typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id));
		if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || (hasId && !validId)) {
			fail(validId ? id : null, -32600, "Invalid request");
			return;
		}
		// Only cancellation is a notification. No session creation/provider call without a response ID.
		if (!hasId && request.method !== "session/cancel") return;
		if (hasId && validId && ids.has(id)) {
			fail(id, -32600, "Duplicate in-flight id");
			return;
		}
		if (pending.size >= 32) {
			if (hasId) fail(id, -32000, "Request limit reached");
			return;
		}
		if (validId) ids.add(id);
		const work = agent
			.dispatch(request.method, request.params ?? {})
			.then(
				(result) => {
					if (hasId) output({ jsonrpc: "2.0", id, result });
				},
				(error: unknown) => {
					if (hasId)
						fail(
							id,
							error instanceof AcpError ? error.code : -32603,
							error instanceof AcpError ? error.message : "Agent operation failed",
						);
				},
			)
			.finally(() => {
				pending.delete(work);
				if (validId) ids.delete(id);
			});
		pending.add(work);
	};
	try {
		for await (const chunk of input) {
			buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline);
				if (Buffer.byteLength(line) > maxBytes) throw new AcpError(-32600, "Frame too large");
				receive(line);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
			}
			if (Buffer.byteLength(buffer) > maxBytes) throw new AcpError(-32600, "Frame too large");
		}
		buffer += decoder.end();
		if (buffer.trim()) fail(null, -32700, "Incomplete JSONL frame");
	} catch (error) {
		fail(
			null,
			error instanceof AcpError ? error.code : -32603,
			error instanceof AcpError ? error.message : "Transport failed",
		);
	} finally {
		await agent.close();
		await Promise.all(pending);
	}
}
