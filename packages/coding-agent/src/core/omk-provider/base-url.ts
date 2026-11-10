import { OMK_GATEWAY_BASE_URL_ENV } from "./flag.ts";

/**
 * Base URL the OMK models carry when `OMK_GATEWAY_BASE_URL` is unset. It is not a default endpoint: `.invalid` never
 * resolves, and the OMK stream path answers with the "base URL missing" error before any request is built, so the
 * models stay selectable (`--model OMK/coder`, `/model`) and the user gets the OMK text instead of "model not found".
 */
export const OMK_BASE_URL_UNSET = "https://omk-base-url-unset.invalid/v1";

/** The configured gateway base URL (trimmed, no trailing slashes), or undefined when the env var is unset/blank. */
export function readOmkBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return env[OMK_GATEWAY_BASE_URL_ENV]?.trim().replace(/\/+$/, "") || undefined;
}
