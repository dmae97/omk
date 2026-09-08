import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { terminalFileUrl, terminalMarkdownLinks } from "../src/utils/terminal-links.ts";

const wsl = { platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } } as const;
const temporary: string[] = [];
afterEach(() => {
	for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("terminal link resolution", () => {
	it("preserves external URLs, emails, and already Windows-addressable file URLs", () => {
		const links = terminalMarkdownLinks("/projects/app", wsl);
		for (const url of [
			"https://example.com/a?x=1#top",
			"mailto:user@example.com",
			"file://wsl.localhost/Ubuntu-24.04/tmp/x.png",
			"#section",
		]) {
			expect(links.resolveLink(url)).toBe(url);
		}
	});

	it("decodes markdown URL paths exactly once and preserves HTML anchors", () => {
		const links = terminalMarkdownLinks("/projects/app", wsl);
		expect(links.resolveLink("docs/review%20%231.html#after")).toBe(
			"file://wsl.localhost/Ubuntu-24.04/projects/app/docs/review%20%231.html#after",
		);
		expect(links.resolveLink("docs/percent%2520.png")).toBe(
			"file://wsl.localhost/Ubuntu-24.04/projects/app/docs/percent%2520.png",
		);
	});

	it("rewrites Linux file URLs but preserves Windows drive addresses", () => {
		const links = terminalMarkdownLinks("/projects/app", wsl);
		expect(links.resolveLink("file:///home/user/report.html#top")).toBe(
			"file://wsl.localhost/Ubuntu-24.04/home/user/report.html#top",
		);
		expect(links.resolveLink("C:\\Users\\example\\my report.png")).toBe("file:///C:/Users/example/my%20report.png");
		expect(links.resolveLink("file:///C:/Users/example/my%20report.png")).toBe(
			"file:///C:/Users/example/my%20report.png",
		);
	});

	it("does not map SSH or native POSIX paths into local WSL namespaces", () => {
		expect(terminalFileUrl("report.md", "/projects/app", { platform: "linux", env: {} })).toBe(
			"file:///projects/app/report.md",
		);
		expect(
			terminalFileUrl("report.md", "/projects/app", {
				platform: "linux",
				env: { WSL_DISTRO_NAME: "Ubuntu", SSH_CONNECTION: "remote" },
			}),
		).toBe("file:///projects/app/report.md");
		expect(terminalFileUrl("report.md", "C:\\project", { platform: "win32", env: {} })).toBe(
			"file:///C:/project/report.md",
		);
	});

	it("only links actual inline-code paths in the active project", () => {
		const root = mkdtempSync(join(tmpdir(), "omk-links-"));
		temporary.push(root);
		mkdirSync(join(root, "docs"));
		writeFileSync(join(root, "docs", "after.png"), "fixture");
		const links = terminalMarkdownLinks(root, wsl);
		expect(links.resolveFileLink("docs/after.png")).toBe(terminalFileUrl("docs/after.png", root, wsl));
		expect(links.resolveFileLink("docs/missing.png")).toBeUndefined();
		expect(links.resolveFileLink("a / b")).toBeUndefined();
	});

	it("rejects control characters and malformed file URLs without throwing", () => {
		const links = terminalMarkdownLinks("/projects/app", wsl);
		expect(links.resolveLink("bad\x1b]8;;target")).toBeUndefined();
		expect(links.resolveFileLink("bad\nfile.png")).toBeUndefined();
		expect(links.resolveFileLink("file://wsl.localhost/Ubuntu/file.png")).toBeUndefined();
		expect(links.resolveFileLink("file://[")).toBeUndefined();
		expect(links.resolveLink("file://[")).toBeUndefined();
		expect(links.resolveLink("docs/100%.html")).toBe(
			"file://wsl.localhost/Ubuntu-24.04/projects/app/docs/100%25.html",
		);
	});
});
