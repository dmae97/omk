import { afterEach, describe, expect, mock, test, vi } from "bun:test";

const convertToPngMock = vi.fn();
const imageInputModulePath = `${import.meta.dir}/../src/utils/image-input.ts`;
const imageConvertModulePath = `${import.meta.dir}/../src/utils/image-convert.ts`;
const imageResizeModulePath = `${import.meta.dir}/../src/utils/image-resize.ts`;
const mimeModulePath = `${import.meta.dir}/../src/utils/mime.ts`;

async function importImageInputModule() {
	mock.module(imageConvertModulePath, () => ({
		convertToPng: convertToPngMock,
	}));
	mock.module(imageResizeModulePath, () => ({
		formatDimensionNote: () => undefined,
		resizeImage: vi.fn(),
	}));
	mock.module(mimeModulePath, () => ({
		detectSupportedImageMimeTypeFromFile: vi.fn(),
	}));
	return import(imageInputModulePath);
}

describe("ensureSupportedImageInput", () => {
	afterEach(() => {
		convertToPngMock.mockReset();
		vi.restoreAllMocks();
	});

	test("returns supported image input unchanged", async () => {
		const { ensureSupportedImageInput } = await importImageInputModule();
		const input = { type: "image" as const, data: "abc", mimeType: "image/png" };

		const result = await ensureSupportedImageInput(input);

		expect(result).toEqual(input);
		expect(convertToPngMock).not.toHaveBeenCalled();
	});

	test("converts unsupported image input to png", async () => {
		convertToPngMock.mockResolvedValue({ type: "image", data: "pngdata", mimeType: "image/png" });
		const { ensureSupportedImageInput } = await importImageInputModule();

		const result = await ensureSupportedImageInput({ type: "image", data: "bmpdata", mimeType: "image/bmp" });

		expect(convertToPngMock).toHaveBeenCalledWith("bmpdata", "image/bmp");
		expect(result).toEqual({ type: "image", data: "pngdata", mimeType: "image/png" });
	});
});
