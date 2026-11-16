import { streamSimple } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithOmkCapture } from "../src/core/omk-provider/gateway-capture.ts";
import { FIXTURE_TOKEN, registryWithOmk } from "./omk-provider-flag-on-lib.ts";

/**
 * QA 11/18 checklist item 2: existing tests already show a quota 429 is sent once and not retried, but they do not
 * assert that the rewritten response carries `x-should-retry` equal to "false".
 *
 * The inverse — a non-OMK call with `x-omk-retryable: false` does not get `x-should-retry` added — is already
 * covered in omk-provider-fetch-wrapper.test.ts (and the "leaves other fetch callers alone" case in
 * omk-provider-gateway-errors.test.ts). This file does not repeat it.
 */
const WRAPPED = Symbol.for("omk.provider.omk.fetch");

function quota429(): Response {
	return new Response(
		JSON.stringify({
			error: { message: "Monthly token budget used.", type: "x", code: "quota_exceeded", param: null },
		}),
		{
			status: 429,
			headers: { "content-type": "application/json", "x-omk-retryable": "false" },
		},
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("OMK quota 429: the rewritten response carries x-should-retry=false", () => {
	it("maps x-omk-retryable: false to x-should-retry: false inside the capture", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => quota429()),
		);
		const response = await runWithOmkCapture({}, () => fetch("https://gateway.invalid/v1/chat/completions"));
		expect(response.status).toBe(429);
		expect(response.headers.get("x-should-retry")).toBe("false");
	});

	it("the 429 the SDK sees on a monthly quota error has x-should-retry equal to false", async () => {
		const seen: Response[] = [];
		const stub = vi.fn(async () => quota429());
		vi.stubGlobal("fetch", stub);
		// Install the observer around the stub, then record the Response it hands to the SDK.
		runWithOmkCapture({}, () => undefined);
		const observer = globalThis.fetch;
		const recording: typeof fetch = async (input, init) => {
			const response = await observer(input, init);
			seen.push(response);
			return response;
		};
		(recording as unknown as Record<symbol, boolean>)[WRAPPED] = true;
		vi.stubGlobal("fetch", recording);

		const model = registryWithOmk().find("OMK", "coder");
		if (!model) throw new Error("OMK model missing");
		const message = await streamSimple(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
			{ apiKey: FIXTURE_TOKEN, maxRetries: 3 },
		).result();

		expect(stub).toHaveBeenCalledTimes(1);
		expect(message.errorMessage).toContain("OMK monthly quota exceeded");
		expect(seen).toHaveLength(1);
		expect(seen[0]?.status).toBe(429);
		expect(seen[0]?.headers.get("x-should-retry")).toBe("false");
	});
});
