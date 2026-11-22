import type { SourceInfo } from "../../core/source-info.ts";
import { parseGitUrl } from "../../utils/git.ts";

/** Keep decorative imported harness markers out of OMK display; source metadata stays unchanged. */
export function formatResourceDescription(description: string | undefined, sourceTag?: string): string | undefined {
	let text = description;
	if (description) {
		const marker = /^\[(OMX|OMO)\]\s*/.exec(description);
		if (marker) {
			const body = description.slice(marker[0].length);
			text = body || "OMK resource";
		}
	}
	if (!sourceTag) return text;
	return text ? `[${sourceTag}] ${text}` : `[${sourceTag}]`;
}

export function getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
	if (!sourceInfo) {
		return undefined;
	}

	const scopePrefix = sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
	const source = sourceInfo.source.trim();

	if (source === "auto" || source === "local" || source === "cli") {
		return scopePrefix;
	}

	if (source.startsWith("npm:")) {
		return `${scopePrefix}:${source}`;
	}

	const gitSource = parseGitUrl(source);
	if (gitSource) {
		const ref = gitSource.ref ? `@${gitSource.ref}` : "";
		return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
	}

	return scopePrefix;
}
