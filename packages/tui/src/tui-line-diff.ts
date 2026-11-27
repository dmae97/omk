const PRESENTATION_CODES = /\x1b\[[0-9;:]*m|\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Scrollback cannot be restyled in place. Do not replay unchanged text for color/zone changes. */
export function findChangedLines(previous: readonly string[], next: readonly string[], viewportTop: number) {
	let firstChanged = -1;
	let lastChanged = -1;
	for (let i = 0; i < Math.max(previous.length, next.length); i++) {
		const oldLine = previous[i] ?? "";
		const newLine = next[i] ?? "";
		if (oldLine === newLine) continue;
		if (i < viewportTop && oldLine.replace(PRESENTATION_CODES, "") === newLine.replace(PRESENTATION_CODES, ""))
			continue;
		if (firstChanged === -1) firstChanged = i;
		lastChanged = i;
	}
	return { firstChanged, lastChanged };
}

export type ViewportDecorator = (viewportLines: readonly string[], width: number, height: number) => string[];

export function applyViewportDecorator(
	lines: string[],
	width: number,
	height: number,
	hook?: { raw: string[]; decorate?: ViewportDecorator },
): string[] {
	const vpStart = Math.max(0, lines.length - height);
	const rawViewport = lines.slice(vpStart, vpStart + height);
	if (hook) hook.raw = rawViewport;
	if (!hook?.decorate) return lines;
	const decorated = hook.decorate(rawViewport, width, height);
	if (decorated === rawViewport) return lines;
	const next = [...lines];
	for (let i = 0; i < decorated.length && vpStart + i < next.length; i++) next[vpStart + i] = decorated[i]!;
	return next;
}
