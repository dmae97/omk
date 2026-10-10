import { ensureTool, type ManagedTool } from "./tools-manager.ts";

const inFlight = new Map<ManagedTool, Promise<string | undefined>>();

/**
 * ensureTool() with at most one fetch per tool at a time. Concurrent downloads of one tool write the
 * same archive path, and since interactive startup fetches fd/rg in the background, the first grep or
 * find of a session can overlap that download. Callers share the pending result instead.
 */
export function ensureToolOnce(tool: ManagedTool, silent = false): Promise<string | undefined> {
	let pending = inFlight.get(tool);
	if (!pending) {
		pending = ensureTool(tool, silent).finally(() => inFlight.delete(tool));
		inFlight.set(tool, pending);
	}
	return pending;
}
