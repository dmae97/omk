/**
 * Tests for formatImageFallback (the `[Image: ...]` text shown when a
 * terminal cannot draw images)
 */

import assert from "node:assert";
import { homedir } from "node:os";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { formatImageFallback } from "../src/image-fallback.ts";

const home = homedir();

describe("formatImageFallback", () => {
	it("shows only the mime type when nothing else is known", () => {
		assert.strictEqual(formatImageFallback("image/png", undefined, undefined, false), "[Image: [image/png]]");
	});

	it("appends dimensions when given", () => {
		assert.strictEqual(
			formatImageFallback("image/png", { widthPx: 800, heightPx: 600 }, undefined, false),
			"[Image: [image/png] 800x600]",
		);
	});

	it("shows an absolute path without a link when hyperlinks are off", () => {
		assert.strictEqual(
			formatImageFallback("image/png", { widthPx: 10, heightPx: 20 }, "/tmp/cat.png", false),
			"[Image: /tmp/cat.png [image/png] 10x20]",
		);
	});

	it("wraps an absolute path in an OSC 8 link when hyperlinks are on", () => {
		const href = pathToFileURL("/tmp/cat.png").href;
		assert.strictEqual(
			formatImageFallback("image/png", undefined, "/tmp/cat.png", true),
			`[Image: \x1b]8;;${href}\x1b\\/tmp/cat.png\x1b]8;;\x1b\\ [image/png]]`,
		);
	});

	it("leaves a relative path unlinked even when hyperlinks are on", () => {
		assert.strictEqual(formatImageFallback("image/png", undefined, "cat.png", true), "[Image: cat.png [image/png]]");
	});

	it("shortens a path under home to ~/...", () => {
		assert.strictEqual(
			formatImageFallback("image/png", undefined, `${home}/pics/cat.png`, false),
			"[Image: ~/pics/cat.png [image/png]]",
		);
	});
});
