/**
 * Custom API provider registry.
 *
 * Allows extensions to register streaming functions for custom API types
 * (e.g., "vertex-claude-api") that are not built into the hardcoded switch
 * in stream.ts.
 *
 * Built-in APIs (anthropic-messages, openai-completions, etc.) are NOT registered
 * here — they use the existing switch in stream.ts. This registry is only for
 * extension-provided custom APIs.
 */
import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "./types";

export type CustomStreamSimpleFn = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

interface RegisteredCustomApi {
	streamSimple: CustomStreamSimpleFn;
	sourceId?: string;
}

const customApiRegistry = new Map<string, RegisteredCustomApi>();

/**
 * Register a custom API streaming function.
 * Called by ModelRegistry.registerProvider() when an extension provides streamSimple.
 */
export function registerCustomApi(api: string, streamSimple: CustomStreamSimpleFn, sourceId?: string): void {
	customApiRegistry.set(api, { streamSimple, sourceId });
}

/**
 * Get a custom API streaming function by API identifier.
 * Returns undefined for built-in APIs (those are handled by the switch in stream.ts).
 */
export function getCustomApi(api: string): CustomStreamSimpleFn | undefined {
	return customApiRegistry.get(api)?.streamSimple;
}

/**
 * Remove all custom APIs registered by a specific source (e.g., an extension path).
 */
export function unregisterCustomApis(sourceId: string): void {
	for (const [api, entry] of customApiRegistry.entries()) {
		if (entry.sourceId === sourceId) {
			customApiRegistry.delete(api);
		}
	}
}

/**
 * Clear all custom API registrations.
 */
export function clearCustomApis(): void {
	customApiRegistry.clear();
}
