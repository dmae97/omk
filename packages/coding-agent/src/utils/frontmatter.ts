import { logger } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";

function stripHtmlComments(content: string): string {
	return content.replace(/<!--[\s\S]*?-->/g, "");
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(`YAML: ${value}`));
}

function truncate(content: string, maxLength: number): string {
	return content.length > maxLength ? `${content.slice(0, maxLength)}...` : content;
}

export class FrontmatterError extends Error {
	constructor(
		error: Error,
		public readonly source?: unknown,
	) {
		super(`Failed to parse YAML frontmatter: ${error.message}`, { cause: error });
		this.name = "FrontmatterError";
	}

	toString(): string {
		// Format the error with stack and detail, including the error message, stack, and source if present
		const details: string[] = [this.message];
		if (this.source !== undefined) {
			details.push(`Source: ${JSON.stringify(this.source)}`);
		}
		if (this.cause && typeof this.cause === "object" && "stack" in this.cause && this.cause.stack) {
			details.push(`Stack:\n${this.cause.stack}`);
		} else if (this.stack) {
			details.push(`Stack:\n${this.stack}`);
		}
		return details.join("\n\n");
	}
}

export interface FrontmatterOptions {
	/** Source of the content */
	source?: unknown;
	/** Fallback frontmatter values */
	fallback?: Record<string, unknown>;
	/** Normalize the content */
	normalize?: boolean;
	/** Level of error handling */
	level?: "off" | "warn" | "fatal";
}

/**
 * Parse YAML frontmatter from markdown content
 * Returns { frontmatter, body } where body has frontmatter stripped
 */
export function parseFrontmatter(
	content: string,
	options?: FrontmatterOptions,
): { frontmatter: Record<string, unknown>; body: string } {
	const { source, fallback, normalize = true, level = "warn" } = options ?? {};
	const frontmatter: Record<string, unknown> = Object.assign({}, fallback);

	const normalized = normalize ? stripHtmlComments(content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")) : content;
	if (!normalized.startsWith("---")) {
		return { frontmatter, body: normalized };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, body: normalized };
	}

	const metadata = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();

	try {
		// Replace tabs with spaces for YAML compatibility, use failsafe mode for robustness
		const loaded = YAML.parse(metadata.replaceAll("\t", "  ")) as Record<string, unknown> | null;
		return { frontmatter: Object.assign(frontmatter, loaded), body: body };
	} catch (error) {
		const err = new FrontmatterError(toError(error), source ?? `Inline '${truncate(content, 64)}'`);
		if (level === "warn" || level === "fatal") {
			logger.warn("Failed to parse YAML frontmatter", { err: err.toString() });
		}
		if (level === "fatal") {
			throw err;
		}

		// Simple YAML parsing - just key: value pairs
		for (const line of metadata.split("\n")) {
			const match = line.match(/^(\w+):\s*(.*)$/);
			if (match) {
				frontmatter[match[1]] = match[2].trim();
			}
		}

		return { frontmatter, body: body };
	}
}
