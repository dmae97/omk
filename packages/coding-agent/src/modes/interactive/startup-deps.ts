import { loadSyntaxHighlighter } from "../../utils/syntax-highlight.ts";
import { ensureTool } from "../../utils/tools-manager.ts";

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
