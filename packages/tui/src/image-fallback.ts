import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { shortenImagePath } from "./image-path.ts";

export function formatImageFallback(
	mimeType: string,
	dimensions: { widthPx: number; heightPx: number } | undefined,
	filename: string | undefined,
	hyperlinks: boolean,
): string {
	const parts: string[] = [];
	if (filename) {
		const display = shortenImagePath(filename);
		parts.push(
			hyperlinks && isAbsolute(filename)
				? `\x1b]8;;${pathToFileURL(filename).href}\x1b\\${display}\x1b]8;;\x1b\\`
				: display,
		);
	}
	parts.push(`[${mimeType}]`);
	if (dimensions) parts.push(`${dimensions.widthPx}x${dimensions.heightPx}`);
	return `[Image: ${parts.join(" ")}]`;
}
