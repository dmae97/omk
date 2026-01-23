import { describe, expect, test } from "bun:test";
import { renderTemplate } from "$c/task/template";

describe("renderTemplate", () => {
	test("renders explicit args", () => {
		const result = renderTemplate("Hello {{name}}", { id: "Test", description: "A test", args: { name: "Ada" } });
		expect(result.task).toBe("Hello Ada");
		expect(result.args).toEqual({ id: "Test", description: "A test", name: "Ada" });
	});

	test("renders id placeholder", () => {
		const result = renderTemplate("Task: {{id}}", { id: "MyTask", description: "Does stuff" });
		expect(result.task).toBe("Task: MyTask");
	});

	test("renders description placeholder", () => {
		const result = renderTemplate("{{description}}", { id: "X", description: "The description" });
		expect(result.task).toBe("The description");
	});

	test("throws on unknown placeholders", () => {
		expect(() => renderTemplate("{{unknown}}", { id: "Test", description: "A test" })).toThrow(
			'Task "Test" has unknown arguments: unknown',
		);
	});

	test("appends assignment block when no placeholders used", () => {
		const result = renderTemplate("Do the thing", { id: "TaskA", description: "First task" });
		expect(result.task).toContain("----------------------");
		expect(result.task).toContain("# TaskA");
		expect(result.task).toContain("First task");
	});

	test("does not append assignment block when placeholders used", () => {
		const result = renderTemplate("Do {{id}}", { id: "TaskA", description: "First task" });
		expect(result.task).toBe("Do TaskA");
		expect(result.task).not.toContain("----------------------");
	});

	test("explicit args override id/description", () => {
		const result = renderTemplate("{{id}}", { id: "Real", description: "Real desc", args: { id: "Custom" } });
		expect(result.task).toBe("Custom");
	});
});
