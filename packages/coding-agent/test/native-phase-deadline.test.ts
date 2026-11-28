import { describe, expect, it } from "vitest";
import { parseNativePhaseDeadline } from "../src/core/verified-run/native-phase-deadline.ts";
import { VerifiedRunError } from "../src/core/verified-run/storage.ts";

const VALID_BOOT_ID = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";

function expectIntegrityError(raw: unknown): void {
	let caught: unknown;
	try {
		parseNativePhaseDeadline(raw);
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(VerifiedRunError);
	expect((caught as VerifiedRunError).code).toBe("integrity");
}

describe("parseNativePhaseDeadline", () => {
	it("parses and freezes a valid phaseDeadline record", () => {
		const parsed = parseNativePhaseDeadline({ bootId: VALID_BOOT_ID, deadlineMs: 1 });
		expect(parsed).toEqual({ bootId: VALID_BOOT_ID, deadlineMs: 1 });
		expect(Object.isFrozen(parsed)).toBe(true);

		const maxSafe = parseNativePhaseDeadline({
			bootId: VALID_BOOT_ID,
			deadlineMs: Number.MAX_SAFE_INTEGER,
		});
		expect(maxSafe).toEqual({
			bootId: VALID_BOOT_ID,
			deadlineMs: Number.MAX_SAFE_INTEGER,
		});
		expect(Object.isFrozen(maxSafe)).toBe(true);
	});

	it("rejects non-object and array inputs", () => {
		for (const bad of [null, undefined, "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", 42, true, [], [VALID_BOOT_ID, 1]]) {
			expectIntegrityError(bad);
		}
	});

	it("rejects missing or extra keys", () => {
		expectIntegrityError({});
		expectIntegrityError({ bootId: VALID_BOOT_ID });
		expectIntegrityError({ deadlineMs: 1 });
		expectIntegrityError({ bootId: VALID_BOOT_ID, deadlineMs: 1, extra: true });
	});

	it("rejects invalid bootId values", () => {
		for (const badBootId of [
			123,
			null,
			"",
			VALID_BOOT_ID.toUpperCase(),
			"0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5g",
			"0f1e2d3c4b5a69788a9b0c1d2e3f4a5b",
			"0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5",
			` ${VALID_BOOT_ID}`,
			`${VALID_BOOT_ID} `,
		]) {
			expectIntegrityError({ bootId: badBootId, deadlineMs: 100 });
		}
	});

	it("rejects non-positive, non-integer, or unsafe deadlineMs values", () => {
		for (const badDeadline of [
			"100",
			null,
			undefined,
			0,
			-1,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			expectIntegrityError({ bootId: VALID_BOOT_ID, deadlineMs: badDeadline });
		}
	});
});
