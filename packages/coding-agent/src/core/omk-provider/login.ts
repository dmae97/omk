import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "omk-ai/oauth";
import { OMK_ACCOUNT_TOKEN_ENV } from "./flag.ts";

/**
 * `/login` for OMK: the user pastes the account token the admin issued. It is stored by the regular auth storage
 * (auth.json, same shape as the other paste-a-token providers: no refresh, never expires locally; the gateway
 * decides) and read back as the request's bearer token. There is no browser step, so no URL is shown.
 */
async function loginOmk(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	if (!callbacks.onPrompt) throw new Error("OMK login requires interactive prompt support");
	const entered = await callbacks.onPrompt({
		message: `Paste your OMK account token (or set ${OMK_ACCOUNT_TOKEN_ENV})`,
	});
	if (callbacks.signal?.aborted) throw new Error("Login cancelled");
	const token = entered.trim();
	if (!token) throw new Error("OMK account token is required");
	if (/\s/.test(token)) throw new Error("OMK account token must not contain whitespace");
	return { access: token, refresh: token, expires: Number.MAX_SAFE_INTEGER };
}

export const omkLoginProvider: Omit<OAuthProviderInterface, "id"> = {
	name: "OMK account token",
	login: loginOmk,
	refreshToken: (credentials) => Promise.resolve(credentials),
	getApiKey: (credentials) => credentials.access,
};
