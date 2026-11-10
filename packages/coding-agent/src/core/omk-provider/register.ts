import type { ModelRegistry } from "../model-registry.ts";
import { isOmkProviderEnabled, OMK_ACCOUNT_TOKEN_ENV, OMK_GATEWAY_BASE_URL_ENV } from "./flag.ts";
import { OMK_MODEL_TABLE, OMK_PROVIDER_ID } from "./models.ts";

export interface OmkProviderDiagnostic {
	type: "warning" | "error";
	message: string;
}

/**
 * Register the `OMK` provider when `OMK_PROVIDER_OMK=1`; otherwise do nothing at all. Returns diagnostics for the
 * caller to surface. The base URL comes only from `OMK_GATEWAY_BASE_URL` (no default); the token is read from
 * `OMK_ACCOUNT_TOKEN` until the login flow lands.
 */
export function registerOmkProviderIfEnabled(
	modelRegistry: ModelRegistry,
	env: NodeJS.ProcessEnv = process.env,
): OmkProviderDiagnostic[] {
	if (!isOmkProviderEnabled(env)) return [];
	const baseUrl = env[OMK_GATEWAY_BASE_URL_ENV]?.trim().replace(/\/+$/, "");
	if (!baseUrl) {
		return [
			{
				type: "warning",
				message: `OMK provider is enabled but ${OMK_GATEWAY_BASE_URL_ENV} is not set; not registered.`,
			},
		];
	}
	try {
		modelRegistry.registerProvider(OMK_PROVIDER_ID, {
			name: OMK_PROVIDER_ID,
			api: "openai-completions",
			baseUrl,
			apiKey: `$${OMK_ACCOUNT_TOKEN_ENV}`,
			models: OMK_MODEL_TABLE.map(({ harness: _harness, ...model }) => model),
		});
		return [];
	} catch (error) {
		return [{ type: "error", message: `OMK provider registration failed: ${(error as Error).message}` }];
	}
}
