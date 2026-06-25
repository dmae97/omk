import { describe, expect, it } from "vitest";
import { schemaDrift, schemaFingerprint } from "../examples/extensions/aside-computer-use/schema-fingerprint.ts";

describe("schemaFingerprint", () => {
	it("is deterministic for equal schemas", () => {
		const a = { type: "object", properties: { url: { type: "string" } } };
		const b = { properties: { url: { type: "string" } }, type: "object" };
		expect(schemaFingerprint(a)).toBe(schemaFingerprint(b));
	});

	it("changes when a field is added", () => {
		const before = schemaFingerprint({ type: "object", properties: { url: { type: "string" } } });
		const after = schemaFingerprint({
			type: "object",
			properties: { url: { type: "string" }, selector: { type: "string" } },
		});
		expect(before).not.toBe(after);
	});

	it("changes when a type widens", () => {
		const str = schemaFingerprint({ url: { type: "string" } });
		const any = schemaFingerprint({ url: { type: "string" }, optional: true });
		expect(str).not.toBe(any);
	});

	it("returns a versioned SHA-256 fingerprint", () => {
		const fp = schemaFingerprint({ a: 1 });
		expect(fp).toMatch(/^aside-schema-v1:[0-9a-f]{64}$/);
	});

	it("keeps object key order stable and array order significant", () => {
		const fp1 = schemaFingerprint({ z: true, enum: ["a", "b", "c"], nested: { b: 2, a: 1 } });
		const fp2 = schemaFingerprint({ nested: { a: 1, b: 2 }, enum: ["a", "b", "c"], z: true });
		const fp3 = schemaFingerprint({ z: true, enum: ["c", "b", "a"], nested: { b: 2, a: 1 } });
		expect(fp1).toBe(fp2);
		expect(fp1).not.toBe(fp3);
	});

	it("throws on cyclic schemas", () => {
		const schema: Record<string, unknown> = { type: "object" };
		schema.self = schema;
		expect(() => schemaFingerprint(schema)).toThrow(/cycle/i);
	});

	it("throws on non-JSON schema values", () => {
		expect(() => schemaFingerprint({ type: "object", default: undefined })).toThrow(/non-json/i);
		expect(() => schemaFingerprint({ type: "number", multipleOf: Number.NaN })).toThrow(/non-json/i);
	});
});

describe("schemaDrift", () => {
	it("treats missing approved fingerprint as drift", () => {
		expect(schemaDrift("abcd1234", undefined)).toBe(true);
	});
	it("detects equality as no drift", () => {
		expect(schemaDrift("abcd1234", "abcd1234")).toBe(false);
	});
	it("detects change as drift", () => {
		expect(schemaDrift("abcd1234", "00000000")).toBe(true);
	});
});
