/**
 * Internal URL router for resolving agent:// and skill:// URLs.
 */

import type { InternalResource, InternalUrl, ProtocolHandler } from "./types";

/**
 * Router for internal URL schemes.
 *
 * Dispatches URLs like `agent://output_id` or `skill://skill-name` to
 * registered protocol handlers.
 */
export class InternalUrlRouter {
	private handlers = new Map<string, ProtocolHandler>();

	/**
	 * Register a protocol handler.
	 * @param handler Handler to register (uses handler.scheme as key)
	 */
	register(handler: ProtocolHandler): void {
		this.handlers.set(handler.scheme, handler);
	}

	/**
	 * Check if the router can handle a URL.
	 * @param input URL string to check
	 */
	canHandle(input: string): boolean {
		const match = input.match(/^([a-z][a-z0-9+.-]*):\/\//i);
		if (!match) return false;
		const scheme = match[1].toLowerCase();
		return this.handlers.has(scheme);
	}

	/**
	 * Resolve an internal URL to its content.
	 * @param input URL string (e.g., "agent://reviewer_0", "skill://notion-pages")
	 * @throws Error if scheme is not registered or resolution fails
	 */
	async resolve(input: string): Promise<InternalResource> {
		let parsed: URL;
		try {
			parsed = new URL(input);
		} catch {
			throw new Error(`Invalid URL: ${input}`);
		}

		const hostMatch = input.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i);
		let rawHost = hostMatch ? hostMatch[2] : parsed.hostname;
		try {
			rawHost = decodeURIComponent(rawHost);
		} catch {
			// Leave rawHost as-is if decoding fails.
		}
		(parsed as InternalUrl).rawHost = rawHost;

		const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
		const handler = this.handlers.get(scheme);

		if (!handler) {
			const available = Array.from(this.handlers.keys())
				.map((s) => `${s}://`)
				.join(", ");
			throw new Error(`Unknown protocol: ${scheme}://\nSupported: ${available || "none"}`);
		}

		return handler.resolve(parsed as InternalUrl);
	}
}
