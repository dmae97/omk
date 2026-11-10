import { type AssistantMessage, streamSimple } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { preflightFailureCause, providerFailureCause } from "../src/core/session-failure-cause.ts";
import { FIXTURE_TOKEN, registryWithOmk } from "./omk-provider-flag-on-lib.ts";
import { createCatalogRegistry } from "./omk-provider-golden-lib.ts";

const AUTH = { area: "provider", code: "auth" };

function reply(status: number, code: string, message: string): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { message, type: "x", code, param: null } }), {
					status,
					headers: { "content-type": "application/json" },
				}),
		),
	);
}

async function ask(apiKey: string | undefined): Promise<AssistantMessage> {
	const model = registryWithOmk().find("OMK", "coder");
	if (!model) throw new Error("OMK/coder missing");
	return streamSimple(
		model,
		{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
		{ apiKey, maxRetries: 0 },
	).result();
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("OMK account failures are classified provider.auth (flag on)", () => {
	it("token missing", async () => {
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		const message = await ask(undefined);
		expect(message.errorMessage).toContain("OMK account token missing");
		expect(providerFailureCause(message, 1_000_000)).toEqual(AUTH);
		expect(preflightFailureCause(message.errorMessage ?? "", true)).toEqual(AUTH);
	});

	it.each([
		[401, "token_invalid", "The token is not valid."],
		[401, "token_expired", "This token has expired."],
		[403, "token_revoked", "This token was revoked."],
		[403, "model_not_allowed", "This model is not available for this token."],
	])("token rejected by the gateway: %s %s", async (status, code, text) => {
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		reply(status, code, text);
		const message = await ask(FIXTURE_TOKEN);
		expect(message.errorMessage).toMatch(/^OMK (token|model)/);
		expect(providerFailureCause(message, 1_000_000)).toEqual(AUTH);
		expect(preflightFailureCause(message.errorMessage ?? "", true)).toEqual(AUTH);
	});

	it("base URL missing", () => {
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		const [diagnostic] = registerOmkProviderIfEnabled(createCatalogRegistry(), { OMK_PROVIDER_OMK: "1" });
		expect(diagnostic.message).toContain("OMK gateway base URL missing");
		expect(providerFailureCause({ errorMessage: diagnostic.message } as AssistantMessage, 1_000_000)).toEqual(AUTH);
		expect(preflightFailureCause(diagnostic.message, true)).toEqual(AUTH);
	});

	it("the quota and rate-limit texts keep their own classification", async () => {
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		reply(429, "quota_exceeded", "Monthly token budget used.");
		expect(providerFailureCause(await ask(FIXTURE_TOKEN), 1_000_000)).toEqual({
			area: "provider",
			code: "rate_limit",
		});
	});
});

describe("flag off or another provider: classification is unchanged", () => {
	const texts = [
		"OMK account token missing. Set OMK_ACCOUNT_TOKEN or run /login and choose OMK.",
		"OMK token rejected (401 token_invalid): the gateway does not accept this token.",
		"OMK model not allowed for this token (403 model_not_allowed): choose another.",
		"OMK gateway base URL missing. Set OMK_GATEWAY_BASE_URL.",
		"401 Incorrect API key provided",
		"400 Bad request",
		"Connection error.",
	];

	it("with the flag off the OMK texts get what the generic rules gave them, never an OMK-specific cause", () => {
		const off = texts.map((t) => providerFailureCause({ errorMessage: t } as AssistantMessage, 1_000_000));
		vi.stubEnv("OMK_PROVIDER_OMK", "1");
		const on = texts.map((t) => providerFailureCause({ errorMessage: t } as AssistantMessage, 1_000_000));
		// Texts of other providers (the last three) classify identically on and off.
		expect(on.slice(4)).toEqual(off.slice(4));
		// model_not_allowed / base URL fall to protocol without the OMK hook (the T-13 finding); with it they are auth.
		expect(off[2]).toEqual({ area: "provider", code: "protocol" });
		expect(on[2]).toEqual(AUTH);
		expect(off[3]).toEqual({ area: "provider", code: "protocol" });
		expect(on[3]).toEqual(AUTH);
	});
});
