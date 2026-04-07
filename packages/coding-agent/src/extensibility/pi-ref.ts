/**
 * Lazy reference to the package barrel.
 *
 * Extension/hook/custom-tool/custom-command loaders expose the full
 * `@oh-my-pi/pi-coding-agent` namespace to user code. A static
 * `import * as piCodingAgent from "@oh-my-pi/pi-coding-agent"` from any of
 * those loaders creates a self-referential cycle during module init:
 *
 *   tools/index -> task -> sdk -> <loader> -> package barrel
 *     -> modes/components -> tool-execution -> renderers -> tools/read
 *
 * Combined with top-level await transitively pulled in by lru-cache, ESM
 * interleaves the cyclic branches and leaves `readToolRenderer` in its
 * temporal dead zone when `renderers.ts` reaches the `read` entry.
 *
 * This module breaks the cycle by deferring the barrel import.
 * `initPiRef()` must be awaited once, after the package has finished its
 * own initialization, before any loader reads the reference via
 * `getPiRef()`. `createAgentSession` (and `discoverCustomTSCommands`) are
 * responsible for this single call; both run entirely after module eval.
 */
import type * as PiCodingAgentNs from "@oh-my-pi/pi-coding-agent";

type PiCodingAgent = typeof PiCodingAgentNs;

let cached: PiCodingAgent | undefined;

/**
 * Resolve the package barrel once. Safe to call from any async entry point
 * that runs after all modules have finished evaluating.
 */
export async function initPiRef(): Promise<void> {
	if (cached) return;
	cached = (await import("@oh-my-pi/pi-coding-agent")) as PiCodingAgent;
}

/**
 * Return the cached package barrel. `initPiRef()` must have resolved
 * before this is called; loaders that run inside `createAgentSession`
 * or `discoverCustomTSCommands` satisfy that requirement automatically.
 */
export function getPiRef(): PiCodingAgent {
	if (!cached) {
		throw new Error("pi-ref not initialized; await initPiRef() before instantiating loaders that expose `pi`.");
	}
	return cached;
}
