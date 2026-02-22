import { describe, expect, it } from "bun:test";
import { enforceStrictSchema } from "@oh-my-pi/pi-ai/utils/typebox-helpers";
import { Type } from "@sinclair/typebox";

describe("enforceStrictSchema", () => {
	it("converts optional properties to nullable schemas and requires all object keys", () => {
		const schema = Type.Object({
			requiredText: Type.String(),
			optionalCount: Type.Optional(Type.Number()),
		});

		const strict = enforceStrictSchema(schema as unknown as Record<string, unknown>);
		const properties = strict.properties as Record<string, Record<string, unknown>>;

		expect(strict.required).toEqual(["requiredText", "optionalCount"]);
		expect((properties.requiredText.type as string) === "string").toBe(true);
		const optionalVariants = (properties.optionalCount.anyOf as Array<{ type?: string }>).map(v => v.type);
		expect(optionalVariants).toEqual(["number", "null"]);
	});

	it("never emits undefined as a schema type", () => {
		const schema = Type.Object({
			questions: Type.Array(
				Type.Object({
					id: Type.String(),
					recommended: Type.Optional(Type.Number()),
				}),
			),
		});

		const strict = enforceStrictSchema(schema as unknown as Record<string, unknown>);
		const serialized = JSON.stringify(strict);

		expect(serialized.includes('"undefined"')).toBe(false);
		expect(serialized.includes('"null"')).toBe(true);
	});
});
