import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "../../tui/src/utils.ts";
import { InputReadinessComponent } from "../src/modes/interactive/components/input-readiness.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type InputContext = {
	pendingPromptPayloads: { text: string }[];
	onInputCallback?: (payload: { text: string }) => void;
	ui: { requestRender: () => void };
};
const getUserInput = Reflect.get(InteractiveMode.prototype, "getUserInput") as (
	this: InputContext,
) => Promise<{ text: string }>;

beforeAll(() => initTheme("dark"));
afterEach(() => vi.restoreAllMocks());

describe("interactive input readiness", () => {
	it("appears only while the real input callback is installed, not during startup or queued work", async () => {
		const context: InputContext = { pendingPromptPayloads: [], ui: { requestRender: vi.fn() } };
		const status = new InputReadinessComponent(() => context.onInputCallback !== undefined);
		const text = () => stripVTControlCharacters(status.render(80).join("\n"));
		expect(text()).not.toContain("READY");

		const input = getUserInput.call(context);
		expect(text()).toBe("INPUT READY");
		expect(context.ui.requestRender).toHaveBeenCalledTimes(1);
		context.onInputCallback?.({ text: "accepted" });
		await expect(input).resolves.toEqual({ text: "accepted" });
		expect(text()).not.toContain("READY");
		expect(context.ui.requestRender).toHaveBeenCalledTimes(2);

		context.pendingPromptPayloads.push({ text: "queued" });
		await expect(getUserInput.call(context)).resolves.toEqual({ text: "queued" });
		expect(text()).not.toContain("READY");
		expect(context.onInputCallback).toBeUndefined();
	});

	it.each([0, 1, 5, 11, 40, 120, 200])("keeps a fixed single row within %i columns", (width) => {
		let waiting = false;
		const status = new InputReadinessComponent(() => waiting);
		const idleRows = status.render(width);
		waiting = true;
		status.invalidate();
		const readyRows = status.render(width);
		expect(idleRows).toHaveLength(1);
		expect(readyRows).toHaveLength(1);
		expect(visibleWidth(readyRows[0] ?? "")).toBeLessThanOrEqual(width);
		if (width >= 11) expect(stripVTControlCharacters(readyRows[0] ?? "")).toBe("INPUT READY");
	});
});
