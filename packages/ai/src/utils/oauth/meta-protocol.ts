import { proxyAwareFetch } from "../proxy-fetch.ts";
import type { OAuthCredentials } from "./types.ts";

export const META_OAUTH_PROVIDER_ID = "meta";
export const META_CLIENT_ID = "1031625952748946";
export const META_API_BASE_URL = "https://api.meta.ai/v1";

export const DEVICE_AUTHORIZATION_URL = "https://auth.meta.com/oidc/device/authorization/";
export const DEVICE_TOKEN_URL = "https://auth.meta.com/oidc/device/token/";
export const API_KEY_MINT_URL = "https://api.meta.ai/muse-code/key";
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const LAUNCHER_USER_AGENT = "muse-code/launcher-2";
export const API_USER_AGENT = "muse-code/1.0.2";
export const KEY_VALIDITY_MS = 20 * 60 * 60 * 1000;
export const EXPIRY_SKEW_MS = 5 * 60 * 1000;

const API_VERSION = "1.0.0";
const CLIENT_SURFACE = "tbh:tui";
const REQUEST_TIMEOUT_MS = 20_000;
const TRUSTED_VERIFICATION_HOSTS = ["auth.meta.com", "accountscenter.meta.com", "facebook.com", "www.facebook.com"];

export const MUSE_REQUEST_HEADERS = {
	"User-Agent": API_USER_AGENT,
	"x-api-version": API_VERSION,
	"x-client-id": CLIENT_SURFACE,
} as const;

export type FetchImpl = typeof fetch;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function textField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function positiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function errorDetail(body: Record<string, unknown>): string {
	for (const key of ["error_description", "detail", "title", "message", "error"]) {
		const value = body[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (isRecord(value) && typeof value.message === "string" && value.message.trim()) {
			return value.message.trim();
		}
	}
	return "";
}

export function isTrustedVerificationUri(raw: string): boolean {
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
		const host = url.hostname.toLowerCase();
		return TRUSTED_VERIFICATION_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
	} catch {
		return false;
	}
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
	const text = await response.text();
	if (!text) return {};
	try {
		const value: unknown = JSON.parse(text);
		return isRecord(value) ? value : {};
	} catch {
		return {};
	}
}

export async function postForm(
	url: string,
	fields: Record<string, string>,
	userAgent: string,
	fetchImpl: FetchImpl,
	signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const response = await fetchImpl(url, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": userAgent,
		},
		body: new URLSearchParams(fields),
		redirect: "manual",
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
	return { ok: response.ok, status: response.status, body: await readJson(response) };
}

export function credentialsFromMint(
	identity: string,
	apiKey: string,
	refreshToken: string | undefined,
	identityExpires: number | undefined,
	userEmail: string | undefined,
): OAuthCredentials {
	let expires = Date.now() + KEY_VALIDITY_MS - EXPIRY_SKEW_MS;
	if (identityExpires && identityExpires < expires) expires = identityExpires;
	const credentials: OAuthCredentials = { access: apiKey, refresh: identity, expires };
	if (refreshToken) credentials.metaRefreshToken = refreshToken;
	if (identityExpires) credentials.metaIdentityExpires = identityExpires;
	if (userEmail) credentials.userEmail = userEmail;
	return credentials;
}

export async function mintMetaApiKey(
	identityToken: string,
	fetchImpl: FetchImpl = proxyAwareFetch,
	signal?: AbortSignal,
): Promise<{ apiKey: string; userEmail?: string }> {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const response = await fetchImpl(API_KEY_MINT_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${identityToken}`,
			"Content-Type": "application/json",
			...MUSE_REQUEST_HEADERS,
		},
		body: JSON.stringify({ dca_token: identityToken }),
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
	const body = await readJson(response);
	if (response.status === 401 || response.status === 403) {
		throw new Error("Meta rejected the saved login; run /login meta again");
	}
	if (!response.ok) {
		const detail = errorDetail(body);
		throw new Error(`Meta API-key mint failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
	}
	if (body.require_payment === true) {
		const actionUrl = textField(body.action_url);
		throw new Error(
			actionUrl
				? `this Meta account is not set up for the Model API yet; finish setup at ${actionUrl}`
				: "this Meta account is not set up for the Model API yet",
		);
	}
	const apiKey = textField(body.api_key);
	if (!apiKey) {
		const actionUrl = textField(body.action_url);
		throw new Error(`Meta did not issue an API key.${actionUrl ? ` Complete setup at ${actionUrl}.` : ""}`);
	}
	const userEmail = textField(body.user_email) || undefined;
	return userEmail ? { apiKey, userEmail } : { apiKey };
}

export async function exchangeRefreshToken(
	refreshToken: string,
	fetchImpl: FetchImpl,
	signal?: AbortSignal,
): Promise<{ identity: string; refreshToken: string; identityExpires?: number }> {
	const grant = await postForm(
		DEVICE_TOKEN_URL,
		{ grant_type: "refresh_token", client_id: META_CLIENT_ID, refresh_token: refreshToken },
		LAUNCHER_USER_AGENT,
		fetchImpl,
		signal,
	);
	if (grant.status === 404 || grant.status === 401) {
		throw new Error("Meta login is no longer valid; run /login meta again");
	}
	if (!grant.ok) {
		const detail = errorDetail(grant.body);
		throw new Error(`Meta token refresh failed (HTTP ${grant.status})${detail ? `: ${detail}` : ""}`);
	}
	const identity = textField(grant.body.access_token);
	if (!identity) throw new Error("Meta token refresh returned no access_token");
	const nextRefresh = textField(grant.body.refresh_token) || refreshToken;
	const expiresIn = positiveNumber(grant.body.expires_in, 0);
	return {
		identity,
		refreshToken: nextRefresh,
		identityExpires: expiresIn > 0 ? Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS : undefined,
	};
}
