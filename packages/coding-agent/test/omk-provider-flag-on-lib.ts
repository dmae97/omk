import { type Api, type Context, type Model, type SimpleStreamOptions, streamSimple } from "omk-ai";
import { vi } from "vitest";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { registerOmkProviderIfEnabled } from "../src/core/omk-provider/register.ts";
import { createCatalogRegistry } from "./omk-provider-golden-lib.ts";

/** Example host: `.invalid` never resolves, and no test here opens a socket. */
export const GATEWAY_URL = "https://gateway.invalid/v1";
/** Placeholder, not a credential. */
export const FIXTURE_TOKEN = "fixture-omk-token";
/** Flag on, URL set. Passed explicitly so tests do not depend on process.env (setup-env scrubs OMK_*). */
export const ON_ENV: NodeJS.ProcessEnv = { OMK_PROVIDER_OMK: "1", OMK_GATEWAY_BASE_URL: GATEWAY_URL };

/** Catalog registry plus the OMK provider registered the way createAgentSessionServices does it. */
export function registryWithOmk(env: NodeJS.ProcessEnv = ON_ENV): ModelRegistry {
	const registry = createCatalogRegistry();
	const diagnostics = registerOmkProviderIfEnabled(registry, env);
	if (diagnostics.length > 0) throw new Error(`unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
	return registry;
}

export const ref = (m: { provider: string; id: string } | undefined): string | null =>
	m ? `${m.provider}/${m.id}` : null;

class PayloadCaptured extends Error {}

/** The request body `streamSimple` builds for `model`; `onPayload` aborts before any network call. */
export async function capturePayload(
	model: Model<Api>,
	options: Partial<SimpleStreamOptions>,
	messages: Context["messages"] = [{ role: "user", content: "fixture", timestamp: 0 }],
): Promise<Record<string, unknown>> {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Unexpected network call");
		}),
	);
	let payload: Record<string, unknown> | undefined;
	await streamSimple(
		model,
		{ messages },
		{
			apiKey: FIXTURE_TOKEN,
			maxTokens: 4096,
			...options,
			onPayload: (body) => {
				payload = body as Record<string, unknown>;
				throw new PayloadCaptured();
			},
		},
	).result();
	if (!payload) throw new Error("no payload captured");
	return payload;
}

/** The HTTP request the OpenAI client sends: URL, Authorization header and JSON body. 400 reply, so no retries. */
export async function captureRequest(model: Model<Api>, options: Partial<SimpleStreamOptions> = {}) {
	const seen: { url: string; authorization: string | null; body: Record<string, unknown> }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: unknown, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			seen.push({
				url: String(input instanceof Request ? input.url : input),
				authorization: headers.get("authorization"),
				body: JSON.parse(String(init?.body ?? "{}")),
			});
			return new Response(JSON.stringify({ error: { message: "fixture" } }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}),
	);
	await streamSimple(
		model,
		{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
		{ apiKey: FIXTURE_TOKEN, ...options },
	).result();
	return seen;
}
