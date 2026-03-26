import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { dedupeParseErrors, formatParseErrors, formatSavedScreenshotLine } from "@oh-my-pi/pi-coding-agent/tools/render-utils";

describe("parse error formatting", () => {
	it("deduplicates parse errors while preserving order", () => {
		const errors = [
			"foo.ts: parse error (syntax tree contains error nodes)",
			"foo.ts: parse error (syntax tree contains error nodes)",
			"bar.ts: parse error (syntax tree contains error nodes)",
			"foo.ts: parse error (syntax tree contains error nodes)",
		];

		expect(dedupeParseErrors(errors)).toEqual([
			"foo.ts: parse error (syntax tree contains error nodes)",
			"bar.ts: parse error (syntax tree contains error nodes)",
		]);
	});

	it("formats deduplicated parse errors", () => {
		const formatted = formatParseErrors([
			"foo.ts: parse error (syntax tree contains error nodes)",
			"foo.ts: parse error (syntax tree contains error nodes)",
			"bar.ts: parse error (syntax tree contains error nodes)",
		]);

		expect(formatted).toEqual([
			"Parse issues:",
			"- foo.ts: parse error (syntax tree contains error nodes)",
			"- bar.ts: parse error (syntax tree contains error nodes)",
		]);
	});
});

describe("browser screenshot path formatting", () => {
	it("shows home-relative saved paths with tilde shorthand", () => {
		const filePath = path.join(os.homedir(), "screenshots", "capture.png");

		expect(formatSavedScreenshotLine("image/png", 2048, filePath)).toBe(
			"Saved: image/png (2.00 KB) to ~/screenshots/capture.png",
		);
	});

	it("keeps non-home saved paths unchanged", () => {
		expect(formatSavedScreenshotLine("image/png", 2048, "/tmp/capture.png")).toBe(
			"Saved: image/png (2.00 KB) to /tmp/capture.png",
		);
	});
});
