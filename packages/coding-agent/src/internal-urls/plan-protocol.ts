/**
 * Protocol handler for plan:// URLs.
 *
 * Resolves plan references to plan files under the plans directory.
 *
 * URL forms:
 * - plan://<sessionId> (defaults to plan.md)
 * - plan://<sessionId>/plan.md
 * - plan://<plan-id>.md (resolves directly under plans dir)
 */
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import type { InternalResource, InternalUrl, ProtocolHandler } from "./types";

export interface PlanProtocolOptions {
	getPlansDirectory: (cwd?: string) => string;
	cwd: string;
}

function parsePlanUrl(input: string): InternalUrl {
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
	return parsed as InternalUrl;
}

function normalizeRelativePath(host: string, pathname: string): string {
	const trimmedHost = host.replace(/^\/+/, "").replace(/\/+$/, "");
	const trimmedPath = pathname.replace(/^\/+/, "");

	if (!trimmedHost) {
		throw new Error("plan:// URL requires a session or plan identifier");
	}

	if (trimmedPath) {
		return path.join(trimmedHost, trimmedPath);
	}

	if (trimmedHost.endsWith(".md")) {
		return trimmedHost;
	}

	return path.join(trimmedHost, "plan.md");
}

export function resolvePlanUrlToPath(input: string | InternalUrl, options: PlanProtocolOptions): string {
	const url = typeof input === "string" ? parsePlanUrl(input) : input;
	const host = url.rawHost || url.hostname;
	const relativePath = normalizeRelativePath(host, url.pathname ?? "");
	const plansDir = path.resolve(options.getPlansDirectory(options.cwd));
	const resolved = path.resolve(plansDir, relativePath);

	if (resolved !== plansDir && !resolved.startsWith(`${plansDir}${path.sep}`)) {
		throw new Error("plan:// URL escapes the plans directory");
	}

	return resolved;
}

export class PlanProtocolHandler implements ProtocolHandler {
	readonly scheme = "plan";

	constructor(private readonly options: PlanProtocolOptions) {}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const planPath = resolvePlanUrlToPath(url, this.options);
		try {
			const content = await Bun.file(planPath).text();
			return {
				url: url.href,
				content,
				contentType: "text/markdown",
				size: Buffer.byteLength(content, "utf-8"),
				sourcePath: planPath,
			};
		} catch (error) {
			if (isEnoent(error)) {
				throw new Error(`Plan file not found: ${url.href}`);
			}
			throw error;
		}
	}
}
