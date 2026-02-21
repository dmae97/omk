import { describe, expect, it } from "bun:test";

describe("Buffer.toBase64", async () => {
	await import("../src/utils/image-resize");

	it("should be defined", () => {
		expect(Buffer.prototype.toBase64).toBeDefined();
	});

	it("should return a base64 string", () => {
		const buffer = Buffer.from("Hello, world!");
		expect(buffer.toBase64()).toBe("SGVsbG8sIHdvcmxkIQ==");
	});
});
