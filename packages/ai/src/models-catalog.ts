import { createRequire } from "node:module";

/** Type-only catalog shape; does not evaluate models.generated at runtime. */
export type ModelsCatalog = typeof import("./models.generated.ts").MODELS;

const requireCatalog = createRequire(import.meta.url);

/**
 * Node/Bun loader: synchronously require models.generated on first use so a
 * default startup path never evaluates the large catalog.
 * Specifiers stay relative so Bun compile and Node both resolve the sibling file.
 *
 * Browser bundles swap this module for models-catalog.browser.ts via the
 * package.json "browser" field (node:module cannot be bundled for browsers).
 */
export function loadModelsCatalog(): ModelsCatalog {
	try {
		return (requireCatalog("./models.generated.ts") as { MODELS: ModelsCatalog }).MODELS;
	} catch {
		return (requireCatalog("./models.generated.js") as { MODELS: ModelsCatalog }).MODELS;
	}
}
