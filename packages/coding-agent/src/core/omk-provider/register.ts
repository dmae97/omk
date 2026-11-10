import type { ModelRegistry } from "../model-registry.ts";
import { markQualifiedOnlyProvider } from "../qualified-only-providers.ts";
import { OMK_BASE_URL_UNSET, readOmkBaseUrl } from "./base-url.ts";
import { isOmkProviderEnabled, OMK_ACCOUNT_TOKEN_ENV } from "./flag.ts";
import { omkGatewayStreamSimple } from "./gateway-stream.ts";
import { omkLoginProvider } from "./login.ts";
import { OMK_BASE_URL_MISSING_MESSAGE } from "./messages.ts";
import { OMK_MODEL_TABLE, OMK_PROVIDER_ID } from "./models.ts";
import { OMK_API } from "./route.ts";

export interface OmkProviderDiagnostic {
	type: "warning" | "error";
	message: string;
}

/**
 * Register the `OMK` provider when `OMK_PROVIDER_OMK=1`; otherwise do nothing at all. Returns diagnostics for the
 * caller to surface. The base URL comes only from `OMK_GATEWAY_BASE_URL` (no default endpoint); the token is read from
 * a stored `/login` token, else from `OMK_ACCOUNT_TOKEN`.
 */
export function registerOmkProviderIfEnabled(
	modelRegistry: ModelRegistry,
	env: NodeJS.ProcessEnv = process.env,
): OmkProviderDiagnostic[] {
	if (!isOmkProviderEnabled(env)) return [];
	const configured = readOmkBaseUrl(env);
	// Without a base URL the models are still registered (so selecting OMK/coder gets the OMK text, not "model not
	// found"); their stream path refuses to send anything. The warning is shown at startup.
	const diagnostics: OmkProviderDiagnostic[] = configured
		? []
		: [{ type: "warning", message: OMK_BASE_URL_MISSING_MESSAGE }];
	const baseUrl = configured ?? OMK_BASE_URL_UNSET;
	try {
		modelRegistry.registerProvider(OMK_PROVIDER_ID, {
			name: OMK_PROVIDER_ID,
			api: OMK_API,
			streamSimple: omkGatewayStreamSimple,
			baseUrl,
			apiKey: `$${OMK_ACCOUNT_TOKEN_ENV}`,
			oauth: omkLoginProvider,
			models: OMK_MODEL_TABLE.map(({ harness: _harness, noReasoningRoute: _route, ...model }) => model),
		});
		markQualifiedOnlyProvider(OMK_PROVIDER_ID);
		return diagnostics;
	} catch (error) {
		return [
			...diagnostics,
			{ type: "error", message: `OMK provider registration failed: ${(error as Error).message}` },
		];
	}
}
