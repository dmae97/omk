import { afterEach, describe, expect, it, vi } from "bun:test";
import { runConfigCommand } from "../src/cli/config-cli";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("config CLI schema coverage", () => {
	it("lists non-UI schema settings in JSON output", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await runConfigCommand({ action: "list", flags: { json: true } });

		expect(logSpy).toHaveBeenCalledTimes(1);
		const payload = logSpy.mock.calls[0]?.[0];
		expect(typeof payload).toBe("string");
		const parsed = JSON.parse(String(payload)) as Record<string, { type: string; description: string }>;

		expect(parsed.enabledModels).toBeDefined();
		expect(parsed.enabledModels.type).toBe("array");
		expect(parsed.enabledModels.description).toBe("");
	});

	it("gets non-UI schema settings by key", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await runConfigCommand({ action: "get", key: "enabledModels", flags: { json: true } });

		expect(logSpy).toHaveBeenCalledTimes(1);
		const payload = logSpy.mock.calls[0]?.[0];
		expect(typeof payload).toBe("string");
		const parsed = JSON.parse(String(payload)) as {
			key: string;
			type: string;
			description: string;
		};

		expect(parsed.key).toBe("enabledModels");
		expect(parsed.type).toBe("array");
		expect(parsed.description).toBe("");
	});
});
