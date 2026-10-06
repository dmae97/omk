import { createRequire } from "node:module";

/** Type-only catalog shape; does not evaluate models.generated at runtime. */
export type ModelsCatalog = typeof import("./models.generated.ts").MODELS;

const requireCatalog = createRequire(import.meta.url);

/**
 * Node/Bun loader: synchronously require models.generated on first use so a
 * default startup path never evaluates the large catalog.
 * Specifiers stay relative so Node resolves the sibling file in src (.ts) and dist (.js).
 *
 * Browser bundles swap this module for models-catalog.browser.ts via the
 * package.json "browser" field (node:module cannot be bundled for browsers).
 */
export function loadModelsCatalog(): ModelsCatalog {
	// Bun (including `bun build --compile` binaries): createRequire(import.meta.url)
	// cannot reach sibling files inside $bunfs, but a literal require() lets Bun's
	// bundler embed models.generated as a lazily initialised module.
	if (typeof process !== "undefined" && process.versions?.bun) {
		return (require("./models.generated.js") as { MODELS: ModelsCatalog }).MODELS;
	}
	try {
		return (requireCatalog("./models.generated.ts") as { MODELS: ModelsCatalog }).MODELS;
	} catch {
		return (requireCatalog("./models.generated.js") as { MODELS: ModelsCatalog }).MODELS;
	}
}
