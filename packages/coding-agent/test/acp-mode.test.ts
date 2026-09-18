import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { AcpAgent, type AcpSession } from "../src/modes/acp/acp-agent.ts";
import { serveAcp } from "../src/modes/acp/acp-transport.ts";

describe("ACP CLI recognition", () => {
	it("selects ACP instead of silently falling back to interactive mode", () => {
		expect(parseArgs(["--mode", "acp"]).mode).toBe("acp");
	});
});

function fixture() {
	const emit = vi.fn();
	const session: AcpSession = {
		prompt: vi.fn<AcpSession["prompt"]>(async (_text, update) => {
			update("hello");
			return "end_turn";
		}),
		cancel: vi.fn(async () => {}),
		dispose: vi.fn(),
	};
	const create = vi.fn(async () => session);
	return { agent: new AcpAgent(create, "test", emit), emit, session, create };
}

describe("ACP restricted conversation protocol", () => {
	it("initializes without creating a session and negotiates v1", async () => {
		const { agent, create } = fixture();
		expect(await agent.dispatch("initialize", { protocolVersion: 999 })).toMatchObject({
			protocolVersion: 1,
			agentInfo: { name: "omk" },
			agentCapabilities: { loadSession: false, _meta: { "omk/profile": "conversation-only" } },
		});
		expect(create).not.toHaveBeenCalled();
	});
	it("requires initialization and rejects client MCP commands", async () => {
		const { agent, create } = fixture();
		await expect(agent.dispatch("session/new", { cwd: "/tmp", mcpServers: [] })).rejects.toThrow("Initialize first");
		await agent.dispatch("initialize", { protocolVersion: 1 });
		await expect(
			agent.dispatch("session/new", { cwd: "/tmp", mcpServers: [{ command: "anything" }] }),
		).rejects.toThrow("empty mcpServers");
		expect(create).not.toHaveBeenCalled();
	});
	it("binds cwd, streams text, supports resource links without retrieval", async () => {
		const { agent, create, session, emit } = fixture();
		await agent.dispatch("initialize", { protocolVersion: 1 });
		const { sessionId } = (await agent.dispatch("session/new", { cwd: "/tmp", mcpServers: [] })) as {
			sessionId: string;
		};
		expect(create).toHaveBeenCalledWith("/tmp");
		expect(
			await agent.dispatch("session/prompt", {
				sessionId,
				prompt: [
					{ type: "text", text: "hi" },
					{ type: "resource_link", name: "source", uri: "file:///tmp/a" },
				],
			}),
		).toEqual({ stopReason: "end_turn" });
		expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining("file:///tmp/a"), expect.any(Function));
		expect(emit).toHaveBeenCalledWith(expect.objectContaining({ method: "session/update" }));
		await agent.close();
		expect(session.dispose).toHaveBeenCalledOnce();
	});
	it("cancels while a prompt is pending and refuses overlapping prompts", async () => {
		const { agent, session } = fixture();
		let finish!: () => void;
		session.prompt = vi.fn<AcpSession["prompt"]>(
			() =>
				new Promise((resolve) => {
					finish = () => resolve("cancelled");
				}),
		);
		session.cancel = vi.fn(async () => {
			finish();
		});
		await agent.dispatch("initialize", { protocolVersion: 1 });
		const { sessionId } = (await agent.dispatch("session/new", { cwd: "/tmp", mcpServers: [] })) as {
			sessionId: string;
		};
		const params = { sessionId, prompt: [{ type: "text", text: "hi" }] };
		const pending = agent.dispatch("session/prompt", params);
		await expect(agent.dispatch("session/prompt", params)).rejects.toThrow("busy");
		await agent.dispatch("session/cancel", { sessionId });
		expect(await pending).toEqual({ stopReason: "cancelled" });
	});
	it("uses JSON-RPC results and errors, never OMK RPC success", async () => {
		const input = new PassThrough();
		const output = vi.fn();
		const { create } = fixture();
		const done = serveAcp(input, output, create, "test");
		input.end('{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1}}\n{broken}\n');
		await done;
		expect(output).toHaveBeenCalledWith(
			expect.objectContaining({ id: 0, result: expect.objectContaining({ protocolVersion: 1 }) }),
		);
		expect(output).toHaveBeenCalledWith(
			expect.objectContaining({ id: null, error: { code: -32700, message: "Parse error" } }),
		);
		expect(JSON.stringify(output.mock.calls)).not.toContain('"success"');
	});
	it("rejects oversized unterminated frames without creating sessions", async () => {
		const input = new PassThrough();
		const output = vi.fn();
		const { create } = fixture();
		const done = serveAcp(input, output, create, "test");
		input.end("x".repeat(1024 * 1024 + 1));
		await done;
		expect(output).toHaveBeenCalledWith(
			expect.objectContaining({ error: { code: -32600, message: "Frame too large" } }),
		);
		expect(create).not.toHaveBeenCalled();
	});
});
