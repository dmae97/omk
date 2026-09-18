import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import {
	getDevinUserStatus,
	parseDevinUserStatus,
	resolveDevinRoute,
	resolveDevinRouteByUid,
} from "../src/providers/devin-api.ts";
import { encodeFrame } from "../src/providers/devin-connect.ts";
import { readConnectFrames } from "../src/providers/devin-connect-stream.ts";
import { field, ProtoMessage } from "../src/providers/devin-protobuf.ts";
import { buildDevinRequest } from "../src/providers/devin-request.ts";

// Literal protobuf bytes independently encode text field 3="Hi" and usage fields 2=10, 3=20.
const golden = Buffer.from("1a0248693a04100a1814", "hex");

describe("Devin protocol boundaries", () => {
	it("decodes known wire bytes, including nested usage", () => {
		const message = new ProtoMessage(golden);
		expect(message.string(3)).toBe("Hi");
		expect(message.messages(7)[0].number(2)).toBe(10);
		expect(message.messages(7)[0].number(3)).toBe(20);
		expect(field(3, "Hi").toString("hex")).toBe("1a024869");
	});

	it.each(["80", "0a09ff", "0000", "0b", "0880808080808080808080"])("rejects malformed protobuf %s", (hex) => {
		expect(() => new ProtoMessage(Buffer.from(hex, "hex"))).toThrow(/protobuf/);
	});

	it("rejects unsafe usage integers without wrapping them", () => {
		const message = new ProtoMessage(Buffer.from("10ffffffffffffffff7f", "hex"));
		expect(() => message.number(2)).toThrow(/number/);
	});

	it("cancels a pending stream read on abort", async () => {
		const controller = new AbortController();
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				},
			}),
		);
		const iterator = readConnectFrames(response, controller.signal);
		const next = iterator.next();
		controller.abort();
		await expect(next).rejects.toThrow();
		expect(cancelled).toBe(true);
	});

	it("bounds decompressed frames as well as their envelope", async () => {
		const payload = gzipSync(Buffer.alloc(16 * 1024 * 1024 + 1));
		const response = new Response(encodeFrame(payload, 1));
		await expect(readConnectFrames(response, new AbortController().signal).next()).rejects.toThrow();
	});

	it("keeps the 1M-context lane separate from the standard lane", () => {
		const entry = (key: string, order: number, name: string) =>
			field(2, Buffer.concat([field(1, key), field(2, Buffer.concat([field(1, order), field(2, name)]))]));
		const config = (uid: string, window: number, ...entries: Buffer[]) =>
			field(
				1,
				Buffer.concat([
					field(22, uid),
					field(18, window),
					field(30, Buffer.concat([field(1, "SWE-2"), ...entries])),
				]),
			);
		const effort = entry("Effort", 2, "max");
		const standard = config("swe2-max", 262_144, effort, entry("1M Context", 0, "Off"));
		const longContext = config("swe2-max-1m", 1_000_000, effort, entry("1M Context", 1, "On"));
		const fast = config(
			"swe2-max-fast-1m",
			1_000_000,
			effort,
			entry("1M Context", 1, "On"),
			entry("Fast Mode", 1, "On"),
		);
		const both = new ProtoMessage(Buffer.concat([standard, longContext, fast]));

		expect(resolveDevinRoute(both, "max")).toEqual({
			uid: "swe2-max",
			contextWindow: 262_144,
			maxTokens: 0,
			longContext: false,
		});
		expect(resolveDevinRoute(both, "max", { longContext: true })).toEqual({
			uid: "swe2-max-1m",
			contextWindow: 1_000_000,
			maxTokens: 0,
			longContext: true,
		});
		// Without a declared 1M lane the standard lane is returned; the caller checks its window.
		expect(resolveDevinRoute(new ProtoMessage(standard), "max", { longContext: true }).uid).toBe("swe2-max");
		// A 1M-only catalog never satisfies a standard-lane request, and fast lanes never match.
		expect(() => resolveDevinRoute(new ProtoMessage(Buffer.concat([longContext, fast])), "max")).toThrow(
			/unavailable or ambiguous/,
		);
		expect(() =>
			resolveDevinRoute(new ProtoMessage(Buffer.concat([longContext, longContext])), "max", { longContext: true }),
		).toThrow(/max \(1M context\) unavailable or ambiguous/);
	});

	it("resolves flat catalog models by wire UID", () => {
		const config = (uid: string, window: number, maxOut: number, familyName: string, disabled = false) =>
			field(
				1,
				Buffer.concat([
					field(1, uid),
					field(22, uid),
					field(18, window),
					field(23, field(13, maxOut)),
					field(30, Buffer.concat([field(1, familyName)])),
					...(disabled ? [field(4, true)] : []),
				]),
			);
		const catalog = new ProtoMessage(
			Buffer.concat([
				config("gpt-5-6-sol-high", 1_000_000, 128_000, "GPT-5.6 Sol"),
				config("claude-opus-5-high", 1_000_000, 128_000, "Claude Opus 5"),
				config("retired-model", 200_000, 64_000, "Retired", true),
			]),
		);
		expect(resolveDevinRouteByUid(catalog, "gpt-5-6-sol-high")).toEqual({
			uid: "gpt-5-6-sol-high",
			contextWindow: 1_000_000,
			maxTokens: 128_000,
			longContext: false,
		});
		expect(() => resolveDevinRouteByUid(catalog, "retired-model")).toThrow(/unavailable or ambiguous/);
		expect(() => resolveDevinRouteByUid(catalog, "not-in-catalog")).toThrow(/unavailable or ambiguous/);
	});

	it("decodes GetUserStatus plan and quota fields, preserving zero values", () => {
		const planInfo = field(
			2,
			Buffer.concat([
				field(2, "Devin Pro"),
				field(1, 16),
				field(35, 3),
				field(36, false),
				field(33, field(8, "Example Org")),
			]),
		);
		const planStatus = field(
			13,
			Buffer.concat([
				field(14, 0), // daily quota fully consumed: a real zero, not a missing field
				field(15, 42),
				field(17, 1_900_000_000),
				field(18, 1_900_500_000),
				field(8, 120),
				field(9, 30),
				field(4, 5),
				field(6, 80),
				field(2, field(1, 1_899_000_000)),
				field(3, field(1, 1_902_000_000)),
				field(16, 1_500_000),
			]),
		);
		const userStatus = field(1, Buffer.concat([field(3, "Yu"), field(7, "yu@example.test"), planStatus]));
		const status = parseDevinUserStatus(new ProtoMessage(Buffer.concat([userStatus, planInfo])));

		expect(status).toEqual({
			planName: "Devin Pro",
			accountDisplayName: "Example Org",
			name: "Yu",
			email: "yu@example.test",
			teamsTier: 16,
			billingStrategy: 3,
			hideDailyQuota: false,
			dailyQuotaRemainingPercent: 0,
			weeklyQuotaRemainingPercent: 42,
			dailyQuotaResetAt: 1_900_000_000,
			weeklyQuotaResetAt: 1_900_500_000,
			availablePromptCredits: 120,
			availableFlowCredits: 30,
			availableFlexCredits: 5,
			usedPromptCredits: 80,
			planStart: 1_899_000_000,
			planEnd: 1_902_000_000,
			overageBalanceMicros: 1_500_000,
		});
	});

	it("returns an empty status for a bare GetUserStatus response", () => {
		expect(parseDevinUserStatus(new ProtoMessage(Buffer.alloc(0)))).toEqual({});
	});

	it("calls GetUserStatus with session-token metadata and no user JWT", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: String(input), init });
			return new Response(field(1, field(13, field(15, 55))), { status: 200 });
		});

		const status = await getDevinUserStatus("devin-session-token$abc", new AbortController().signal, fetchMock);

		expect(requests[0]?.url).toBe(
			"https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
		);
		expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBe("application/proto");
		const request = new ProtoMessage(requests[0]?.init?.body as Uint8Array);
		const metadata = request.messages(1)[0];
		expect(metadata?.string(3)).toBe("devin-session-token$abc");
		expect(metadata?.string(21)).toBe("");
		expect(status.weeklyQuotaRemainingPercent).toBe(55);
	});

	it("decodes a gzip-encoded GetUserStatus body the way the CLI /usage call does", async () => {
		const fetchMock = vi.fn(async () => new Response(gzipSync(field(1, field(13, field(15, 55)))), { status: 200 }));
		const status = await getDevinUserStatus("devin-session-token$abc", new AbortController().signal, fetchMock);
		expect(status.weeklyQuotaRemainingPercent).toBe(55);
	});

	it("does not admit missing, disabled, internal, or ambiguous SWE-2 routes", () => {
		const family = field(
			30,
			Buffer.concat([field(1, "SWE-2"), field(2, Buffer.concat([field(1, "Effort"), field(2, field(2, "max"))]))]),
		);
		const candidate = Buffer.concat([field(22, "opaque-id"), family]);
		for (const input of [
			Buffer.alloc(0),
			field(1, Buffer.concat([candidate, field(4, true)])),
			field(1, Buffer.concat([candidate, field(23, field(2, true))])),
			Buffer.concat([field(1, candidate), field(1, candidate)]),
		]) {
			expect(() => resolveDevinRoute(new ProtoMessage(input), "max")).toThrow(/unavailable or ambiguous/);
		}
	});

	it.each([undefined, 0, 0.2])("encodes Devin sampling field numbers with temperature %s", (temperature) => {
		const request = buildDevinRequest(
			getModel("devin", "swe-2"),
			{ messages: [{ role: "user", content: "hello", timestamp: 1 }] },
			"fixture-uid",
			"fixture-session",
			16_384,
			{ temperature },
		);
		const config = new ProtoMessage(request).messages(8)[0];
		expect(config.number(1)).toBe(1);
		expect(config.number(2)).toBe(16_384);
		expect(config.number(3)).toBe(400);
		expect(config.number(7)).toBe(40);
		expect(config.number(5)).toBeCloseTo(temperature ?? 1);
		// Independent upstream schema: topP=8; firstTemperature=6 (not 4).
		// oh-my-pi 942383f, packages/catalog/src/discovery/devin-proto.ts.
		expect(config.number(8)).toBeCloseTo(0.95);
		expect(config.has(6)).toBe(false);
		expect(config.has(9)).toBe(false);
		expect(config.has(4)).toBe(false);
		expect(config.has(11)).toBe(false);
	});
});
