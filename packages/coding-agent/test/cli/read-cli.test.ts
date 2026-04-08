import { afterEach, describe, expect, it, vi } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { runReadCommand } from "@oh-my-pi/pi-coding-agent/cli/read-cli";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as scrapers from "@oh-my-pi/pi-coding-agent/web/scrapers/types";

describe("runReadCommand URL handling", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("delegates URL inputs through the read tool pipeline", async () => {
		const cwd = path.join(os.tmpdir(), "read-cli-url-test");
		const settings = Settings.isolated({ "fetch.enabled": true });
		const pageUrl = "https://example.com/cli-read";
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(Settings, "init").mockResolvedValue(settings);
		vi.spyOn(scrapers, "loadPage").mockResolvedValue({
			ok: true,
			status: 200,
			contentType: "text/plain",
			finalUrl: pageUrl,
			content: "CLI URL content",
		});
		const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);

		await runReadCommand({ path: pageUrl });

		expect(cwdSpy).toHaveBeenCalled();
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("CLI URL content"));
	});
});
