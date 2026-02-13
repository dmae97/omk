import { sanitizeText } from "@oh-my-pi/pi-utils";
import { replaceTabs, truncateToWidth } from "../tools/render-utils";

export function formatDebugLogLine(line: string, maxWidth: number): string {
	const sanitized = sanitizeText(line);
	const normalized = replaceTabs(sanitized);
	const width = Math.max(1, maxWidth);
	return truncateToWidth(normalized, width);
}
