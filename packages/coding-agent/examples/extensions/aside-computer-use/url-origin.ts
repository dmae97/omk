/**
 * URL origin resolution + glob-pattern matching for allowed-origin policy.
 *
 * Used to decide whether a browser action targets an origin the user has
 * authorized. Matching is scheme-aware where patterns include a scheme, while
 * legacy host-only patterns remain supported for existing policies.
 *
 * Pure module — no I/O, fully deterministic.
 */

type WebScheme = "http" | "https";

interface ParsedOrigin {
	readonly scheme?: WebScheme;
	readonly host: string;
	readonly port?: string;
}

/** Extract a schemeful `https://host[:port]` origin from an absolute or base-relative URL. */
export function resolveOrigin(url: string, baseUrl?: string): string | undefined {
	const trimmed = url.trim();
	if (!trimmed) return undefined;
	try {
		const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
		return parsed.origin.toLowerCase();
	} catch {
		return undefined;
	}
}

function normalizePort(scheme: WebScheme | undefined, port: string | undefined): string | undefined {
	if (!port) return undefined;
	if (port === "*") return port;
	if (scheme === "http" && port === "80") return undefined;
	if (scheme === "https" && port === "443") return undefined;
	return port;
}

function stripPathQueryHash(value: string): string {
	const cutPoints = [value.indexOf("/"), value.indexOf("?"), value.indexOf("#")].filter((index) => index >= 0);
	if (cutPoints.length === 0) return value;
	return value.slice(0, Math.min(...cutPoints));
}

function parseOriginLike(value: string): ParsedOrigin | undefined {
	let trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);

	let scheme: WebScheme | undefined;
	let rest = trimmed;
	const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed);
	if (schemeMatch) {
		const rawScheme = schemeMatch[1]?.toLowerCase();
		if (rawScheme !== "http" && rawScheme !== "https") return undefined;
		scheme = rawScheme;
		rest = schemeMatch[2] ?? "";
	}

	rest = stripPathQueryHash(rest);
	const at = rest.lastIndexOf("@");
	if (at !== -1) rest = rest.slice(at + 1);
	rest = rest.toLowerCase();
	if (!rest) return undefined;

	let host = rest;
	let port: string | undefined;
	if (rest.startsWith("[")) {
		const bracket = rest.indexOf("]");
		if (bracket === -1) return undefined;
		host = rest.slice(0, bracket + 1);
		const after = rest.slice(bracket + 1);
		if (after.startsWith(":")) port = after.slice(1);
	} else {
		const colon = rest.lastIndexOf(":");
		if (colon !== -1 && rest.indexOf(":") === colon) {
			host = rest.slice(0, colon);
			port = rest.slice(colon + 1);
		}
	}
	if (!host) return undefined;
	if (port !== undefined && port !== "*" && !/^\d+$/.test(port)) return undefined;
	return { scheme, host, port: normalizePort(scheme, port) };
}

function schemesMatch(target: ParsedOrigin, pattern: ParsedOrigin): boolean {
	if (!pattern.scheme) return true;
	if (!target.scheme) return true; // legacy unschemeful target compatibility
	return target.scheme === pattern.scheme;
}

function hostsMatch(targetHost: string, patternHost: string): boolean {
	if (patternHost.startsWith("*.")) {
		const suffix = patternHost.slice(2);
		return targetHost !== suffix && targetHost.endsWith(`.${suffix}`);
	}
	return targetHost === patternHost;
}

function portsMatch(target: ParsedOrigin, pattern: ParsedOrigin): boolean {
	if (pattern.port === "*") return true;
	return target.port === pattern.port;
}

/**
 * Match a resolved origin against an allowed-origin pattern list.
 *
 * Patterns support a leading wildcard segment only (`*.example.com` matches
 * `www.example.com` but NOT `example.com`) and a port wildcard
 * (`localhost:*`). Schemeful patterns require the same scheme for schemeful
 * targets; host-only patterns match either http or https for compatibility.
 *
 * @example
 * originMatches("https://www.example.com", ["https://*.example.com"]) // true
 * originMatches("https://example.com", ["https://*.example.com"])     // false
 * originMatches("http://localhost:3000", ["http://localhost:*"])      // true
 */
export function originMatches(origin: string | undefined, patterns: readonly string[]): boolean {
	if (!origin) return false;
	const target = parseOriginLike(origin);
	if (!target) return false;
	for (const rawPattern of patterns) {
		const pattern = parseOriginLike(rawPattern);
		if (!pattern) continue;
		if (!schemesMatch(target, pattern)) continue;
		if (!hostsMatch(target.host, pattern.host)) continue;
		if (!portsMatch(target, pattern)) continue;
		return true;
	}
	return false;
}
