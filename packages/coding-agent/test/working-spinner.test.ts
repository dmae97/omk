import { describe, expect, it } from "vitest";
import {
	createReadableWorkingIndicator,
	formatWorkingElapsed,
	formatWorkingSuffix,
} from "../src/modes/interactive/working-spinner.ts";

const fakeTheme = {
	fg: (role: string, text: string) => `<${role}>${text}</${role}>`,
	bold: (text: string) => `<b>${text}</b>`,
};

describe("readable working spinner", () => {
	it("produces a 4-frame two-tone dot-wave indicator at 160ms by default and supports braille opt-out", () => {
		const ind = createReadableWorkingIndicator(fakeTheme, {});
		expect(ind?.intervalMs).toBe(160);
		expect(ind?.frames).toHaveLength(4);
		expect(ind?.frames?.[0]).toContain("<accent>●</accent>");
		expect(ind?.frames?.[0]).toContain("<borderMuted>○</borderMuted>");
		expect(createReadableWorkingIndicator(fakeTheme, { OMK_SPINNER_STYLE: "braille" })).toBeUndefined();
	});

	it("formats elapsed seconds into readable s / m s / h m units", () => {
		expect(formatWorkingElapsed(0)).toBe("0s");
		expect(formatWorkingElapsed(42)).toBe("42s");
		expect(formatWorkingElapsed(65)).toBe("1m 05s");
		expect(formatWorkingElapsed(3661)).toBe("1h 01m");
	});

	it("formats high-contrast suffix with elapsed time, pending tool count, and hints", () => {
		const out = formatWorkingSuffix(fakeTheme, {
			elapsedSeconds: 14,
			pendingTools: 2,
			interruptKey: "esc",
			expandKey: "ctrl+o",
			toolOutputExpanded: false,
		});
		expect(out).toContain("14s");
		expect(out).toContain("2 tools");
		expect(out).toContain("esc interrupt");
		expect(out).toContain("ctrl+o expand tools");
		expect(out).not.toContain("<dim>");
	});
});
