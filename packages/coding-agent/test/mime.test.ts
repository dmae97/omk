import { describe, expect, it } from "vitest";
import { detectSupportedImageMimeType } from "../src/utils/mime.ts";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
	"base64",
);

describe("detectSupportedImageMimeType", () => {
	it.each([
		{ name: "JPEG", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mimeType: "image/jpeg" },
		{ name: "PNG", bytes: PNG, mimeType: "image/png" },
		{ name: "GIF87a", bytes: Buffer.from("GIF87a"), mimeType: "image/gif" },
		{ name: "GIF89a", bytes: Buffer.from("GIF89a"), mimeType: "image/gif" },
		{ name: "WebP", bytes: Buffer.from("RIFF\0\0\0\0WEBP"), mimeType: "image/webp" },
	])("recognizes $name", ({ bytes, mimeType }) => {
		expect(detectSupportedImageMimeType(bytes)).toBe(mimeType);
	});

	it("rejects JPEG-LS instead of treating it as JPEG", () => {
		expect(detectSupportedImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xf7]))).toBeNull();
	});

	it("rejects a PNG signature without an IHDR chunk", () => {
		expect(detectSupportedImageMimeType(PNG.subarray(0, 8))).toBeNull();
	});

	it("requires IHDR to be the first PNG chunk", () => {
		const png = Buffer.from(PNG);
		png.write("IDAT", 12, "ascii");
		expect(detectSupportedImageMimeType(png)).toBeNull();
	});

	it("requires the PNG IHDR chunk to have its expected length", () => {
		const png = Buffer.from(PNG);
		png.writeUInt32BE(12, 8);
		expect(detectSupportedImageMimeType(png)).toBeNull();
	});

	it("rejects a PNG with an animation control chunk before IDAT", () => {
		const animationControl = Buffer.from("000000086163544c0000000100000000b42de9a0", "hex");
		// The 8-byte signature and 25-byte IHDR chunk precede IDAT.
		const png = Buffer.concat([PNG.subarray(0, 33), animationControl, PNG.subarray(33)]);
		expect(detectSupportedImageMimeType(png)).toBeNull();
	});

	it.each([
		{ name: "empty input", bytes: Buffer.alloc(0) },
		{ name: "unknown bytes", bytes: Buffer.from([1, 2]) },
		{ name: "a truncated JPEG signature", bytes: Buffer.from([0xff, 0xd8]) },
		{ name: "a truncated GIF signature", bytes: Buffer.from("GI") },
		{ name: "a truncated WebP signature", bytes: Buffer.from("RIFF\0\0\0\0WEB") },
		{ name: "an unrelated RIFF format", bytes: Buffer.from("RIFF\0\0\0\0WAVE") },
	])("returns null for $name", ({ bytes }) => {
		expect(detectSupportedImageMimeType(bytes)).toBeNull();
	});
});
