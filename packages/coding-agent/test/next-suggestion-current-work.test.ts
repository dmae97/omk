import type { AssistantMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import type { RecordedMainRequest } from "../src/core/next-suggestion.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { NextSuggestionCandidate } from "../src/modes/interactive/next-suggestion-candidate.ts";
import { composeSuggestion } from "../src/modes/interactive/next-suggestion-run.ts";

const SUGGESTION_TEXT = "Run the parser tests next.";

const request = { role: "user", content: "Finish the parser" };
const propose = (messages: unknown[], modelText?: string) =>
	composeSuggestion({
		session: {
			agent: {
				state: { messages: [request, ...messages] },
				streamFn: () => {
					throw Error("unexpected request");
				},
			},
			model: undefined,
			subscribe: () => () => {},
		},
		canSend: true,
		outcome: "completed",
		modelText,
	})?.prompt;
const tool = (id: string, name: string, args: Record<string, string>, isError = false) => [
	{ role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] },
	{ role: "toolResult", toolCallId: id, toolName: name, isError, content: [] },
];
const edit = tool("1", "edit", { path: "src/a.ts" });
const check = tool("2", "bash", { command: "npm run check" });
const todo = (open: boolean) => ({
	role: "toolResult",
	toolName: "todo",
	isError: false,
	details: {
		tasks: [
			{ id: 1, subject: "Implement reader", status: "completed", blockedBy: [] },
			{ id: 2, subject: "Implement writer", status: "completed", blockedBy: [] },
			{ id: 3, subject: "Document parser usage", status: open ? "pending" : "completed", blockedBy: [1, 2] },
		],
	},
});

describe("current-work suggestions without task_result", () => {
	it("uses the latest task snapshot instead of a proposed completed task", () => {
		expect(propose([todo(true)], "Implement reader.")).toContain("Document parser usage");
		expect(propose([todo(true), todo(false)], "Implement reader.")).toBeUndefined();
		expect(propose([todo(true), todo(false)], "Open a PR for the parser changes.")).toBe(
			"Open a PR for the parser changes.",
		);
	});
	it("suppresses redundant checks only after a successful check, until a new edit or failure", () => {
		expect(propose([...edit, ...check], "Run npm run check again.")).toBeUndefined();
		// The engine shows only model text here; a new edit or a failed check re-admits it.
		const verify = "Run npm run check for src/a.ts.";
		expect(propose([...edit, ...check, ...tool("3", "edit", { path: "src/a.ts" })], verify)).toBe(verify);
		expect(propose([...edit, ...check, ...tool("3", "bash", { command: "npm run check" }, true)], verify)).toBe(
			verify,
		);
	});
	it("does not count assistant prose, unrelated commands or masked failures as verification", () => {
		for (const later of [
			[{ role: "assistant", content: "checks passed" }],
			tool("2", "bash", { command: "pwd" }),
			tool("2", "bash", { command: "npm run check || true" }),
		]) {
			expect(propose([...edit, ...later], "Run npm run check for src/a.ts.")).toContain("src/a.ts");
		}
	});
	it("S9: only the current branch counts after branch navigation or resume", () => {
		const manager = SessionManager.inMemory();
		const root = manager.appendMessage({ role: "user", content: "Finish the parser", timestamp: 1 } as never);
		const append = (messages: unknown[]) => {
			for (const message of messages) manager.appendMessage({ timestamp: 1, ...(message as object) } as never);
		};
		// Branch A: edit, passing check, every task completed.
		append([...edit, ...check, todo(false)]);
		const leafA = manager.getLeafId();
		// Branch B from the same request: only the edit and an open task.
		manager.branch(root);
		append([...edit, todo(true)]);
		const verify = "Run npm run check for src/a.ts.";
		const onBranch = () => propose(manager.buildSessionContext().messages, verify);
		// A's passing check and finished tasks do not suppress B's suggestion; B's own open task wins.
		expect(onBranch()).toContain("Document parser usage");
		manager.branch(leafA ?? root);
		expect(onBranch()).toBeUndefined();
	});

	it("S9: a dismissal on another branch does not reach the current branch's candidate", () => {
		const candidates = new NextSuggestionCandidate(() => 0);
		const record = { model: { provider: "anthropic", id: "m" } } as unknown as RecordedMainRequest;
		const finalA = { role: "assistant" } as AssistantMessage;
		const finalB = { role: "assistant" } as AssistantMessage;
		candidates.store(record, finalA, SUGGESTION_TEXT);
		candidates.dismiss(SUGGESTION_TEXT);
		const model = { provider: "anthropic", id: "m" };
		expect(candidates.get(record, finalA, model)).toBeUndefined();
		// The current branch's candidate with the same text is still offered.
		candidates.store(record, finalB, SUGGESTION_TEXT);
		expect(candidates.get(record, finalB, model)).toBe(SUGGESTION_TEXT);
		expect(candidates.get(record, finalA, model)).toBeUndefined();
	});

	it("S11: a missing or late check result never turns into a passed check", () => {
		const verify = "Run npm run check for src/a.ts.";
		const pending = [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "2", name: "bash", arguments: { command: "npm run check" } }],
			},
		];
		// No result yet: the suggestion is computed synchronously, without waiting for it.
		expect(propose([...edit, ...pending], verify)).toBe(verify);
		// The result arrives after a newer edit: it verifies the old revision only.
		const late = { role: "toolResult", toolCallId: "2", toolName: "bash", isError: false, content: [] };
		expect(propose([...edit, ...pending, ...tool("3", "edit", { path: "src/a.ts" }), late], verify)).toBe(verify);
	});

	it("activeQuotaUsage isolates the active model window and uses a warm snapshot when refresh stalls", async () => {
		const { activeQuotaUsage } = await import("../src/modes/interactive/next-suggestion-run.ts");
		const warm = {
			label: "ANTIGRAVITY",
			windows: [
				{ label: "gemini-4-neon-xhigh", usedPercent: 16 },
				{ label: "gemini-2.5-flash", usedPercent: 95 },
			],
		};
		const session = { state: { model: { provider: "google-proxy", id: "gemini-4-neon" } } } as never;
		const readerOk = { snapshot: () => warm, read: async () => warm } as never;
		expect(await activeQuotaUsage(session, readerOk)).toBe(16);

		const readerStalled = {
			snapshot: () => warm,
			read: () => new Promise<typeof warm>(() => {}),
		} as never;
		expect(await activeQuotaUsage(session, readerStalled, 10)).toBe(16);
	});
});
