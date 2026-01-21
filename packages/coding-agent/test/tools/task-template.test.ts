import { describe, expect, test } from "bun:test";
import { extractPlaceholders, renderTemplate, validateTaskTemplate } from "../../src/core/tools/task/template";

// ============================================================================
// renderTemplate
// ============================================================================

describe("task template rendering", () => {
	test("extracts placeholders", () => {
		expect(extractPlaceholders("Do {{thing}} then {{thing}} with {{target}}")).toEqual(["thing", "thing", "target"]);
	});

	test("renders single placeholder", () => {
		expect(renderTemplate("Hello {{name}}", { name: "Ada" })).toBe("Hello Ada");
	});

	test("renders multiple placeholders", () => {
		expect(renderTemplate("{{greet}} {{name}}", { greet: "Hi", name: "Ada" })).toBe("Hi Ada");
	});

	test("leaves unknown placeholders intact", () => {
		expect(renderTemplate("Hello {{name}} {{missing}}", { name: "Ada" })).toBe("Hello Ada {{missing}}");
	});
});

// ============================================================================
// validateTaskTemplate
// ============================================================================

describe("task template validation", () => {
	test("requires placeholders for multi-task", () => {
		const error = validateTaskTemplate("Just instructions", [
			{ id: "One", vars: {} },
			{ id: "Two", vars: {} },
		]);
		expect(error).toBe("Multi-task invocations require {{placeholders}} in context");
	});

	test("errors on missing vars", () => {
		const error = validateTaskTemplate("Do {{thing}}", [{ id: "Only", vars: {} }]);
		expect(error).toBe('Task "Only" missing vars: thing');
	});

	test("errors on empty context around placeholders", () => {
		const error = validateTaskTemplate("{{task}}", [
			{ id: "A", vars: { task: "One" } },
			{ id: "B", vars: { task: "Two" } },
		]);
		expect(error).toBe("Context must contain instructions (50+ chars) around {{placeholders}}");
	});

	test("allows single-task without placeholders", () => {
		const error = validateTaskTemplate("Just do the thing", [{ id: "Only", vars: {} }]);
		expect(error).toBeNull();
	});
});
