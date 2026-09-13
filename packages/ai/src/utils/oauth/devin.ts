import { normalizeDevinToken } from "../../providers/devin-api.ts";
import { proxyAwareFetch } from "../proxy-fetch.ts";
import { type DevinCallback, startDevinCallback } from "./devin-callback.ts";
import { generatePKCE } from "./pkce.ts";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.ts";

export const DEVIN_OAUTH_PROVIDER_ID = "devin";
const CALLBACK_PORT = 59653;
const TOKEN_URL = "https://api.devin.ai/auth/cli/token";
const WEB_URL = "https://app.devin.ai/auth/cli/continue";
const TOKEN_PREFIX = "devin-session-token$";

function tokenExpiry(token: string): number {
	const raw = token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : token;
	const payload = raw.split(".")[1];
	if (payload) {
		try {
			const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
			if (
				decoded &&
				typeof decoded === "object" &&
				"exp" in decoded &&
				typeof decoded.exp === "number" &&
				Number.isFinite(decoded.exp)
			) {
				return decoded.exp * 1000 - 30_000;
			}
		} catch {
			// Opaque session tokens have no JWT expiry; the server remains authoritative.
		}
	}
	return Date.now() + 365 * 24 * 60 * 60 * 1000;
}

async function manualCode(
	callbacks: OAuthLoginCallbacks,
	redirectUri: string,
	state: string,
	signal: AbortSignal,
): Promise<string> {
	let cancel: () => void = () => {};
	const aborted = new Promise<never>((_resolve, reject) => {
		cancel = () => reject(new Error("Devin login cancelled or timed out"));
	});
	signal.addEventListener("abort", cancel, { once: true });
	try {
		signal.throwIfAborted();
		const input = await Promise.race([
			callbacks.onPrompt({
				message: "Paste the complete Devin callback URL from your browser:",
				placeholder: redirectUri,
			}),
			aborted,
		]);
		let url: URL;
		try {
			url = new URL(input.trim());
		} catch {
			throw new Error("Invalid Devin callback URL");
		}
		const expected = new URL(redirectUri);
		if (
			url.origin !== expected.origin ||
			url.pathname !== expected.pathname ||
			url.username ||
			url.password ||
			url.searchParams.get("state") !== state
		) {
			throw new Error("Devin OAuth callback or state mismatch");
		}
		const code = url.searchParams.get("code");
		if (!code || url.searchParams.has("error")) throw new Error("Devin login was not approved");
		return code;
	} finally {
		signal.removeEventListener("abort", cancel);
	}
}

/** The official CLI's PKCE session-token flow; no paid Devin REST API key is needed. */
export async function loginDevin(
	callbacks: OAuthLoginCallbacks,
	options: { port?: number; timeoutMs?: number } = {},
): Promise<OAuthCredentials> {
	const controller = new AbortController();
	const signal = callbacks.signal ? AbortSignal.any([callbacks.signal, controller.signal]) : controller.signal;
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 300_000);
	let callback: DevinCallback | undefined;
	try {
		signal.throwIfAborted();
		const { verifier, challenge } = await generatePKCE();
		const state = crypto.randomUUID();
		const port = options.port ?? CALLBACK_PORT;
		let redirectUri = `http://127.0.0.1:${port}/callback`;
		try {
			callback = await startDevinCallback(state, signal, port);
			redirectUri = callback.redirectUri;
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE") throw error;
			callbacks.onProgress?.("Callback port is busy; use the complete callback URL for manual login.");
		}
		const params = new URLSearchParams({
			redirect_uri: redirectUri,
			state,
			prompt: "select_account",
			code_challenge: challenge,
			code_challenge_method: "S256",
		});
		callbacks.onAuth({
			url: `${WEB_URL}?${params}`,
			instructions: "Sign in with your Devin CLI subscription account.",
		});
		callbacks.onProgress?.("Waiting for Devin browser authentication...");
		const code = callback ? await callback.code : await manualCode(callbacks, redirectUri, state, signal);
		signal.throwIfAborted();
		if (!code) throw new Error("Devin login was not approved");
		callbacks.onProgress?.("Exchanging the Devin authorization code...");
		const response = await proxyAwareFetch(TOKEN_URL, {
			method: "POST",
			redirect: "error",
			signal,
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ code, code_verifier: verifier }),
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`Devin token exchange failed (HTTP ${response.status})`);
		}
		let data: unknown;
		try {
			data = await response.json();
		} catch {
			throw new Error("Invalid Devin token exchange response");
		}
		if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string")
			throw new Error("Devin token exchange response missing token");
		const access = normalizeDevinToken(data.token);
		const expires = tokenExpiry(access);
		if (expires <= Date.now()) throw new Error("Devin returned an expired session token; sign in again");
		return { access, refresh: access, expires };
	} finally {
		clearTimeout(timer);
		await callback?.close();
	}
}

export const devinOAuthProvider: OAuthProviderInterface = {
	id: DEVIN_OAUTH_PROVIDER_ID,
	name: "Devin CLI (subscription)",
	// This flow owns its callback wait; the generic UI must not start a second code prompt.
	usesCallbackServer: false,
	login: loginDevin,
	async refreshToken(credentials) {
		if (credentials.expires <= Date.now())
			throw new Error("Devin session expired; run /login devin again (no refresh endpoint)");
		return credentials;
	},
	getApiKey: (credentials) => normalizeDevinToken(credentials.access),
};
