/**
 * Muse Code subscription OAuth.
 *
 * RFC 8628 device flow against auth.meta.com, then mint a Model API key at
 * /muse-code/key. Inference accepts the minted key, not the identity token.
 * HTTP(S)_PROXY is honored for the login.
 */
import type { Api, Model } from "../../types.ts";
import { proxyAwareFetch } from "../proxy-fetch.ts";
import { pollOAuthDeviceCodeFlow } from "./device-code.ts";
import {
	credentialsFromMint,
	DEVICE_AUTHORIZATION_URL,
	DEVICE_GRANT,
	DEVICE_TOKEN_URL,
	errorDetail,
	exchangeRefreshToken,
	EXPIRY_SKEW_MS,
	type FetchImpl,
	isTrustedVerificationUri,
	LAUNCHER_USER_AGENT,
	META_API_BASE_URL,
	META_CLIENT_ID,
	META_OAUTH_PROVIDER_ID,
	mintMetaApiKey,
	MUSE_REQUEST_HEADERS,
	positiveNumber,
	postForm,
	textField,
} from "./meta-protocol.ts";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.ts";

export {
	META_API_BASE_URL,
	META_CLIENT_ID,
	META_OAUTH_PROVIDER_ID,
	mintMetaApiKey,
} from "./meta-protocol.ts";

/** Muse Code device-code login, then mint a subscription Model API key. */
export async function loginMeta(
	callbacks: OAuthLoginCallbacks,
	fetchImpl: FetchImpl = proxyAwareFetch,
): Promise<OAuthCredentials> {
	callbacks.onProgress?.("Starting Muse Code device authorization…");
	const authorization = await postForm(
		DEVICE_AUTHORIZATION_URL,
		{ client_id: META_CLIENT_ID },
		LAUNCHER_USER_AGENT,
		fetchImpl,
		callbacks.signal,
	);
	if (!authorization.ok) {
		const detail = errorDetail(authorization.body);
		throw new Error(
			`Muse Code login could not be started (HTTP ${authorization.status})${detail ? `: ${detail}` : ""}`,
		);
	}
	const deviceCode = textField(authorization.body.device_code);
	const userCode = textField(authorization.body.user_code);
	const verificationUri = textField(authorization.body.verification_uri);
	const verificationUriComplete = textField(authorization.body.verification_uri_complete);
	if (!deviceCode || !userCode || !verificationUri) {
		throw new Error("Meta device authorization returned an incomplete response");
	}
	if (!isTrustedVerificationUri(verificationUri)) {
		throw new Error("Meta device authorization returned an untrusted verification URI");
	}
	const chosenUri =
		verificationUriComplete && isTrustedVerificationUri(verificationUriComplete)
			? verificationUriComplete
			: verificationUri;

	const intervalSeconds = positiveNumber(authorization.body.interval, 5);
	const expiresInSeconds = positiveNumber(authorization.body.expires_in, 900);
	callbacks.onDeviceCode({
		userCode,
		verificationUri: chosenUri,
		intervalSeconds,
		expiresInSeconds,
	});
	callbacks.onProgress?.("Waiting for Muse Code login approval…");

	const grant = await pollOAuthDeviceCodeFlow<Record<string, unknown>>({
		intervalSeconds,
		expiresInSeconds,
		signal: callbacks.signal,
		poll: async () => {
			const token = await postForm(
				DEVICE_TOKEN_URL,
				{ grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: META_CLIENT_ID },
				LAUNCHER_USER_AGENT,
				fetchImpl,
				callbacks.signal,
			);
			if (token.ok && textField(token.body.access_token)) {
				return { status: "complete", value: token.body };
			}
			const errorCode = textField(token.body.error);
			if (errorCode === "authorization_pending") return { status: "pending" };
			if (errorCode === "slow_down") return { status: "slow_down" };
			if (errorCode === "access_denied") return { status: "failed", message: "Muse Code login was denied" };
			if (errorCode === "expired_token") return { status: "failed", message: "Muse Code login request expired" };
			const detail = errorDetail(token.body);
			return {
				status: "failed",
				message: `Muse Code login failed (HTTP ${token.status})${detail ? `: ${detail}` : ""}`,
			};
		},
	});

	const identity = textField(grant.access_token);
	if (!identity) throw new Error("Muse Code login request expired");
	callbacks.onProgress?.("Enabling Meta Model API access…");
	const minted = await mintMetaApiKey(identity, fetchImpl, callbacks.signal);
	const expiresIn = positiveNumber(grant.expires_in, 0);
	return credentialsFromMint(
		identity,
		minted.apiKey,
		textField(grant.refresh_token) || undefined,
		expiresIn > 0 ? Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS : undefined,
		minted.userEmail,
	);
}

/** Re-mint the Model API key; renew the identity token when Meta rejects it. */
export async function refreshMetaToken(
	credentials: OAuthCredentials,
	fetchImpl: FetchImpl = proxyAwareFetch,
): Promise<OAuthCredentials> {
	const identity = credentials.refresh;
	if (!identity) throw new Error("Meta login is missing its identity token; run /login meta again");
	const storedRefresh = textField(credentials.metaRefreshToken) || undefined;
	const previousEmail = textField(credentials.userEmail) || undefined;
	try {
		const minted = await mintMetaApiKey(identity, fetchImpl);
		return credentialsFromMint(
			identity,
			minted.apiKey,
			storedRefresh,
			typeof credentials.metaIdentityExpires === "number" ? credentials.metaIdentityExpires : undefined,
			minted.userEmail ?? previousEmail,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!storedRefresh || !message.includes("rejected the saved login")) throw error;
	}
	const renewed = await exchangeRefreshToken(storedRefresh, fetchImpl);
	const minted = await mintMetaApiKey(renewed.identity, fetchImpl);
	return credentialsFromMint(
		renewed.identity,
		minted.apiKey,
		renewed.refreshToken,
		renewed.identityExpires,
		minted.userEmail ?? previousEmail,
	);
}

export const metaOAuthProvider: OAuthProviderInterface = {
	id: META_OAUTH_PROVIDER_ID,
	name: "Muse Code (subscription)",
	usesCallbackServer: false,
	login: loginMeta,
	refreshToken: refreshMetaToken,
	getApiKey: (credentials) => credentials.access,
	getAccountLabel: (credentials) => textField(credentials.userEmail) || undefined,
	modifyModels(models: Model<Api>[]): Model<Api>[] {
		return models.map((model) =>
			model.provider === META_OAUTH_PROVIDER_ID
				? {
						...model,
						baseUrl: model.baseUrl ?? META_API_BASE_URL,
						headers: { ...model.headers, ...MUSE_REQUEST_HEADERS },
					}
				: model,
		);
	},
};
