import { loadSyntaxHighlighter, onSyntaxHighlighterReady } from "../../utils/syntax-highlight.ts";
import { ensureTool } from "../../utils/tools-manager.ts";
import { onThemeChange } from "./theme/theme.ts";

/**
 * Interactive-only startup dependencies, resolved in parallel before the first render.
 * fd (autocomplete) and rg (grep tool, bash commands) are downloaded if missing and
 * added to PATH via getBinDir. highlight.js is loaded lazily (see
 * utils/syntax-highlight.ts) so headless modes never pay for it; a load failure only
 * leaves code blocks uncolored.
 * @returns Path to fd, if available.
 */
export async function ensureInteractiveStartupDeps(): Promise<string | undefined> {
	const [fdPath] = await Promise.all([
		ensureTool("fd"),
		ensureTool("rg"),
		loadSyntaxHighlighter().catch(() => undefined),
	]);
	return fdPath;
}

/**
 * Register the refresh that drops cached themed output (ui.invalidate() reaches
 * Markdown cachedLines and its stream cache) and re-renders. It runs on every theme
 * change and once more when a highlight.js load lands after code was already
 * rendered plain, e.g. a startup load failure retried by a later highlight() call.
 */
export function onThemedOutputStale(refresh: () => void): void {
	onThemeChange(refresh);
	onSyntaxHighlighterReady(refresh);
}
