/**
 * Perplexity login and token refresh.
 *
 * Login paths (in priority order):
 * 1. macOS native app: reads JWT from NSUserDefaults (`defaults read ai.perplexity.mac authToken`)
 * 2. HTTP email OTP: `GET /api/auth/csrf` → `POST /api/auth/signin-email` → `POST /api/auth/signin-otp`
 *
 * No browser or manual cookie paste required.
 * Refresh: Socket.IO `refreshJWT` RPC over authenticated WebSocket connection.
 *
 * Protocol: Engine.IO v4 + Socket.IO v4 over WebSocket (bypasses Cloudflare managed challenge).
 * Architecture reverse-engineered from Perplexity macOS app (ai.perplexity.mac).
 */
import * as os from "node:os";
import { $env } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import type { OAuthController, OAuthCredentials } from "./types";

const WS_URL = "wss://www.perplexity.ai/socket.io/?EIO=4&transport=websocket";
const API_VERSION = "2.18";
const NATIVE_APP_BUNDLE = "ai.perplexity.mac";
const APP_USER_AGENT = "Perplexity/641 CFNetwork/1568 Darwin/25.2.0";
const CONNECT_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Socket.IO v4 client (Engine.IO v4 transport: WebSocket only)
// ---------------------------------------------------------------------------

/**
 * Minimal Socket.IO v4 client over Engine.IO v4 WebSocket transport.
 *
 * Supports:
 * - Authenticated namespace connect (`40{...auth}`)
 * - Fire-and-forget events (Socket.IO EVENT, type `42`)
 * - Request-reply RPCs via ack pattern (EVENT with ack id → ACK response)
 * - Engine.IO ping/pong keepalive
 */
class PerplexitySocket {
	#ws: WebSocket;
	#nextAckId = 0;
	#pendingAcks = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: Timer }>();
	#ready: Promise<void>;
	#messageHandler?: (data: string) => void;

