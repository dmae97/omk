/**
 * Shared helpers for the OMK-provider flags-off goldens (PR c, tests only).
 *
 * The goldens in `fixtures/omk-provider/` were generated from the catalog at ea03fcf76b (v1.5.11). Main has moved only
 * in test files since (7389353a6f), so `git diff ea03fcf76b HEAD -- 'packages/*\/src' packages/ai/scripts` is empty.
 *
 * Regenerate (QA / after a reviewed `npm run models:refresh`), from packages/coding-agent:
 *   UPDATE_OMK_PROVIDER_GOLDENS=1 node ../../node_modules/vitest/dist/cli.js --run test/omk-provider-*.test.ts
 *   git diff --stat test/fixtures/omk-provider   # empty when the catalog is unchanged
 * The variable deliberately does not start with `OMK_`: test/setup-env.ts deletes every OMK_* variable.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";

export const GOLDEN_BASE_SHA = "ea03fcf76b438f12f0cebcd6b255d24d4cb52741";
export const FLAG_ENV = "OMK_PROVIDER_OMK";
/** Every value that must leave behavior byte-identical to main today (unset, 0, false, true, empty, padded 1). */
export const FLAG_OFF_VARIANTS: ReadonlyArray<string | undefined> = [undefined, "0", "false", "true", "", " 1 "];

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "omk-provider");
export const UPDATING = process.env.UPDATE_OMK_PROVIDER_GOLDENS === "1";

export function variantLabel(value: string | undefined): string {
	return value === undefined ? "unset" : JSON.stringify(value);
}

/** JSON with sorted object keys: independent of insertion order. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
			: v,
	);
}

export function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** Run `fn` with the flag env var set (or deleted when `value` is undefined); always restores it. */
export function withFlag<T>(value: string | undefined, fn: () => T): T {
	const previous = process.env[FLAG_ENV];
	if (value === undefined) delete process.env[FLAG_ENV];
	else process.env[FLAG_ENV] = value;
	try {
		return fn();
	} finally {
		if (previous === undefined) delete process.env[FLAG_ENV];
		else process.env[FLAG_ENV] = previous;
	}
}

/** Registry with no credentials and a non-existent models.json: built-in catalog only, no disk writes. */
export function createCatalogRegistry(): ModelRegistry {
	const missingModelsJson = join(tmpdir(), `omk-provider-golden-${process.pid}`, "models.json");
	return ModelRegistry.create(AuthStorage.inMemory(), missingModelsJson);
}

export function readGolden<T>(name: string): T {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

/** In update mode writes the golden and returns it; otherwise returns the committed golden. */
export function goldenOrUpdate<T>(name: string, fresh: T): T {
	if (UPDATING) {
		mkdirSync(FIXTURE_DIR, { recursive: true });
		writeFileSync(join(FIXTURE_DIR, name), `${JSON.stringify(fresh, null, "\t")}\n`);
		return fresh;
	}
	if (!existsSync(join(FIXTURE_DIR, name))) {
		throw new Error(`Missing golden ${name}. Generate it with UPDATE_OMK_PROVIDER_GOLDENS=1 (see header).`);
	}
	return readGolden<T>(name);
}
