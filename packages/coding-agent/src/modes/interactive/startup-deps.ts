import { ensureToolOnce } from "../../utils/ensure-tool-once.ts";
import { loadSyntaxHighlighter, onSyntaxHighlighterReady } from "../../utils/syntax-highlight.ts";
import { getToolPath } from "../../utils/tools-manager.ts";
import { onThemeChange } from "./theme/theme.ts";

/**
 * Interactive-only startup dependencies, resolved without blocking the first render.
 *
 * A locally available fd is reported synchronously, before the caller renders, so
 * autocomplete starts fd-backed exactly as before. A missing fd or rg is fetched
 * silently in the background: the first paint never waits on GitHub, a proxy or a
 * stalled network, and a late fd is handed to `onFdPath` so the caller can rebuild
 * autocomplete. highlight.js warms in the background; a late load re-renders through
 * `onThemedOutputStale`.
 * @returns Settles when every background fetch has finished (for tests and shutdown).
 */
export function scheduleInteractiveStartupDeps(onFdPath: (fdPath: string | undefined) => void): Promise<void> {
	const pending: Promise<unknown>[] = [loadSyntaxHighlighter().catch(() => undefined)];
	const localFd = getToolPath("fd") ?? undefined;
	if (localFd) {
		onFdPath(localFd);
	} else {
		pending.push(ensureToolOnce("fd", true).then(onFdPath));
	}
	if (!getToolPath("rg")) {
		pending.push(ensureToolOnce("rg", true));
	}
	return Promise.allSettled(pending).then(() => undefined);
}

/**
 * Register the refresh that drops cached themed output (ui.invalidate() reaches
 * Markdown cachedLines and its stream cache) and re-renders. It runs on every theme
 * change and once more when a highlight.js load lands after code was already
 * rendered plain, e.g. a startup load failure retried by a later highlight() call.
 * @returns Unsubscribe that clears both registrations (theme only if still ours).
 */
export function onThemedOutputStale(refresh: () => void): () => void {
	const unsubscribeTheme = onThemeChange(refresh);
	const unsubscribeReady = onSyntaxHighlighterReady(refresh);
	return () => {
		unsubscribeTheme();
		unsubscribeReady();
	};
}
