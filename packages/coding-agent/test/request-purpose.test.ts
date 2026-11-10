import { describe, expect, it } from "vitest";
import { requestPurposeOf, tagRequestPurpose } from "../src/core/request-purpose.ts";
import { REQUEST_PURPOSES } from "../src/core/request-trace-metadata.ts";

describe("request purpose tags", () => {
	it("returns the same options object and exposes its purpose", () => {
		const options = { model: "example-model", temperature: 0.2 };
		const tagged = tagRequestPurpose(options, REQUEST_PURPOSES[0]);

		expect(tagged).toBe(options);
		expect(requestPurposeOf(options)).toBe(REQUEST_PURPOSES[0]);
	});

	it("returns undefined for untagged and undefined options", () => {
		expect(requestPurposeOf({ model: "example-model" })).toBeUndefined();
		expect(requestPurposeOf(undefined)).toBeUndefined();
	});

	it("replaces an earlier purpose when the options are tagged again", () => {
		const options = { model: "example-model" };
		tagRequestPurpose(options, "main");
		tagRequestPurpose(options, "retry");

		expect(requestPurposeOf(options)).toBe("retry");
	});

	it("does not change JSON serialization or enumerable keys", () => {
		const options = { model: "example-model", temperature: 0.2 };
		const jsonBefore = JSON.stringify(options);
		const keysBefore = Object.keys(options);

		tagRequestPurpose(options, "compaction");

		expect(JSON.stringify(options)).toBe(jsonBefore);
		expect(Object.keys(options)).toEqual(keysBefore);
	});
});
