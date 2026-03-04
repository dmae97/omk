import { describe, expect, test } from "bun:test";
import { formatThinkingEffortLabel } from "@oh-my-pi/pi-coding-agent/utils/thinking-effort-label";

describe("formatThinkingEffortLabel", () => {
	test("formats minimal as min", () => {
		expect(formatThinkingEffortLabel("minimal")).toBe("min");
	});

	test("formats medium as medium", () => {
		expect(formatThinkingEffortLabel("medium")).toBe("medium");
	});

	test("formats xhigh as xhigh", () => {
		expect(formatThinkingEffortLabel("xhigh")).toBe("xhigh");
	});
});
