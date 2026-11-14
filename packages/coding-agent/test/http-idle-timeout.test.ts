import { describe, expect, it } from "vitest";
import {
	DEFAULT_HTTP_IDLE_TIMEOUT_MS,
	formatHttpIdleTimeoutMs,
	HTTP_IDLE_TIMEOUT_CHOICES,
	parseHttpIdleTimeoutMs,
} from "../src/core/http-idle-timeout.ts";

describe("parseHttpIdleTimeoutMs", () => {
	it("maps disabled to 0", () => {
		expect(parseHttpIdleTimeoutMs("disabled")).toBe(0);
		expect(parseHttpIdleTimeoutMs(" DISABLED ")).toBe(0);
	});

	it("maps empty and blank strings to undefined", () => {
		expect(parseHttpIdleTimeoutMs("")).toBeUndefined();
		expect(parseHttpIdleTimeoutMs(" ")).toBeUndefined();
	});

	it("floors numeric strings and numbers", () => {
		expect(parseHttpIdleTimeoutMs("1500.9")).toBe(1500);
		expect(parseHttpIdleTimeoutMs("1e3")).toBe(1000);
		expect(parseHttpIdleTimeoutMs(2500.7)).toBe(2500);
		expect(parseHttpIdleTimeoutMs(0)).toBe(0);
	});

	it("rejects negative, non-finite and non-numeric values", () => {
		expect(parseHttpIdleTimeoutMs("-1")).toBeUndefined();
		expect(parseHttpIdleTimeoutMs(-0.5)).toBeUndefined();
		expect(parseHttpIdleTimeoutMs("abc")).toBeUndefined();
		expect(parseHttpIdleTimeoutMs(Number.NaN)).toBeUndefined();
		expect(parseHttpIdleTimeoutMs(Infinity)).toBeUndefined();
		expect(parseHttpIdleTimeoutMs(null)).toBeUndefined();
		expect(parseHttpIdleTimeoutMs(true)).toBeUndefined();
	});
});

describe("formatHttpIdleTimeoutMs", () => {
	it("maps every choice back to its label", () => {
		for (const choice of HTTP_IDLE_TIMEOUT_CHOICES) {
			expect(formatHttpIdleTimeoutMs(choice.timeoutMs)).toBe(choice.label);
		}
		expect(formatHttpIdleTimeoutMs(0)).toBe("disabled");
		expect(formatHttpIdleTimeoutMs(300_000)).toBe("5 min");
	});

	it("falls back to seconds for non-list values", () => {
		expect(formatHttpIdleTimeoutMs(45_000)).toBe("45 sec");
		expect(formatHttpIdleTimeoutMs(1500)).toBe("1.5 sec");
	});
});

describe("DEFAULT_HTTP_IDLE_TIMEOUT_MS", () => {
	it("is one of the choices", () => {
		expect(HTTP_IDLE_TIMEOUT_CHOICES.some((choice) => choice.timeoutMs === DEFAULT_HTTP_IDLE_TIMEOUT_MS)).toBe(true);
	});
});
