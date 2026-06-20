import { describe, expect, it } from "vitest";
import { getOmkUserAgent } from "../src/utils/omk-user-agent.ts";

describe("getOmkUserAgent", () => {
	it("formats the OMK user agent", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getOmkUserAgent("1.2.3");

		expect(userAgent).toBe(`omk/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^omk\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
