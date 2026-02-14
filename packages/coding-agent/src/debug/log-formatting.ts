import { sanitizeText } from "@oh-my-pi/pi-utils";
import { replaceTabs, truncateToWidth } from "../tools/render-utils";

export function formatDebugLogLine(line: string, maxWidth: number): string {
	const sanitized = sanitizeText(line);
	const normalized = replaceTabs(sanitized);
	const width = Math.max(1, maxWidth);
	return truncateToWidth(normalized, width);
}

export function formatDebugLogExpandedLines(line: string, maxWidth: number): string[] {
	const sanitized = sanitizeText(line);
	const normalized = replaceTabs(sanitized);
	const width = Math.max(1, maxWidth);

	if (normalized.length === 0) {
		return [""];
	}

	return normalized
		.split("\n")
		.flatMap(segment => Bun.wrapAnsi(segment, width, { hard: true, trim: false, wordWrap: true }).split("\n"));
}

export function parseDebugLogTimestampMs(line: string): number | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		if (!parsed || typeof parsed !== "object") {
			return undefined;
		}

		const timestamp = (parsed as { timestamp?: unknown }).timestamp;
		if (typeof timestamp !== "string") {
			return undefined;
		}

		const timestampMs = Date.parse(timestamp);
		return Number.isFinite(timestampMs) ? timestampMs : undefined;
	} catch {
		return undefined;
	}
}
