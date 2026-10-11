import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, createTestSession, type TestSessionContext, userMsg } from "./utilities.ts";

// Spec 043: export-html moved from AgentSession's static imports into exportToHtml().
describe("AgentSession.exportToHtml", () => {
	let ctx: TestSessionContext | undefined;

	afterEach(() => {
		ctx?.cleanup();
		ctx = undefined;
	});

	it("still writes an HTML export of the session", async () => {
		ctx = createTestSession();
		ctx.sessionManager.appendMessage(userMsg("export me"));
		ctx.sessionManager.appendMessage(assistantMsg("exported"));
		const outputPath = join(ctx.tempDir, "session.html");

		expect(await ctx.session.exportToHtml(outputPath)).toBe(outputPath);
		expect(existsSync(outputPath)).toBe(true);
		const html = readFileSync(outputPath, "utf8");
		expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
	});
});
