import { describe, expect, it } from "bun:test";
import { enforceStrictSchema } from "@oh-my-pi/pi-ai/utils/typebox-helpers";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { SubmitResultTool } from "@oh-my-pi/pi-coding-agent/tools/submit-result";

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

function toRecord(value: unknown): Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getSuccessDataSchema(parameters: Record<string, unknown>): Record<string, unknown> {
	const resultSchema = toRecord(toRecord(parameters.properties).result);
	const variants = Array.isArray(resultSchema.anyOf) ? resultSchema.anyOf : [];
	for (const variant of variants) {
		const variantRecord = toRecord(variant);
		const variantProperties = toRecord(variantRecord.properties);
		if ("data" in variantProperties) {
			return toRecord(variantProperties.data);
		}
	}
	throw new Error("Missing success variant with data schema");
}

describe("SubmitResultTool", () => {
	it("exposes top-level object parameters with required result union", () => {
		const tool = new SubmitResultTool(createSession());
		const schema = tool.parameters as {
			type?: string;
			properties?: Record<string, unknown>;
			required?: string[];
		};
		expect(schema.type).toBe("object");
		expect(Object.keys(schema.properties ?? {})).toEqual(["result"]);
		expect(schema.required).toEqual(["result"]);
	});

	it("accepts success payload with data", async () => {
		const tool = new SubmitResultTool(createSession());
		const result = await tool.execute("call-1", { result: { data: { ok: true } } } as never);
		expect(result.details).toEqual({ data: { ok: true }, status: "success", error: undefined });
	});

	it("accepts aborted payload with error only", async () => {
		const tool = new SubmitResultTool(createSession());
		const result = await tool.execute("call-2", { result: { error: "blocked" } } as never);
		expect(result.details).toEqual({ data: undefined, status: "aborted", error: "blocked" });
	});

	it("accepts arbitrary data when outputSchema is null", async () => {
		const tool = new SubmitResultTool(createSession({ outputSchema: null }));
		const result = await tool.execute("call-null", { result: { data: { nested: { x: 1 }, ok: true } } } as never);
		expect(result.details).toEqual({
			data: { nested: { x: 1 }, ok: true },
			status: "success",
			error: undefined,
		});
	});

	it("treats outputSchema true as unconstrained and accepts primitive and array data", async () => {
		const tool = new SubmitResultTool(createSession({ outputSchema: true }));
		const dataSchema = getSuccessDataSchema(tool.parameters as unknown as Record<string, unknown>);

		expect(dataSchema.type).toBeUndefined();
		const primitiveResult = await tool.execute("call-true-number", { result: { data: 42 } } as never);
		expect(primitiveResult.details).toEqual({ data: 42, status: "success", error: undefined });

		const arrayResult = await tool.execute("call-true-array", { result: { data: ["ok", 1, false] } } as never);
		expect(arrayResult.details).toEqual({
			data: ["ok", 1, false],
			status: "success",
			error: undefined,
		});
	});
	it("repairs strict schema generation for required-only object output schemas", () => {
		const tool = new SubmitResultTool(
			createSession({
				outputSchema: {
					type: "object",
					required: ["data"],
				},
			}),
		);
		const strictParameters = enforceStrictSchema(tool.parameters as unknown as Record<string, unknown>);
		const dataSchema = getSuccessDataSchema(strictParameters);

		expect(tool.strict).toBe(true);
		expect(dataSchema.properties).toEqual({});
		expect(dataSchema.required).toEqual([]);
		expect(dataSchema.additionalProperties).toBe(false);
	});

	it("normalizes object/null type arrays into strict-compatible data variants", () => {
		const tool = new SubmitResultTool(
			createSession({
				outputSchema: {
					type: ["object", "null"],
					properties: {
						name: { type: "string" },
					},
					required: ["name"],
				},
			}),
		);
		const dataSchema = getSuccessDataSchema(tool.parameters as unknown as Record<string, unknown>);
		expect(tool.strict).toBe(true);
		expect(Array.isArray(dataSchema.anyOf)).toBe(true);

		const variants = dataSchema.anyOf as Array<Record<string, unknown>>;
		const objectVariant = variants.find(variant => variant.type === "object");
		const nullVariant = variants.find(variant => variant.type === "null");

		expect(objectVariant).toBeDefined();
		expect((objectVariant as Record<string, unknown>).properties).toEqual({ name: { type: "string" } });
		expect((objectVariant as Record<string, unknown>).required).toEqual(["name"]);
		expect(nullVariant).toEqual({ type: "null" });
	});

	it("keeps runtime validation against the original output schema", async () => {
		const outputSchema = {
			type: "object",
			properties: {
				token: {
					type: "string",
					minLength: 3,
				},
			},
			required: ["token"],
		};
		const tool = new SubmitResultTool(createSession({ outputSchema }));
		const dataSchema = getSuccessDataSchema(tool.parameters as unknown as Record<string, unknown>);
		const tokenSchema = toRecord(toRecord(dataSchema.properties).token);

		expect(tokenSchema.minLength).toBeUndefined();
		await expect(tool.execute("call-short", { result: { data: { token: "ab" } } } as never)).rejects.toThrow(
			"Output does not match schema",
		);

		const result = await tool.execute("call-long", { result: { data: { token: "abcd" } } } as never);
		expect(result.details).toEqual({ data: { token: "abcd" }, status: "success", error: undefined });
	});

	it("rejects submissions without a result object", async () => {
		const tool = new SubmitResultTool(createSession());
		await expect(tool.execute("call-3", {} as never)).rejects.toThrow(
			"result must be an object containing either data or error",
		);
	});
});
