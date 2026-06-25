import { describe, expect, it } from "vitest";
import { originMatches, resolveOrigin } from "../examples/extensions/aside-computer-use/url-origin.ts";

describe("resolveOrigin", () => {
	it("returns schemeful canonical origins and strips path, query, userinfo, and default ports", () => {
		expect(resolveOrigin("https://user:pass@www.example.com:443/a/b?x=1")).toBe("https://www.example.com");
		expect(resolveOrigin("http://localhost:3000/login")).toBe("http://localhost:3000");
		expect(resolveOrigin("https://github.com/owner/repo")).toBe("https://github.com");
		expect(resolveOrigin("http://example.com:80/path")).toBe("http://example.com");
	});

	it("is case-insensitive for host and scheme", () => {
		expect(resolveOrigin("HTTPS://Example.COM/")).toBe("https://example.com");
	});

	it("resolves relative URLs against a web base URL", () => {
		expect(resolveOrigin("/docs?x=1", "https://Example.com:443/base/page")).toBe("https://example.com");
		expect(resolveOrigin("../settings", "http://localhost:3000/app/page")).toBe("http://localhost:3000");
	});

	it("returns undefined for empty, relative-without-base, and non-web protocols", () => {
		expect(resolveOrigin("")).toBeUndefined();
		expect(resolveOrigin("   ")).toBeUndefined();
		expect(resolveOrigin("/relative-only")).toBeUndefined();
		expect(resolveOrigin("file:///tmp/index.html")).toBeUndefined();
		expect(resolveOrigin("mailto:test@example.com")).toBeUndefined();
		expect(resolveOrigin("javascript:alert(1)")).toBeUndefined();
	});
});

describe("originMatches", () => {
	it("matches exact schemeful origins and preserves scheme boundaries", () => {
		expect(originMatches("https://github.com", ["https://github.com"])).toBe(true);
		expect(originMatches("https://github.com", ["http://github.com"])).toBe(false);
		expect(originMatches("https://github.com", ["github.com"])).toBe(true);
	});

	it("normalizes default ports before matching", () => {
		expect(originMatches("https://example.com:443", ["https://example.com"])).toBe(true);
		expect(originMatches("http://example.com:80", ["http://example.com"])).toBe(true);
		expect(originMatches("https://example.com:444", ["https://example.com"])).toBe(false);
	});

	it("supports wildcard subdomain patterns without matching the bare apex", () => {
		expect(originMatches("https://www.example.com", ["https://*.example.com"])).toBe(true);
		expect(originMatches("https://api.example.com", ["*.example.com"])).toBe(true);
		expect(originMatches("https://example.com", ["https://*.example.com"])).toBe(false);
	});

	it("supports localhost port wildcards with schemeful and compatibility patterns", () => {
		expect(originMatches("http://localhost:3000", ["http://localhost:*"])).toBe(true);
		expect(originMatches("https://localhost:3000", ["http://localhost:*"])).toBe(false);
		expect(originMatches("https://localhost:3000", ["localhost:*"])).toBe(true);
		expect(originMatches("http://127.0.0.1:8080", ["127.0.0.1:*"])).toBe(true);
	});

	it("handles trailing slashes and legacy unschemeful target compatibility", () => {
		expect(originMatches("https://example.com", ["https://example.com/"])).toBe(true);
		expect(originMatches("example.com", ["https://example.com/"])).toBe(true);
	});

	it("returns false for undefined origin or no pattern", () => {
		expect(originMatches(undefined, ["https://github.com"])).toBe(false);
		expect(originMatches("https://github.com", [])).toBe(false);
		expect(originMatches("https://evil.com", ["https://github.com"])).toBe(false);
	});
});