	constructor(auth?: Record<string, string>) {
		this.#ws = new WebSocket(WS_URL, {
			headers: {
				"User-Agent": "PerplexityApp",
				"X-App-ApiVersion": API_VERSION,
			},
		} as unknown as string[]);

		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.#ready = promise;

		const timeout = setTimeout(() => reject(new Error("Socket.IO connection timeout")), CONNECT_TIMEOUT_MS);
		let phase = 0;

		this.#ws.onmessage = ev => {
			const data = String(ev.data);

			// Engine.IO ping → pong
			if (data === "2") {
				this.#ws.send("3");
				return;
			}

			// Phase 0: Engine.IO OPEN packet → send Socket.IO CONNECT
			if (data.startsWith("0{") && phase === 0) {
				phase = 1;
				const payload = auth ? `40${JSON.stringify(auth)}` : "40";
				this.#ws.send(payload);
				return;
			}

			// Phase 1: Socket.IO CONNECT acknowledgment
			if (data.startsWith("40") && phase === 1) {
				clearTimeout(timeout);
				phase = 2;
				this.#installRpcHandler();
				resolve();
				return;
			}

			// Socket.IO CONNECT_ERROR (type 44)
			if (data.startsWith("44")) {
				clearTimeout(timeout);
				const body = data.slice(2);
				reject(new Error(`Socket.IO connect error: ${body}`));
			}
		};

		this.#ws.onerror = () => {
			clearTimeout(timeout);
			reject(new Error("WebSocket error"));
		};
		this.#ws.onclose = () => {
			clearTimeout(timeout);
			reject(new Error("WebSocket closed during handshake"));
		};
	}

	#installRpcHandler(): void {
		this.#ws.onmessage = ev => {
			const data = String(ev.data);

			if (data === "2") {
				this.#ws.send("3");
				return;
			}

			// Forward to external listener if set
			this.#messageHandler?.(data);

			// Socket.IO ACK: 43<ackId><json>
			if (data.startsWith("43")) {
				const match = data.match(/^43(\d+)([\s\S]*)/);
				if (!match) return;

				const ackId = Number.parseInt(match[1], 10);
				const pending = this.#pendingAcks.get(ackId);
				if (!pending) return;

				this.#pendingAcks.delete(ackId);
				clearTimeout(pending.timer);

				let payload: unknown;
				try {
					payload = match[2] ? JSON.parse(match[2]) : undefined;
				} catch {
					pending.reject(new Error(`Malformed ACK payload for ack ${ackId}`));
					return;
				}

				// ACK payload is a JSON array; unwrap first element
				const result = Array.isArray(payload) ? (payload[0] as Record<string, unknown>) : payload;

				if (result && typeof result === "object" && "error" in result) {
					const r = result as Record<string, unknown>;
					const msg = (r.error_message ?? r.error_code ?? r.error ?? "RPC error") as string;
					pending.reject(new Error(msg));
				} else {
					pending.resolve(result);
				}
			}
		};

		this.#ws.onclose = () => {
			for (const p of this.#pendingAcks.values()) {
				clearTimeout(p.timer);
				p.reject(new Error("Socket closed"));
			}
			this.#pendingAcks.clear();
		};
	}

	/** Wait for the connection handshake to complete. */
	ready(): Promise<void> {
		return this.#ready;
	}

	/** Set an external message listener (for debugging or event handling). */
	onMessage(handler: (data: string) => void): void {
		this.#messageHandler = handler;
	}

	/** Fire-and-forget event (Socket.IO EVENT, no ack). */
	emit(event: string, data: unknown): void {
		this.#ws.send(`42${JSON.stringify([event, data])}`);
	}

	/** Emit event and wait for ack response (request-reply RPC). */
	emitWithAck<T = unknown>(event: string, data: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
		const id = this.#nextAckId++;
		const { promise, resolve, reject } = Promise.withResolvers<T>();

		const timer = setTimeout(() => {
			this.#pendingAcks.delete(id);
			reject(new Error(`RPC timeout: ${event}`));
		}, timeoutMs);

		this.#pendingAcks.set(id, {
			resolve: resolve as (v: unknown) => void,
			reject,
			timer,
		});

		// Socket.IO EVENT with ack: 42<ackId>["event", data]
		this.#ws.send(`42${id}${JSON.stringify([event, data])}`);
		return promise;
	}

	/** Close the socket and reject all pending RPCs. */
	close(): void {
		for (const p of this.#pendingAcks.values()) {
			clearTimeout(p.timer);
			p.reject(new Error("Socket closed"));
		}
		this.#pendingAcks.clear();
		try {
			this.#ws.close();
		} catch {
			// Ignore close errors
		}
	}
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/** Extract expiry from a JWT. Falls back to 1 hour from now. Subtracts 5 min safety margin. */
function getJwtExpiry(token: string): number {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return Date.now() + 3600_000;
		const payload = parts[1] ?? "";
		const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
		if (decoded?.exp && typeof decoded.exp === "number") {
			return decoded.exp * 1000 - 5 * 60_000;
		}
	} catch {
		// Ignore decode errors
	}
	return Date.now() + 3600_000;
}

/** Build OAuthCredentials from a Perplexity JWT string. */
function jwtToCredentials(jwt: string, email?: string): OAuthCredentials {
	return {
		access: jwt,
		refresh: jwt,
		expires: getJwtExpiry(jwt),
		email,
	};
}

// ---------------------------------------------------------------------------
// Desktop app extraction
// ---------------------------------------------------------------------------

/**
 * Read the Perplexity JWT from the native macOS Catalyst app's UserDefaults.
 * Tokens are stored in NSUserDefaults (not Keychain), readable by any same-UID process.
 */
