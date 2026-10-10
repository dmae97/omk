import { afterEach, describe, expect, it, vi } from "vitest";

const ensure = vi.hoisted(() => vi.fn<(tool: string, silent?: boolean) => Promise<string | undefined>>());
vi.mock("../src/utils/tools-manager.ts", () => ({ ensureTool: ensure }));

import { ensureToolOnce } from "../src/utils/ensure-tool-once.ts";

describe("ensureToolOnce", () => {
	afterEach(() => ensure.mockReset());

	it("shares one download between the startup fetch and a concurrent grep, then fetches again", async () => {
		let finish: (path: string) => void = () => undefined;
		ensure.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const startup = ensureToolOnce("rg", true);
		const grepTool = ensureToolOnce("rg", true);
		expect(ensure).toHaveBeenCalledTimes(1);
		finish("/agent/bin/rg");
		await expect(Promise.all([startup, grepTool])).resolves.toEqual(["/agent/bin/rg", "/agent/bin/rg"]);
		ensure.mockResolvedValueOnce("/agent/bin/rg");
		await ensureToolOnce("rg", true);
		expect(ensure).toHaveBeenCalledTimes(2);
	});

	it("keeps different tools independent", async () => {
		ensure.mockResolvedValue(undefined);
		await Promise.all([ensureToolOnce("fd", true), ensureToolOnce("rg", true)]);
		expect(ensure.mock.calls.map(([tool]) => tool)).toEqual(["fd", "rg"]);
	});
});
