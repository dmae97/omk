import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type SettingPath, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { FetchTool } from "@oh-my-pi/pi-coding-agent/tools/fetch";
import * as imageResize from "@oh-my-pi/pi-coding-agent/utils/image-resize";
import * as toolsManager from "@oh-my-pi/pi-coding-agent/utils/tools-manager";
import * as kagi from "@oh-my-pi/pi-coding-agent/web/kagi";
import type { LoadPageResult } from "@oh-my-pi/pi-coding-agent/web/scrapers/types";
import * as scrapers from "@oh-my-pi/pi-coding-agent/web/scrapers/types";
import * as scraperUtils from "@oh-my-pi/pi-coding-agent/web/scrapers/utils";
import { Snowflake } from "@oh-my-pi/pi-utils";

describe("fetch tool Kagi summarization toggle", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = path.join(os.tmpdir(), `fetch-kagi-toggle-${Snowflake.next()}`);
		fs.mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	const createSession = (overrides: Partial<Record<SettingPath, unknown>> = {}): ToolSession => {
		const sessionFile = path.join(testDir, "session.jsonl");
		return {
			cwd: testDir,
			hasUI: false,
			getSessionFile: () => sessionFile,
			getSessionSpawns: () => null,
			settings: Settings.isolated({
				"fetch.enabled": true,
				...overrides,
			}),
		};
	};

	const mockLoadPage = () => {
		const pageResponse = (url: string): LoadPageResult => {
			if (url === "https://example.com") {
				return {
					ok: true,
					status: 200,
					contentType: "text/html",
					finalUrl: "https://example.com",
					content: "<html><body><h1>Example Domain</h1><p>Short sample content.</p></body></html>",
				};
			}

			return {
				ok: false,
				status: 404,
				contentType: "",
				finalUrl: url,
				content: "",
			};
		};

		return vi
			.spyOn(scrapers, "loadPage")
			.mockImplementation(async (url: string, _options?: unknown) => pageResponse(url));
	};

	it("uses Kagi summarizer when enabled", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": true });
		const tool = new FetchTool(session);
		const loadPageSpy = mockLoadPage();
		const summarizeSpy = vi.spyOn(kagi, "summarizeUrlWithKagi").mockResolvedValue("x".repeat(150));
		vi.spyOn(toolsManager, "ensureTool").mockResolvedValue(undefined);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("blocked", { status: 500, statusText: "Blocked" }));

		const result = await tool.execute("fetch-1", { url: "https://example.com" });

		expect(loadPageSpy).toHaveBeenCalled();
		expect(summarizeSpy).toHaveBeenCalledTimes(1);
		expect(result.details?.method).toBe("kagi");
	});

	it("skips Kagi summarizer when disabled", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		const loadPageSpy = mockLoadPage();
		const summarizeSpy = vi.spyOn(kagi, "summarizeUrlWithKagi").mockResolvedValue("x".repeat(150));
		vi.spyOn(toolsManager, "ensureTool").mockResolvedValue(undefined);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("blocked", { status: 500, statusText: "Blocked" }));

		const result = await tool.execute("fetch-2", { url: "https://example.com" });

		expect(loadPageSpy).toHaveBeenCalled();
		expect(summarizeSpy).not.toHaveBeenCalled();
		expect(result.details?.method).not.toBe("kagi");
	});

	it("returns an image content block when fetching image URLs", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		const imageBytes = new Uint8Array([137, 80, 78, 71]);
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "image/png",
			finalUrl: "https://example.com/image.png",
			content: "",
		});
		vi.spyOn(scraperUtils, "fetchBinary").mockResolvedValue({
			ok: true,
			buffer: imageBytes,
		});
		vi.spyOn(scraperUtils, "convertWithMarkitdown").mockResolvedValue({
			ok: false,
			content: "",
			error: "markitdown unavailable",
		});
		vi.spyOn(imageResize, "resizeImage").mockResolvedValue({
			buffer: imageBytes,
			mimeType: "image/png",
			originalWidth: 1,
			originalHeight: 1,
			width: 1,
			height: 1,
			wasResized: false,
			get data() {
				return imageBytes.toBase64();
			},
		});

		const result = await tool.execute("fetch-image", { url: "https://example.com/image.png" });
		const imageBlock = result.content.find(
			(content): content is { type: "image"; data: string; mimeType: string } => content.type === "image",
		);

		expect(result.details?.method).toBe("image");
		expect(imageBlock).toBeDefined();
		expect(imageBlock?.mimeType).toBe("image/png");
		expect(imageBlock?.data).toBe(imageBytes.toBase64());
	});

	it("resizes fetched images before emitting image content blocks", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		const resizeSpy = vi.spyOn(imageResize, "resizeImage").mockResolvedValue({
			buffer: new Uint8Array([1, 2, 3]),
			mimeType: "image/jpeg",
			originalWidth: 2000,
			originalHeight: 1000,
			width: 1000,
			height: 500,
			wasResized: true,
			get data() {
				return "cmVzaXplZA==";
			},
		});
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "image/png",
			finalUrl: "https://example.com/image.png",
			content: "",
		});
		vi.spyOn(scraperUtils, "fetchBinary").mockResolvedValue({
			ok: true,
			buffer: new Uint8Array([137, 80, 78, 71]),
		});
		vi.spyOn(scraperUtils, "convertWithMarkitdown").mockResolvedValue({
			ok: false,
			content: "",
			error: "markitdown unavailable",
		});

		const result = await tool.execute("fetch-image-resized", { url: "https://example.com/image.png" });
		const imageBlock = result.content.find(
			(content): content is { type: "image"; data: string; mimeType: string } => content.type === "image",
		);
		const textBlock = result.content.find(content => content.type === "text");

		expect(resizeSpy).toHaveBeenCalledTimes(1);
		expect(result.details?.method).toBe("image");
		expect(imageBlock?.mimeType).toBe("image/jpeg");
		expect(imageBlock?.data).toBe("cmVzaXplZA==");
		expect(textBlock?.type).toBe("text");
		expect(textBlock?.text).toContain("displayed at 1000x500");
	});

	it("keeps markitdown extracted text for image responses", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		const extractedText = "Converted image text content that is definitely longer than fifty characters.";
		vi.spyOn(imageResize, "resizeImage").mockResolvedValue({
			buffer: new Uint8Array([1, 2, 3]),
			mimeType: "image/png",
			originalWidth: 100,
			originalHeight: 100,
			width: 100,
			height: 100,
			wasResized: false,
			get data() {
				return "aW1hZ2U=";
			},
		});
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "image/png",
			finalUrl: "https://example.com/image.png",
			content: "",
		});
		vi.spyOn(scraperUtils, "fetchBinary").mockResolvedValue({
			ok: true,
			buffer: new Uint8Array([137, 80, 78, 71]),
		});
		vi.spyOn(scraperUtils, "convertWithMarkitdown").mockResolvedValue({
			ok: true,
			content: extractedText,
		});

		const result = await tool.execute("fetch-image-with-ocr", { url: "https://example.com/image.png" });
		const textBlock = result.content.find(content => content.type === "text");
		const imageBlock = result.content.find(
			(content): content is { type: "image"; data: string; mimeType: string } => content.type === "image",
		);

		expect(result.details?.method).toBe("image");
		expect(textBlock?.type).toBe("text");
		expect(textBlock?.text).toContain(extractedText);
		expect(imageBlock?.mimeType).toBe("image/png");
		expect(imageBlock?.data).toBe("aW1hZ2U=");
	});
	it("falls back to text-only output for unsupported image MIME types", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		const fetchBinarySpy = vi.spyOn(scraperUtils, "fetchBinary");
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "image/svg+xml",
			finalUrl: "https://example.com/image.svg",
			content: "<svg></svg>",
		});

		const result = await tool.execute("fetch-image-unsupported", { url: "https://example.com/image.svg" });
		const imageBlock = result.content.find(content => content.type === "image");
		const textBlock = result.content.find(content => content.type === "text");

		expect(result.details?.method).toBe("raw");
		expect(fetchBinarySpy).not.toHaveBeenCalled();
		expect(imageBlock).toBeUndefined();
		expect(textBlock?.type).toBe("text");
		expect(textBlock?.text).toContain("<svg></svg>");
	});

	it("uses binary conversion fallback for unsupported image MIME when extension is convertible", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		const convertedText = "Converted image text from markitdown fallback with sufficient length to pass threshold.";
		const fetchBinarySpy = vi.spyOn(scraperUtils, "fetchBinary").mockResolvedValue({
			ok: true,
			buffer: new Uint8Array([255, 216, 255, 224]),
		});
		const convertSpy = vi.spyOn(scraperUtils, "convertWithMarkitdown").mockResolvedValue({
			ok: true,
			content: convertedText,
		});
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "image/jpg",
			finalUrl: "https://example.com/image.jpg",
			content: "\u0000\u0001garbage",
		});

		const result = await tool.execute("fetch-image-jpg-fallback", { url: "https://example.com/image.jpg" });
		const imageBlock = result.content.find(content => content.type === "image");
		const textBlock = result.content.find(content => content.type === "text");

		expect(result.details?.method).toBe("markitdown");
		expect(fetchBinarySpy).toHaveBeenCalledTimes(1);
		expect(convertSpy).toHaveBeenCalledTimes(1);
		expect(result.details?.notes).toContain("Attempting binary conversion fallback for unsupported image MIME type");
		expect(imageBlock).toBeUndefined();
		expect(textBlock?.type).toBe("text");
		expect(textBlock?.text).toContain(convertedText);
	});

	it("does not treat text/html at .png paths as inline images", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		vi.spyOn(scraperUtils, "fetchBinary").mockResolvedValue({ ok: false, error: "not an image" });
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "text/html",
			finalUrl: "https://example.com/foo.png",
			content: "<html><body>not really an image</body></html>",
		});

		const result = await tool.execute("fetch-html-png-path", { url: "https://example.com/foo.png", raw: true });
		const imageBlock = result.content.find(content => content.type === "image");
		const textBlock = result.content.find(content => content.type === "text");

		expect(result.details?.method).toBe("raw");
		expect(imageBlock).toBeUndefined();
		expect(textBlock?.type).toBe("text");
		expect(textBlock?.text).toContain("<html><body>not really an image</body></html>");
	});

	it("falls back to textual output when inline image refetch fails", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		const convertSpy = vi.spyOn(scraperUtils, "convertWithMarkitdown");
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "image/png",
			finalUrl: "https://example.com/transient.png",
			content: "<html><body>temporary gateway page</body></html>",
		});
		const fetchBinarySpy = vi
			.spyOn(scraperUtils, "fetchBinary")
			.mockResolvedValue({ ok: false, error: "upstream blocked" });

		const result = await tool.execute("fetch-image-refetch-failed", { url: "https://example.com/transient.png" });
		const imageBlock = result.content.find(content => content.type === "image");
		const textBlock = result.content.find(content => content.type === "text");

		expect(result.details?.method).toBe("raw");
		expect(imageBlock).toBeUndefined();
		expect(textBlock?.type).toBe("text");
		expect(textBlock?.text).toContain("<html><body>temporary gateway page</body></html>");
		expect(convertSpy).not.toHaveBeenCalled();
		expect(fetchBinarySpy).toHaveBeenCalledTimes(1);
	});
	it("falls back to text-only output when image payload bytes are invalid", async () => {
		const session = createSession({ "fetch.useKagiSummarizer": false });
		const tool = new FetchTool(session);
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "image/png",
			finalUrl: "https://example.com/broken.png",
			content: "<html><body>gateway error</body></html>",
		});
		vi.spyOn(scraperUtils, "fetchBinary").mockResolvedValue({
			ok: true,
			buffer: new Uint8Array([60, 104, 116, 109, 108]),
		});
		vi.spyOn(scraperUtils, "convertWithMarkitdown").mockResolvedValue({
			ok: false,
			content: "",
			error: "conversion failed",
		});
		vi.spyOn(imageResize, "resizeImage").mockResolvedValue({
			buffer: new Uint8Array([60, 104, 116, 109, 108]),
			mimeType: "image/png",
			originalWidth: 0,
			originalHeight: 0,
			width: 0,
			height: 0,
			wasResized: false,
			get data() {
				return "PGh0bWw=";
			},
		});

		const result = await tool.execute("fetch-broken-image", { url: "https://example.com/broken.png" });
		const imageBlock = result.content.find(content => content.type === "image");
		const textBlock = result.content.find(content => content.type === "text");

		expect(result.details?.method).toBe("image-invalid");
		expect(imageBlock).toBeUndefined();
		expect(textBlock?.type).toBe("text");
		expect(textBlock?.text).toContain("<html><body>gateway error</body></html>");
	});
});