async function extractFromNativeApp(): Promise<string | null> {
	if (os.platform() !== "darwin") return null;

	try {
		const result = await $`defaults read ${NATIVE_APP_BUNDLE} authToken`.quiet().nothrow();
		if (result.exitCode !== 0) return null;
		const token = result.text().trim();
		if (!token || token === "(null)") return null;
		return token;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Socket.IO email OTP login
// ---------------------------------------------------------------------------

/**
 * Send email OTP and exchange it for a Perplexity JWT via HTTP endpoints.
 */
async function httpEmailLogin(ctrl: OAuthController): Promise<OAuthCredentials> {
	if (!ctrl.onPrompt) {
		throw new Error("Perplexity login requires onPrompt callback");
	}
	const email = await ctrl.onPrompt({
		message: "Enter your Perplexity email address",
		placeholder: "user@example.com",
	});
	const trimmedEmail = email.trim();
	if (!trimmedEmail) throw new Error("Email is required for Perplexity login");
	if (ctrl.signal?.aborted) throw new Error("Login cancelled");

	ctrl.onProgress?.("Fetching Perplexity CSRF token...");
	const csrfResponse = await fetch("https://www.perplexity.ai/api/auth/csrf", {
		headers: {
			"User-Agent": APP_USER_AGENT,
			"X-App-ApiVersion": API_VERSION,
		},
		signal: ctrl.signal,
	});

	if (!csrfResponse.ok) {
		throw new Error(`Perplexity CSRF request failed: ${csrfResponse.status}`);
	}

	const csrfData = (await csrfResponse.json()) as { csrfToken?: string };
	if (!csrfData.csrfToken) {
		throw new Error("Perplexity CSRF response missing csrfToken");
	}
	ctrl.onProgress?.("Sending login code to your email...");
	const sendResponse = await fetch("https://www.perplexity.ai/api/auth/signin-email", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": APP_USER_AGENT,
			"X-App-ApiVersion": API_VERSION,
		},
		body: JSON.stringify({
			email: trimmedEmail,
			csrfToken: csrfData.csrfToken,
		}),
		signal: ctrl.signal,
	});

	if (!sendResponse.ok) {
		const body = await sendResponse.text();
		throw new Error(`Perplexity send login code failed (${sendResponse.status}): ${body}`);
	}
	const otp = await ctrl.onPrompt({
		message: "Enter the code sent to your email",
		placeholder: "123456",
	});
	const trimmedOtp = otp.trim();
	if (!trimmedOtp) throw new Error("OTP code is required");
	if (ctrl.signal?.aborted) throw new Error("Login cancelled");
	ctrl.onProgress?.("Verifying login code...");
	const verifyResponse = await fetch("https://www.perplexity.ai/api/auth/signin-otp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": APP_USER_AGENT,
			"X-App-ApiVersion": API_VERSION,
		},
		body: JSON.stringify({
			email: trimmedEmail,
			otp: trimmedOtp,
			csrfToken: csrfData.csrfToken,
		}),
		signal: ctrl.signal,
	});

	const verifyData = (await verifyResponse.json()) as {
		token?: string;
		status?: string;
		error_code?: string;
		text?: string;
	};

	if (!verifyResponse.ok) {
		const reason = verifyData.text ?? verifyData.error_code ?? verifyData.status ?? "OTP verification failed";
		throw new Error(`Perplexity OTP verification failed: ${reason}`);
	}

	if (!verifyData.token) {
		throw new Error("Perplexity OTP verification response missing token");
	}

	return jwtToCredentials(verifyData.token, trimmedEmail);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Login to Perplexity.
 *
 * Tries auto-extraction from the desktop app, then runs HTTP email OTP login.
 *
 * No browser/manual token paste fallback is used.
 */
export async function loginPerplexity(ctrl: OAuthController): Promise<OAuthCredentials> {
	if (!ctrl.onPrompt) {
		throw new Error("Perplexity login requires onPrompt callback");
	}

	// Path 1: Native macOS app JWT (skip if PI_AUTH_NO_BORROW=1)
	if (!$env.PI_AUTH_NO_BORROW) {
		ctrl.onProgress?.("Checking for Perplexity desktop app...");
		const nativeJwt = await extractFromNativeApp();
		if (nativeJwt) {
			ctrl.onProgress?.("Found Perplexity JWT from native app");
			return jwtToCredentials(nativeJwt);
		}
	}

	// Path 2: HTTP email OTP
	return httpEmailLogin(ctrl);
}

/**
 * Refresh a Perplexity JWT via Socket.IO `refreshJWT` RPC.
 *
 * Connects an authenticated socket using the current JWT, then requests a fresh one.
 * Falls back to returning the existing token if refresh fails (e.g., server unreachable).
 */
export async function refreshPerplexityToken(currentJwt: string): Promise<OAuthCredentials> {
	const socket = new PerplexitySocket({ jwt: currentJwt });
	try {
		await socket.ready();

		const response = await socket.emitWithAck<Record<string, unknown>>("refreshJWT", { jwt: currentJwt });

		// Response field is `perplexity_jwt` or `jwt`
		const newJwt =
			typeof response?.perplexity_jwt === "string"
				? response.perplexity_jwt
				: typeof response?.jwt === "string"
					? response.jwt
					: undefined;

		if (!newJwt) {
			throw new Error("No JWT in refreshJWT response");
		}

		return jwtToCredentials(newJwt);
	} finally {
		socket.close();
	}
}
