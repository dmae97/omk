import { readFileSync, statSync } from "node:fs";
import { getApiProviders } from "omk-ai";
import type { AuthStorage } from "./auth-storage.ts";

const ABSENT = Symbol("models.json absent");
const UNREADABLE = Symbol("models.json unreadable");
const SEPARATOR = Symbol("separator");

interface CachedModelsText {
	path: string;
	mtimeNs: bigint;
	ctimeNs: bigint;
	size: bigint;
	ino: bigint;
	text: string;
}

let cachedModelsFile: CachedModelsText | undefined;

function readModelsJsonCached(modelsJsonPath: string): string | symbol {
	try {
		const st = statSync(modelsJsonPath, { bigint: true });
		const nowNs = BigInt(Date.now()) * 1_000_000n;
		const isRacy = nowNs - st.mtimeNs < 100_000_000n && st.mtimeNs <= nowNs + 100_000_000n;
		if (
			!isRacy &&
			cachedModelsFile &&
			cachedModelsFile.path === modelsJsonPath &&
			cachedModelsFile.mtimeNs === st.mtimeNs &&
			cachedModelsFile.ctimeNs === st.ctimeNs &&
			cachedModelsFile.size === st.size &&
			cachedModelsFile.ino === st.ino
		) {
			return cachedModelsFile.text;
		}
		const text = readFileSync(modelsJsonPath, "utf-8");
		cachedModelsFile = {
			path: modelsJsonPath,
			mtimeNs: st.mtimeNs,
			ctimeNs: st.ctimeNs,
			size: st.size,
			ino: st.ino,
			text,
		};
		return text;
	} catch (error) {
		cachedModelsFile = undefined;
		return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? ABSENT : UNREADABLE;
	}
}

/**
 * Spec 063: everything `ModelRegistry.refresh()` reads, as `===`-comparable values: the exact models.json text,
 * the registered API provider objects, the OAuth providers' own fields, and each model-modifying OAuth provider's selected credentials
 * (identity and own fields). Values stay in memory and are never logged.
 */
function refreshInputs(modelsJsonPath: string | undefined, authStorage: AuthStorage): unknown[] {
	const inputs: unknown[] = [modelsJsonPath ?? ABSENT];
	if (modelsJsonPath) {
		inputs.push(readModelsJsonCached(modelsJsonPath));
	}
	inputs.push(SEPARATOR, ...getApiProviders(), SEPARATOR);
	for (const provider of authStorage.getOAuthProviders()) {
		// Registered OAuth providers are re-created as `{ ...config.oauth, id }` on every refresh: compare fields.
		for (const [key, value] of Object.entries(provider)) inputs.push(key, value);
		if (!provider.modifyModels) continue;
		const credentials = authStorage.getOAuthCredentials(provider.id);
		inputs.push(credentials === undefined);
		// Account views may be rebuilt per call: compare the selected account's fields, not its identity.
		if (credentials) for (const [key, value] of Object.entries(credentials)) inputs.push(key, value);
		// Registered providers' modifyModels gets the raw stored credential (model-registry.ts applyProviderConfig).
		const stored = authStorage.get(provider.id);
		inputs.push(SEPARATOR);
		if (stored?.type === "oauth") for (const [key, value] of Object.entries(stored)) inputs.push(key, value);
		inputs.push(SEPARATOR);
	}
	return inputs;
}

function same(left: readonly unknown[], right: readonly unknown[]): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
	return true;
}

/** Runs `refresh` only when its inputs differ from the ones seen after the last run through here. */
export class ModelRegistryRefreshInputs {
	private last: readonly unknown[] | undefined;

	/** Registry state changed without passing through `run` (registerProvider): the next `run` must refresh. */
	invalidate(): void {
		this.last = undefined;
	}

	run(modelsJsonPath: string | undefined, authStorage: AuthStorage, refresh: () => void): boolean {
		if (this.last && same(this.last, refreshInputs(modelsJsonPath, authStorage))) return false;
		refresh();
		this.last = refreshInputs(modelsJsonPath, authStorage);
		return true;
	}
}
