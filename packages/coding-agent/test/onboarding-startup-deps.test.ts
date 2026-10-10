import { afterEach, describe, expect, it, vi } from "vitest";

const tools = vi.hoisted(() => ({
	local: new Map<string, string>(),
	ensure: vi.fn<(tool: string, silent?: boolean) => Promise<string | undefined>>(),
}));

vi.mock("../src/utils/tools-manager.ts", () => ({
	getToolPath: (tool: string) => tools.local.get(tool) ?? null,
	ensureTool: tools.ensure,
}));
vi.mock("../src/utils/syntax-highlight.ts", () => ({
	loadSyntaxHighlighter: () => Promise.resolve(),
	onSyntaxHighlighterReady: () => () => undefined,
}));

import { scheduleInteractiveStartupDeps } from "../src/modes/interactive/startup-deps.ts";

describe("interactive startup dependencies", () => {
	afterEach(() => {
		tools.local.clear();
		tools.ensure.mockReset();
	});

	it("hands a local fd over synchronously and fetches nothing", async () => {
		tools.local.set("fd", "/usr/bin/fd");
		tools.local.set("rg", "/usr/bin/rg");
		const seen: Array<string | undefined> = [];
		const settled = scheduleInteractiveStartupDeps((path) => seen.push(path));
		expect(seen).toEqual(["/usr/bin/fd"]);
		await settled;
		expect(tools.ensure).not.toHaveBeenCalled();
	});

	it("returns before a missing tool finishes downloading and reports the late fd", async () => {
		let release: (path: string) => void = () => undefined;
		const fdDownload = new Promise<string | undefined>((resolve) => {
			release = resolve;
		});
		tools.ensure.mockImplementation((tool) => (tool === "fd" ? fdDownload : Promise.resolve("/tmp/rg")));
		const seen: Array<string | undefined> = [];
		const settled = scheduleInteractiveStartupDeps((path) => seen.push(path));
		expect(seen).toEqual([]);
		expect(tools.ensure).toHaveBeenCalledWith("fd", true);
		expect(tools.ensure).toHaveBeenCalledWith("rg", true);
		release("/home/dev/.omk/agent/bin/fd");
		await settled;
		expect(seen).toEqual(["/home/dev/.omk/agent/bin/fd"]);
	});

	it("survives a failed download without throwing", async () => {
		tools.ensure.mockResolvedValue(undefined);
		const seen: Array<string | undefined> = [];
		await scheduleInteractiveStartupDeps((path) => seen.push(path));
		expect(seen).toEqual([undefined]);
	});
});
