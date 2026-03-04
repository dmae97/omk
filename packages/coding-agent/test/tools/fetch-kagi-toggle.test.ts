import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type SettingPath, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { FetchTool } from "@oh-my-pi/pi-coding-agent/tools/fetch";
import * as toolsManager from "@oh-my-pi/pi-coding-agent/utils/tools-manager";
import * as kagi from "@oh-my-pi/pi-coding-agent/web/kagi";
import type { LoadPageResult } from "@oh-my-pi/pi-coding-agent/web/scrapers/types";
import * as scrapers from "@oh-my-pi/pi-coding-agent/web/scrapers/types";
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
});
