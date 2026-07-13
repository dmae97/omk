export const DEFAULT_ALLOWED_ORIGINS = [
	"http://localhost",
	"https://localhost",
	"http://127.0.0.1",
	"https://127.0.0.1",
] as const;

const CRITICAL_ACTION_PATTERN =
	/\b(password|passcode|credential|api[ _-]?key|token|payment|pay|purchase|checkout|card number|delete (?:the )?(?:user )?account|security settings?|permissions?)\b/i;

export type NavigationDecision =
	| { readonly kind: "allow"; readonly origin: string }
	| { readonly kind: "approve"; readonly origin: string }
	| { readonly kind: "deny"; readonly reason: string };

export type ActionDecision = { readonly kind: "approve" } | { readonly kind: "deny"; readonly reason: string };

export function authorizeAction(instruction: string): ActionDecision {
	return CRITICAL_ACTION_PATTERN.test(instruction)
		? { kind: "deny", reason: "Critical browser action denied" }
		: { kind: "approve" };
}

export function authorizeNavigation(url: string, allowedOrigins: readonly string[]): NavigationDecision {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { kind: "deny", reason: "Invalid URL" };
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { kind: "deny", reason: "Only HTTP(S) navigation is allowed" };
	}

	const hostOrigin = `${parsed.protocol}//${parsed.hostname}`;
	return allowedOrigins.includes(hostOrigin)
		? { kind: "allow", origin: parsed.origin }
		: { kind: "approve", origin: parsed.origin };
}
