import { describe, expect, it } from "vitest";
import { StringEnum } from "../src/utils/typebox-helpers.ts";

describe("StringEnum", () => {
	it("uses a plain string enum without anyOf or const", () => {
		const schema = StringEnum(["a", "b"]);

		expect(schema).toHaveProperty("type", "string");
		expect(schema).toHaveProperty("enum", ["a", "b"]);
		expect(schema).not.toHaveProperty("anyOf");
		expect(schema).not.toHaveProperty("const");
		expect(schema).not.toHaveProperty("description");
		expect(schema).not.toHaveProperty("default");
	});

	it("omits optional annotations when given an empty options object", () => {
		const schema = StringEnum(["a", "b"], {});

		expect(schema).not.toHaveProperty("description");
		expect(schema).not.toHaveProperty("default");
	});

	it("copies the description without adding a default", () => {
		const schema = StringEnum(["a", "b"], { description: "Choose an operation" });

		expect(schema).toHaveProperty("description", "Choose an operation");
		expect(schema).not.toHaveProperty("default");
	});

	it("copies the default without adding a description", () => {
		const schema = StringEnum(["a", "b"], { default: "a" });

		expect(schema).toHaveProperty("default", "a");
		expect(schema).not.toHaveProperty("description");
	});

	it("keeps both annotations when provided together", () => {
		const schema = StringEnum(["a", "b"], { description: "Choose an operation", default: "b" });

		expect(schema).toHaveProperty("description", "Choose an operation");
		expect(schema).toHaveProperty("default", "b");
	});

	it("preserves the current omission of an empty description", () => {
		const schema = StringEnum(["a", "b"], { description: "", default: "a" });

		expect(schema).not.toHaveProperty("description");
		expect(schema).toHaveProperty("default", "a");
	});

	it("preserves the current omission of an empty default, even when it is an enum value", () => {
		const schema = StringEnum(["", "a"], { description: "Choose an operation", default: "" });

		expect(schema).toHaveProperty("enum", ["", "a"]);
		expect(schema).not.toHaveProperty("default");
		expect(schema).toHaveProperty("description", "Choose an operation");
	});
});
