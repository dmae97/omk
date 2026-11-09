import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/core/canonical-json.ts";

describe("canonicalJson", () => {
	it("sorts object keys recursively", () => {
		expect(canonicalJson({ z: { b: 2, a: 1 }, a: [{ d: 4, c: 3 }] })).toBe('{"a":[{"c":3,"d":4}],"z":{"a":1,"b":2}}');
	});

	it("omits undefined object properties at every depth", () => {
		expect(canonicalJson({ keep: 1, omit: undefined, nested: { omit: undefined, keep: null } })).toBe(
			'{"keep":1,"nested":{"keep":null}}',
		);
	});

	it("preserves array order while canonicalizing array items", () => {
		expect(canonicalJson([{ z: 1, a: 2 }, "middle", 3])).toBe('[{"a":2,"z":1},"middle",3]');
	});

	it.each([null, "text", 0, -12.5, true, false])("serializes the primitive %s like JSON.stringify", (value) => {
		expect(canonicalJson(value)).toBe(JSON.stringify(value));
	});
});
