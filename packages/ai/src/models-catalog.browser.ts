import { MODELS } from "./models.generated.ts";
import type { ModelsCatalog } from "./models-catalog.ts";

/**
 * Browser loader selected through the package.json "browser" field.
 * Browsers have no synchronous require, so the catalog is bundled eagerly;
 * the RSS win from lazy loading only matters for Node/Bun processes.
 */
export function loadModelsCatalog(): ModelsCatalog {
	return MODELS;
}
