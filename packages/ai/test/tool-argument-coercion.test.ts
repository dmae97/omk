import { describe, expect, it } from "bun:test";
import type { Tool, ToolCall } from "@oh-my-pi/pi-ai/types";
import { validateToolArguments } from "@oh-my-pi/pi-ai/utils/validation";
import { Type } from "@sinclair/typebox";

describe("Tool argument coercion", () => {
	it("coerces numeric strings when schema expects number", () => {
		const tool: Tool = {
			name: "t1",
			description: "",
			parameters: Type.Object({ timeout: Type.Number() }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-1",
			name: "t1",
			arguments: { timeout: "300" },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.timeout).toBe(300);
		expect(typeof result.timeout).toBe("number");
	});

	it("preserves string values when schema expects string", () => {
		const tool: Tool = {
			name: "t2",
			description: "",
			parameters: Type.Object({ label: Type.String() }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-2",
			name: "t2",
			arguments: { label: "300" },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.label).toBe("300");
		expect(typeof result.label).toBe("string");
	});

	it("parses JSON arrays in string values when schema expects array", () => {
		const tool: Tool = {
			name: "t3",
			description: "",
			parameters: Type.Object({ items: Type.Array(Type.Number()) }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-3",
			name: "t3",
			arguments: { items: "[1, 2, 3]" },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.items).toEqual([1, 2, 3]);
	});

	it("parses JSON objects in string values when schema expects object", () => {
		const tool: Tool = {
			name: "t4",
			description: "",
			parameters: Type.Object({ payload: Type.Object({ a: Type.Number() }) }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-4",
			name: "t4",
			arguments: { payload: '{"a": 1}' },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.payload).toEqual({ a: 1 });
	});

	it("parses nested JSON arrays in string values", () => {
		const tool: Tool = {
			name: "t5",
			description: "",
			parameters: Type.Object({ payload: Type.Object({ items: Type.Array(Type.Number()) }) }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-5",
			name: "t5",
			arguments: { payload: { items: "[4, 5]" } },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.payload.items).toEqual([4, 5]);
	});

	it("coerces JSON-stringified object arrays when schema expects array of objects", () => {
		const tool: Tool = {
			name: "t9",
			description: "",
			parameters: Type.Object({
				a: Type.String(),
				b: Type.Array(
					Type.Object({
						k: Type.String(),
					}),
				),
			}),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-9",
			name: "t9",
			arguments: {
				a: "hello",
				b: '[{"k":"y"}]',
			},
		};
		const result = validateToolArguments(tool, toolCall);
		expect(result.b).toEqual([{ k: "y" }]);
	});

	it("coerces JSON-stringified root arguments containing array-of-object fields", () => {
		const tool: Tool = {
			name: "t10",
			description: "",
			parameters: Type.Object({
				a: Type.String(),
				b: Type.Array(
					Type.Object({
						k: Type.String(),
					}),
				),
			}),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-10",
			name: "t10",
			arguments: '{"a":"hello","b":"[{\\"k\\":\\"y\\"}]"}' as unknown as Record<string, unknown>,
		};
		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({
			a: "hello",
			b: [{ k: "y" }],
		});
	});

	it("iteratively coerces when both root arguments and nested fields are JSON strings", () => {
		const tool: Tool = {
			name: "t7",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				edits: Type.Array(
					Type.Object({
						target: Type.String(),
						new_content: Type.String(),
					}),
				),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-7",
			name: "t7",
			arguments:
				'{"path":"somefile.js","edits":"[{\\"target\\":\\"13#cf\\",\\"new_content\\":\\"...\\"}]"}' as unknown as Record<
					string,
					unknown
				>,
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.path).toBe("somefile.js");
		expect(result.edits).toEqual([{ target: "13#cf", new_content: "..." }]);
	});

	it("iteratively coerces nested array items that are JSON-serialized objects", () => {
		const tool: Tool = {
			name: "t8",
			description: "",
			parameters: Type.Object({
				path: Type.String(),
				edits: Type.Array(
					Type.Object({
						target: Type.String(),
						new_content: Type.String(),
					}),
				),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-8",
			name: "t8",
			arguments: {
				path: "somefile.js",
				edits: '["{\\"target\\":\\"13#cf\\",\\"new_content\\":\\"...\\"}"]',
			},
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result.edits).toEqual([{ target: "13#cf", new_content: "..." }]);
	});

	it("accepts null for optional properties by treating them as omitted", () => {
		const tool: Tool = {
			name: "t11",
			description: "",
			parameters: Type.Object({
				requiredText: Type.String(),
				optionalCount: Type.Optional(Type.Number()),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-11",
			name: "t11",
			arguments: { requiredText: "ok", optionalCount: null },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({ requiredText: "ok" });
	});

	it("drops null optional properties nested in array objects", () => {
		const tool: Tool = {
			name: "t12",
			description: "",
			parameters: Type.Object({
				edits: Type.Array(
					Type.Object({
						target: Type.String(),
						pos: Type.Optional(Type.String()),
						end: Type.Optional(Type.String()),
					}),
				),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-12",
			name: "t12",
			arguments: { edits: [{ target: "a", pos: null, end: "e" }] },
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({ edits: [{ target: "a", end: "e" }] });
	});

	it("drops null optional properties in anyOf object branches", () => {
		const opSchema = Type.Union([
			Type.Object({
				op: Type.Literal("add_task"),
				phase: Type.String(),
				content: Type.String(),
			}),
			Type.Object({
				op: Type.Literal("update"),
				id: Type.String(),
				status: Type.Optional(Type.String()),
				content: Type.Optional(Type.String()),
				notes: Type.Optional(Type.String()),
			}),
		]);

		const tool: Tool = {
			name: "t13",
			description: "",
			parameters: Type.Object({
				ops: Type.Array(opSchema),
			}),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-13",
			name: "t13",
			arguments: {
				ops: [
					{
						op: "update",
						id: "task-1",
						status: "completed",
						content: null,
						notes: "",
					},
				],
			},
		};

		const result = validateToolArguments(tool, toolCall);
		expect(result).toEqual({
			ops: [
				{
					op: "update",
					id: "task-1",
					status: "completed",
					notes: "",
				},
			],
		});
	});

	it("does not parse quoted JSON strings when schema expects number", () => {
		const tool: Tool = {
			name: "t6",
			description: "",
			parameters: Type.Object({ timeout: Type.Number() }),
		};

		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-6",
			name: "t6",
			arguments: { timeout: '"300"' },
		};

		expect(() => validateToolArguments(tool, toolCall)).toThrow('Validation failed for tool "t6"');
	});

	it("coerces numeric string for Optional<number> (anyOf:[number,null])", () => {
		const tool: Tool = {
			name: "t14",
			description: "",
			parameters: Type.Object({ tick_size: Type.Optional(Type.Number()) }),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-14",
			name: "t14",
			arguments: { tick_size: "1.0" },
		};
		const result = validateToolArguments(tool, toolCall);
		expect(result.tick_size).toBe(1);
		expect(typeof result.tick_size).toBe("number");
	});

	it("leaves Optional<number> as undefined when absent", () => {
		const tool: Tool = {
			name: "t15",
			description: "",
			parameters: Type.Object({ tick_size: Type.Optional(Type.Number()) }),
		};
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-15",
			name: "t15",
			arguments: {},
		};
		const result = validateToolArguments(tool, toolCall);
		expect(result.tick_size).toBeUndefined();
	});
});
