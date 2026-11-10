/** Opt-in switch for the OMK gateway provider (default off). Strict: only the exact string "1" turns it on. */
export const OMK_PROVIDER_FLAG_ENV = "OMK_PROVIDER_OMK";

/** Gateway base URL, e.g. `https://host/v1`. There is deliberately no default. */
export const OMK_GATEWAY_BASE_URL_ENV = "OMK_GATEWAY_BASE_URL";

/** Account token for the gateway until the login flow (PR b) stores one in auth.json. */
export const OMK_GATEWAY_TOKEN_ENV = "OMK_GATEWAY_TOKEN";

export function isOmkProviderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[OMK_PROVIDER_FLAG_ENV] === "1";
}
