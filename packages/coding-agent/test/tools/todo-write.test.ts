import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { type TodoPhase, TodoWriteTool } from "@oh-my-pi/pi-coding-agent/tools";

function createSession(initialPhases: TodoPhase[] = []): ToolSession {
	let phases = initialPhases;
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		getTodoPhases: () => phases,
		setTodoPhases: next => {
			phases = next;
		},
	};
}

describe("TodoWriteTool auto-start behavior", () => {
	it("auto-starts the first task after replace", async () => {
		const tool = new TodoWriteTool(createSession());
		const result = await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Execution",
							tasks: [{ content: "status" }, { content: "diagnostics" }],
						},
					],
				},
			],
		});

		const tasks = result.details?.phases[0]?.tasks ?? [];
		expect(tasks.map(task => task.status)).toEqual(["in_progress", "pending"]);
		const summary = result.content.find(part => part.type === "text");
		if (!summary || summary.type !== "text") throw new Error("Expected text summary from todo_write");
		expect(summary.text).toContain("Remaining items (2):");
		expect(summary.text).toContain("task-1 status [in_progress] (Execution)");
		expect(summary.text).toContain("task-2 diagnostics [pending] (Execution)");
	});

	it("auto-promotes the next pending task when current task is completed", async () => {
		const tool = new TodoWriteTool(createSession());
		await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Execution",
							tasks: [{ content: "status" }, { content: "diagnostics" }],
						},
					],
				},
			],
		});

		const result = await tool.execute("call-2", {
			ops: [{ op: "update", id: "task-1", status: "completed" }],
		});

		const tasks = result.details?.phases[0]?.tasks ?? [];
		expect(tasks.map(task => task.status)).toEqual(["completed", "in_progress"]);
		const summary = result.content.find(part => part.type === "text");
		if (!summary || summary.type !== "text") throw new Error("Expected text summary from todo_write");
		expect(summary.text).toContain("Remaining items (1):");
		expect(summary.text).toContain("task-2 diagnostics [in_progress] (Execution)");

		const completedResult = await tool.execute("call-3", {
			ops: [{ op: "update", id: "task-2", status: "completed" }],
		});
		const completedSummary = completedResult.content.find(part => part.type === "text");
		if (!completedSummary || completedSummary.type !== "text") {
			throw new Error("Expected text summary from todo_write");
		}
		expect(completedSummary.text).toContain("Remaining items: none.");
	});

	it("keeps only one in_progress task when replace input contains multiples", async () => {
		const tool = new TodoWriteTool(createSession());
		const result = await tool.execute("call-1", {
			ops: [
				{
					op: "replace",
					phases: [
						{
							name: "Execution",
							tasks: [
								{ content: "status", status: "in_progress" },
								{ content: "diagnostics", status: "in_progress" },
							],
						},
					],
				},
			],
		});

		const tasks = result.details?.phases[0]?.tasks ?? [];
		expect(tasks.map(task => task.status)).toEqual(["in_progress", "pending"]);
	});
});
