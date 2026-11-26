/**
 * Tests for formatImageFallback (fallback text for images the terminal cannot draw)
 */

import assert from "node:assert";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { formatImageFallback } from "../src/image-fallback.ts";
import { shortenImagePath } from "../src/image-path.ts";

const home = homedir();

describe("formatImageFallback", () => {
	it("renders only the mime type when nothing else is given", () => {
		assert.strictEqual(formatImageFallback("image/png", undefined, undefined, false), "[Image: [image/png]]");
	});

	it("appends dimensions when given", () => {
		assert.strictEqual(
			formatImageFallback("image/png", { widthPx: 800, heightPx: 600 }, undefined, false),
			"[Image: [image/png] 800x600]",
		);
	});

	it("shows a plain absolute path when hyperlinks are off", () => {
		assert.strictEqual(
			formatImageFallback("image/png", { widthPx: 10, heightPx: 20 }, "/tmp/cat.png", false),
			"[Image: /tmp/cat.png [image/png] 10x20]",
		);
	});

	it("wraps an absolute path in an OSC 8 link when hyperlinks are on", () => {
		const filename = join(tmpdir(), "omk-image-fallback-cat.png");
		const display = shortenImagePath(filename);
		const uri = pathToFileURL(filename).href;
		assert.strictEqual(
			formatImageFallback("image/png", undefined, filename, true),
			`[Image: \x1b]8;;${uri}\x1b\\${display}\x1b]8;;\x1b\\ [image/png]]`,
		);
	});

	it("does not link relative paths even when hyperlinks are on", () => {
		const result = formatImageFallback("image/png", undefined, "cat.png", true);
		assert.strictEqual(result, "[Image: cat.png [image/png]]");
		assert.ok(!result.includes("\x1b]8;;"));
	});

	it("shortens paths under the home directory", () => {
		assert.strictEqual(
			formatImageFallback("image/png", undefined, `${home}/pics/cat.png`, false),
			"[Image: ~/pics/cat.png [image/png]]",
		);
	});
});
