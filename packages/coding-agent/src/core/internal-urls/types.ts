/**
 * Types for the internal URL routing system.
 *
 * Internal URLs (agent://, skill://) are resolved by tools like fetch and read,
 * providing access to agent outputs and skill files without exposing filesystem paths.
 */

/**
 * Resolved internal resource returned by protocol handlers.
 */
export interface InternalResource {
	/** Canonical URL that was resolved */
	url: string;
	/** Resolved text content */
	content: string;
	/** MIME type: text/markdown, application/json, or text/plain */
	contentType: "text/markdown" | "application/json" | "text/plain";
	/** Content size in bytes */
	size?: number;
	/** Underlying filesystem path (for debugging, not exposed to agent) */
	sourcePath?: string;
	/** Additional notes about resolution */
	notes?: string[];
}

/**
 * Parsed internal URL with preserved host casing.
 */
export interface InternalUrl extends URL {
	/**
	 * Raw host segment extracted from input, preserving case.
	 */
	rawHost: string;
}

/**
 * Handler for a specific internal URL scheme (e.g., agent://, skill://).
 */
export interface ProtocolHandler {
	/** The scheme this handler processes (without trailing ://) */
	readonly scheme: string;
	/**
	 * Resolve an internal URL to its content.
	 * @param url Parsed URL object
	 * @throws Error with user-friendly message if resolution fails
	 */
	resolve(url: InternalUrl): Promise<InternalResource>;
}
