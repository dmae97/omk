/**
 * Protocol handler for artifact:// URLs.
 *
 * Resolves artifact IDs to files in the session artifacts directory.
 * Unlike agent://, artifacts are raw text with no JSON extraction.
 *
 * URL form:
 * - artifact://<id> - Full artifact content
 *
 * Pagination is handled by the read tool via offset/limit parameters.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { InternalResource, InternalUrl, ProtocolHandler } from "./types";

export interface ArtifactProtocolOptions {
	/**
	 * Returns the artifacts directory path, or null if no session.
	 */
	getArtifactsDir: () => string | null;
}

/**
 * List available artifact IDs in the directory.
 */
function listAvailableArtifacts(artifactsDir: string): string[] {
	try {
		const files = fs.readdirSync(artifactsDir);
		return files
			.filter((f) => /^\d+\./.test(f))
			.map((f) => f.split(".")[0])
			.sort((a, b) => Number(a) - Number(b));
	} catch {
		return [];
	}
}

/**
 * Handler for artifact:// URLs.
 *
 * Resolves numeric artifact IDs to their text content.
 * Artifacts are created by tools when output is truncated.
 */
export class ArtifactProtocolHandler implements ProtocolHandler {
	readonly scheme = "artifact";

	constructor(private readonly options: ArtifactProtocolOptions) {}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const artifactsDir = this.options.getArtifactsDir();
		if (!artifactsDir) {
			throw new Error("No session - artifacts unavailable");
		}

		// Extract artifact ID from host
		const id = url.rawHost || url.hostname;
		if (!id) {
			throw new Error("artifact:// URL requires a numeric ID: artifact://0");
		}

		// Validate ID is numeric
		if (!/^\d+$/.test(id)) {
			throw new Error(`artifact:// ID must be numeric, got: ${id}`);
		}

		// Check directory exists
		if (!fs.existsSync(artifactsDir)) {
			throw new Error("No artifacts directory found");
		}

		// Find file matching ID prefix
		const files = fs.readdirSync(artifactsDir);
		const match = files.find((f) => f.startsWith(`${id}.`));

		if (!match) {
			const available = listAvailableArtifacts(artifactsDir);
			const availableStr = available.length > 0 ? available.join(", ") : "none";
			throw new Error(`Artifact ${id} not found. Available: ${availableStr}`);
		}

		const filePath = path.join(artifactsDir, match);
		const content = await Bun.file(filePath).text();

		return {
			url: url.href,
			content,
			contentType: "text/plain",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: filePath,
		};
	}
}
