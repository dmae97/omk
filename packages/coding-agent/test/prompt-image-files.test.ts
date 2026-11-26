import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAttachmentPaths, pastedImagePaths, readPromptImageFile } from "../src/core/prompt-image-files.ts";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6v6EAAAAASUVORK5CYII=",
	"base64",
);
let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "omk-image-files-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("image paths in prompt pastes", () => {
	it("parses quoted, escaped, Unicode and multiple dropped paths without a shell", () => {
		expect(parseAttachmentPaths("'/tmp/한글 화면.png' /tmp/second\\ shot.JPG\n\"/tmp/third.webp\"")).toEqual([
			"/tmp/한글 화면.png",
			"/tmp/second shot.JPG",
			"/tmp/third.webp",
		]);
	});
	it("preserves Windows path separators", () => {
		expect(parseAttachmentPaths('"C:\\Users\\me\\Screen Shot.png"')).toEqual(["C:\\Users\\me\\Screen Shot.png"]);
	});
	it.each([
		"ordinary text",
		"compare ./one.png ./two.png",
		"https://host/file.png",
		"data:image/png;base64,abc",
		"'/tmp/unclosed.png",
	])("preserves an ordinary or ambiguous paste %j", (text) => expect(pastedImagePaths(text)).toBeUndefined());
	it("recognizes a file URI and relative image paths", () => {
		expect(pastedImagePaths("file:///tmp/Screen%20Shot.png ./local.jpg")).toEqual([
			"file:///tmp/Screen%20Shot.png",
			"./local.jpg",
		]);
		expect(pastedImagePaths("\\\\wsl.localhost\\Ubuntu-24.04\\tmp\\shot.png")).toEqual([
			"\\\\wsl.localhost\\Ubuntu-24.04\\tmp\\shot.png",
		]);
	});
});

describe("local prompt image acquisition", () => {
	it("reads a real image by relative path or encoded file URI", async () => {
		const file = join(root, "한글 화면.png");
		await writeFile(file, PNG);
		expect(await readPromptImageFile("한글 화면.png", root)).toEqual(PNG);
		expect(await readPromptImageFile(pathToFileURL(file).href, root)).toEqual(PNG);
	});
	it("rejects a fake image extension and directories", async () => {
		await writeFile(join(root, "fake.png"), "not an image");
		await mkdir(join(root, "directory.png"));
		await expect(readPromptImageFile("fake.png", root)).rejects.toThrow(/supported image/);
		await expect(readPromptImageFile("directory.png", root)).rejects.toThrow(/regular image file/);
	});
	it("rejects oversized files before loading their contents", async () => {
		const file = join(root, "large.png");
		await writeFile(file, PNG);
		await truncate(file, 11 * 1024 * 1024);
		await expect(readPromptImageFile(file, root)).rejects.toThrow(/10 MiB/);
	});
	it("never downloads a remote URL", async () => {
		await expect(readPromptImageFile("https://example.com/a.png", root)).rejects.toThrow(/local image/);
	});
});
