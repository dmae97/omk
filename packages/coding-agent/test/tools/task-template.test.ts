import { describe, expect, test } from "bun:test";
import { sectionSeparator } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import { renderTemplate } from "@oh-my-pi/pi-coding-agent/task/template";

describe("renderTemplate", () => {
	test("returns assignment as task when no context", () => {
		const result = renderTemplate(undefined, {
			id: "Test",
			description: "Short label",
			assignment: "Do the thing in detail.\nStep 1: read file.\nStep 2: edit it.",
		});
		expect(result.task).toBe("Do the thing in detail.\nStep 1: read file.\nStep 2: edit it.");
		expect(result.id).toBe("Test");
		expect(result.description).toBe("Short label");
	});

	test("prepends context with separator when provided", () => {
		const result = renderTemplate("Shared constraints here", {
			id: "TaskA",
			description: "First task",
			assignment: "Full instructions for the agent.\nWith multiple lines.",
		});
		expect(result.task).toContain("Shared constraints here");
		expect(result.task).toContain(sectionSeparator("Background").trimStart());
		expect(result.task).toContain("Full instructions for the agent.\nWith multiple lines.");
	});

	test("trims context whitespace", () => {
		const result = renderTemplate("  \n  context  \n  ", {
			id: "X",
			description: "label",
			assignment: "the real work",
		});
		expect(result.task).toStartWith(`${sectionSeparator("Background").trimStart()}\n<context>\ncontext`);
		expect(result.task).toContain("the real work");
	});

	test("empty context treated as absent", () => {
		const result = renderTemplate("   ", {
			id: "X",
			description: "label",
			assignment: "just the assignment",
		});
		expect(result.task).toBe("just the assignment");
	});

	test("independent mode ignores shared context and marks assignment as self-contained", () => {
		const result = renderTemplate(
			"Shared constraints that should not be forwarded",
			{
				id: "Solo",
				description: "label",
				assignment: "Handle this task without shared context.",
			},
			"independent",
		);

		expect(result.task).not.toContain("Shared constraints that should not be forwarded");
		expect(result.task).toContain("No shared task context is available.");
		expect(result.task).toContain("Handle this task without shared context.");
	});
});
