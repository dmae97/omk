import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { makeSkillAdmissionRecord } from "../src/core/skill-admission-ledger.ts";
import { StatusPanelActivity } from "../src/modes/interactive/status-panel-activity.ts";

function fixture() {
	const manager = SessionManager.inMemory("/tmp");
	const session = {
		sessionId: manager.getSessionId(),
		systemPrompt: '<active_skills source="settings"><name>programming</name></active_skills>',
		sessionManager: manager,
	} as unknown as AgentSession;
	const tracker = new StatusPanelActivity(vi.fn());
	const complete = (name: string, args: Record<string, unknown>, text = "", isError = false, details?: unknown) => {
		const id = `call-${manager.getEntries().length}`;
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "toolCall", id, name, arguments: args }],
			api: "openai-responses",
			provider: "openai",
			model: "test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 0,
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: id,
			toolName: name,
			content: [{ type: "text", text }],
			isError,
			details,
			timestamp: 0,
		});
	};
	return { session, manager, tracker, complete };
}
afterEach(() => vi.useRealTimers());

describe("status panel actual activity", () => {
	it("reads only successful TODO updates on the current branch, not model proposals", () => {
		const { session, manager, tracker, complete } = fixture();
		complete("update_todo", {
			items: [
				{ id: "a", label: "Read source", status: "done" },
				{ id: "b", label: "Connect data", status: "active" },
			],
		});
		const leaf = manager.getLeafId();
		complete("update_todo", { items: [{ id: "bad", label: "Not accepted", status: "active" }] }, "failed", true);
		expect(tracker.read(session).task).toEqual({ label: "Connect data", done: 1, total: 2, blocked: 0 });
		manager.resetLeaf();
		expect(tracker.read(session).task).toBeUndefined();
		manager.branch(leaf!);
		expect(tracker.read(session).task?.done).toBe(1);
		tracker.dispose();
	});
	it("tracks actual overlapping tool starts with a monotonic clock, then clears on end and session change", () => {
		vi.useFakeTimers();
		let now = 100;
		const { session } = fixture();
		const repaint = vi.fn();
		const tracker = new StatusPanelActivity(repaint, () => now);
		tracker.observe(session, {
			type: "tool_execution_start",
			toolCallId: "a",
			toolName: "bash",
			args: { command: "secret" },
		});
		tracker.observe(session, { type: "tool_execution_start", toolCallId: "b", toolName: "read", args: {} });
		now = 2600;
		expect(tracker.read(session).tool).toEqual({ name: "bash", seconds: 2, count: 2 });
		vi.advanceTimersByTime(1000);
		expect(repaint).toHaveBeenCalled();
		tracker.observe(session, {
			type: "tool_execution_end",
			toolCallId: "a",
			toolName: "bash",
			result: {},
			isError: false,
		});
		expect(tracker.read(session).tool?.name).toBe("read");
		const other = fixture();
		expect(tracker.read(other.session).tool).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);
		tracker.observe(other.session, { type: "tool_execution_start", toolCallId: "c", toolName: "bash", args: {} });
		tracker.observe(other.session, { type: "agent_end", messages: [], willRetry: false });
		expect(tracker.read(other.session).tool).toBeUndefined();
		tracker.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("distinguishes current selected skills and loaded bodies from suggestions and previous prompt reads", () => {
		const { session, manager, tracker, complete } = fixture();
		manager.appendMessage({ role: "user", content: "first", timestamp: 0 });
		complete("read", { path: "/tmp/old/SKILL.md" }, "old skill");
		manager.appendMessage({ role: "user", content: "next", timestamp: 0 });
		manager.appendCustomMessageEntry(
			"prompt-skills",
			"<prompt_skills><active_skills><name>debugging</name></active_skills><relevant_skills><skill><name>suggestion-only</name></skill></relevant_skills></prompt_skills>",
			false,
		);
		manager.appendCustomEntry(
			"skill_admission",
			makeSkillAdmissionRecord("debugging", "a".repeat(64), "read", "admitted", "r1"),
		);
		manager.appendCustomEntry(
			"skill_admission",
			makeSkillAdmissionRecord("not-loaded", "b".repeat(64), "auto", "reserved", "r2"),
		);
		complete("read", { path: "/tmp/actual/SKILL.md" }, "---\nname: actual\n---\nbody");
		expect(tracker.read(session).skills).toEqual({ selected: ["debugging"], loaded: ["debugging", "actual"] });
		tracker.dispose();
	});
	it("shows observed test counts and diagnostic errors, never inferred green or skipped-as-clean", () => {
		const { session, tracker, complete } = fixture();
		complete(
			"bash",
			{ command: "node node_modules/vitest/dist/cli.js --run test/example.test.ts" },
			"Tests 7 passed (7)",
		);
		complete("diagnostics", { path: "x.ts" }, "ERROR x.ts:1", false, {
			diagnostics: [{ severity: "error" }],
			skipped: [],
			counts: { typescript: 1 },
		});
		expect(tracker.read(session).checks).toMatchObject({
			tests: { text: "7 passed", state: "success", stale: false },
			diagnostics: { text: "1 error", state: "error", stale: false },
		});
		complete("bash", { command: "echo 'Tests 999 passed (999)'" }, "Tests 999 passed (999)");
		expect(tracker.read(session).checks.tests?.text).toBe("7 passed");
		complete("edit", { path: "x.ts" }, "edited");
		expect(tracker.read(session).checks.tests?.stale).toBe(true);
		complete("diagnostics", {}, "skipped", false, {
			diagnostics: [],
			skipped: [{ language: "go", reason: "no checker" }],
			counts: {},
		});
		expect(tracker.read(session).checks.diagnostics).toMatchObject({
			text: "1 skipped",
			state: "warning",
			stale: false,
		});
		complete("bash", { command: "pytest tests" }, "1 failed, 6 passed", true);
		expect(tracker.read(session).checks.tests).toMatchObject({
			text: "6 passed / 1 failed",
			state: "error",
			stale: false,
		});
		complete(
			"lsp_diagnostics",
			{},
			"Files checked: 1\nTotal diagnostics: 0\nOutcomes: clean=1, unavailable=0, failed=0",
		);
		expect(tracker.read(session).checks.diagnostics?.text).toBe("0 errors");
		complete("lsp_diagnostics", {}, "Total diagnostics: 0\nOutcomes: unavailable=1");
		expect(tracker.read(session).checks.diagnostics?.state).toBe("warning");
		complete("bash", { command: "cd /tmp && pytest tests" }, "6 passed");
		expect(tracker.read(session).checks.tests?.text).toBe("6 passed");
		complete("bash", { command: "pytest tests; echo done" }, "999 passed");
		expect(tracker.read(session).checks.tests?.text).toBe("6 passed");
		tracker.dispose();
	});
});
