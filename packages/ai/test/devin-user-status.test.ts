import { describe, expect, it } from "vitest";
import { parseDevinUserStatus } from "../src/providers/devin-api.ts";
import { field, ProtoMessage } from "../src/providers/devin-protobuf.ts";

/**
 * GetUserStatus wire quirks that `parseDevinUserStatus` must survive: quota
 * plans mark "unlimited" credit fields with a uint64 sentinel that cannot be
 * represented as a JS number, so the parser reports the field as absent rather
 * than failing the whole decode.
 */
describe("Devin GetUserStatus decode edge cases", () => {
	it("reports a uint64-max credit field as absent instead of throwing", () => {
		// planStatus field 8 = availablePromptCredits, encoded as a raw 10-byte
		// varint for 2^64-1: tag 0x40 (field 8, wire 0) then 9x 0xff + 0x01.
		const planStatus = Buffer.concat([
			field(14, 100), // dailyQuotaRemainingPercent
			field(15, 100), // weeklyQuotaRemainingPercent
			field(17, 1_789_545_600), // dailyQuotaResetAt
			field(18, 1_789_891_200), // weeklyQuotaResetAt
			Buffer.from([0x40, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]),
			field(16, 10_360_000), // overageBalanceMicros = $10.36
		]);
		const response = new ProtoMessage(
			Buffer.concat([field(1, field(13, planStatus))]),
		);
		const status = parseDevinUserStatus(response);
		expect(status.dailyQuotaRemainingPercent).toBe(100);
		expect(status.weeklyQuotaRemainingPercent).toBe(100);
		expect(status.availablePromptCredits).toBeUndefined();
		expect(status.overageBalanceMicros).toBe(10_360_000);
	});

	it("keeps ordinary safe credit fields intact alongside the sentinel", () => {
		const planStatus = Buffer.concat([
			field(8, 1234), // availablePromptCredits
			Buffer.from([0x48, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]), // field 9 unlimited
			field(4, 42), // availableFlexCredits
		]);
		const response = new ProtoMessage(Buffer.concat([field(1, field(13, planStatus))]));
		const status = parseDevinUserStatus(response);
		expect(status.availablePromptCredits).toBe(1234);
		expect(status.availableFlowCredits).toBeUndefined();
		expect(status.availableFlexCredits).toBe(42);
	});
});
