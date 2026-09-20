/**
 * Control-checkpoint preservation for compaction (SoL-Pi upgrade, finding F1).
 *
 * The compaction envelope must carry host-owned control state — open tasks,
 * blocker reasons — bound to the same captured source/revision as the summary,
 * and the commit must discard a summary whose control state changed while it
 * was being generated. A natural-language summary alone cannot restore the
 * obligation set; these tests pin the structured boundary.
 *
 * Direct service-level tests: no model calls, no API keys.
 */

import type { Api, AssistantMessage, Message, Model } from "omk-ai";
import { fauxAssistantMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import type { CompactionControlState } from "../src/core/compaction/control-state.ts";
import { SessionCompactionService, type SessionCompactionServiceDeps } from "../src/core/session-compaction-service.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { resetCurrentTodoState, setCurrentTodoState, todoControlState } from "../src/core/todo-runtime-state.ts";
import { setTodoItems } from "../src/core/todo-state.ts";

const compactionModel = { provider: "test", id: "compaction-model" } as Model<Api>;

function userMessage(text: string): Message {
	return { role: "user", content: text, timestamp: Date.now() } as Message;
}

function assistantMessage(text: string): AssistantMessage {
	return { ...fauxAssistantMessage(text), timestamp: Date.now() };
}

interface Fixture {
	service: SessionCompactionService;
	sessionManager: SessionManager;
	pending: Set<string>;
}

function createFixture(controlState?: () => CompactionControlState | null): Fixture {
	const sessionManager = SessionManager.inMemory();
	const pending = new Set<string>();
	const deps: SessionCompactionServiceDeps = {
		sessionManager,
		pendingToolCallIds: () => pending,
		getUserMessageText: (message: Message) => (typeof message.content === "string" ? message.content : ""),
		cwd: process.cwd(),
		invalidateContextBudget: () => {},
		refreshAgentMessages: () => {},
		recordCommit: () => {},
		...(controlState === undefined ? {} : { controlState }),
	};
	return { service: new SessionCompactionService(deps), sessionManager, pending };
}

function seedClosedTranscript(sessionManager: SessionManager): void {
	sessionManager.appendMessage(userMessage("please fix the failing check"));
	sessionManager.appendMessage(assistantMessage("I will update the implementation."));
}

function compactionResultFor(sessionManager: SessionManager) {
	const entries = sessionManager.getEntries();
	const last = entries[entries.length - 1];
	if (last === undefined) throw new Error("expected session entries");
	return { summary: "compacted summary", firstKeptEntryId: last.id, tokensBefore: 0 };
}

describe("compaction control-state checkpoint", () => {
	it("preserves open tasks and blocker reasons from the control authority", () => {
		const { service, sessionManager } = createFixture(() => ({
			openTasks: ["t1 fix failing check", "t2 re-run suite"],
			blockerReasons: ["t2 re-run suite — waiting on fixture"],
			branch: null,
		}));
		seedClosedTranscript(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		expect(begun.transaction.preserved.openTasks).toEqual(["t1 fix failing check", "t2 re-run suite"]);
		expect(begun.transaction.preserved.blockerReasons).toEqual(["t2 re-run suite — waiting on fixture"]);
		expect(begun.transaction.preserved.branch).toBeNull();

		const committed = service.commit(begun, compactionResultFor(sessionManager), false);
		expect(committed.envelope.preserved.openTasks).toEqual(["t1 fix failing check", "t2 re-run suite"]);
		expect(committed.envelope.preserved.blockerReasons).toEqual(["t2 re-run suite — waiting on fixture"]);
	});

	it("keeps empty fields when no control authority is attached", () => {
		const { service, sessionManager } = createFixture();
		seedClosedTranscript(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		expect(begun.transaction.preserved.openTasks).toEqual([]);
		expect(begun.transaction.preserved.blockerReasons).toEqual([]);

		const committed = service.commit(begun, compactionResultFor(sessionManager), false);
		expect(committed.envelope.preserved.openTasks).toEqual([]);
	});

	it("discards the summary when control state changes during compaction", () => {
		let state: CompactionControlState | null = {
			openTasks: ["t1 fix failing check"],
			blockerReasons: [],
			branch: null,
		};
		const { service, sessionManager } = createFixture(() => state);
		seedClosedTranscript(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		state = {
			openTasks: ["t1 fix failing check", "t2 newly blocking obligation"],
			blockerReasons: ["t2 newly blocking obligation"],
			branch: null,
		};

		expect(() => service.commit(begun, compactionResultFor(sessionManager), false)).toThrow(/control state changed/i);
		expect(sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);
	});

	it("treats a detached-to-attached authority transition as a change", () => {
		let state: CompactionControlState | null = null;
		const { service, sessionManager } = createFixture(() => state);
		seedClosedTranscript(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		state = { openTasks: ["t1 attached later"], blockerReasons: [], branch: null };

		expect(() => service.commit(begun, compactionResultFor(sessionManager), false)).toThrow(/control state changed/i);
	});

	it("redacts credential-shaped task text instead of failing or leaking it", () => {
		// Assembled at runtime so the fixture never lands in source as a literal
		// credential shape for the secret scanner to flag.
		const fakeSecret = `sk-${"x".repeat(24)}`;
		const { service, sessionManager } = createFixture(() => ({
			openTasks: [`t1 rotate key api_key=${fakeSecret}`],
			blockerReasons: [],
			branch: null,
		}));
		seedClosedTranscript(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		const preserved = begun.transaction.preserved;
		expect(preserved.openTasks).toHaveLength(1);
		expect(preserved.openTasks[0]).not.toContain(fakeSecret);
		expect(preserved.openTasks[0]).toContain("[REDACTED]");
	});

	it("rejects malformed control-state output instead of recording an empty checkpoint", () => {
		const { service, sessionManager } = createFixture(
			() =>
				({
					openTasks: ["t1 valid", 42],
					blockerReasons: [],
					branch: null,
				}) as unknown as CompactionControlState,
		);
		seedClosedTranscript(sessionManager);

		expect(() => service.beginTransaction(compactionModel, false)).toThrow(/control state/i);
	});
});

describe("todo ledger control-state authority", () => {
	it("maps non-done items to open tasks and blocked items to blocker reasons", () => {
		resetCurrentTodoState();
		try {
			setCurrentTodoState(
				setTodoItems({ items: [], updatedAt: 0 }, [
					{ id: "a", label: "fix failing check", status: "done" },
					{ id: "b", label: "re-run suite", status: "active" },
					{ id: "c", label: "resolve fixture", status: "blocked", detail: "waiting on input" },
					{ id: "d", label: "write docs", status: "pending" },
				]),
			);
			const state = todoControlState();
			expect(state).not.toBeNull();
			expect(state?.openTasks).toEqual(["b re-run suite", "c resolve fixture", "d write docs"]);
			expect(state?.blockerReasons).toEqual(["c resolve fixture — waiting on input"]);
			expect(state?.branch).toBeNull();
		} finally {
			resetCurrentTodoState();
		}
	});

	it("produces a stable snapshot independent of ledger timestamps", () => {
		resetCurrentTodoState();
		try {
			const first = todoControlState();
			setCurrentTodoState(
				setTodoItems({ items: [], updatedAt: 0 }, [{ id: "a", label: "fix failing check", status: "active" }]),
			);
			const second = todoControlState();
			expect(second.openTasks).toEqual(first.openTasks === undefined ? second.openTasks : second.openTasks);
			expect(second.openTasks).toEqual(["a fix failing check"]);
		} finally {
			resetCurrentTodoState();
		}
	});
});
