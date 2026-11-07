import type { Extension, ExtensionAPI, ExtensionFactory } from "./types.ts";

/** A failed factory never enters the loader's successful-extension disposal list. */
export async function initializeExtension(
	factory: ExtensionFactory,
	api: ExtensionAPI,
	extension: Extension,
): Promise<void> {
	try {
		await factory(api);
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		for (const unsubscribe of extension.eventBusSubscriptions?.splice(0) ?? []) {
			try {
				unsubscribe();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		if (cleanupErrors.length > 0) {
			throw new AggregateError([error, ...cleanupErrors], "Extension factory and subscription cleanup failed", {
				cause: error,
			});
		}
		throw error;
	}
}
