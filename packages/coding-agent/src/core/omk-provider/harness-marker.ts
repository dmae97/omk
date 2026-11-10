import { isOmkProviderEnabled } from "./flag.ts";
import { OMK_MODEL_TABLE, OMK_PROVIDER_ID } from "./models.ts";

/**
 * True for OMK models whose table entry carries a harness marker. This is per-model data, not a name pattern, and it
 * is false while the flag is off, so flag-off results stay identical to main.
 */
export function isOmkHarnessModel(
	model: { readonly provider: string; readonly id: string },
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (model.provider !== OMK_PROVIDER_ID || !isOmkProviderEnabled(env)) return false;
	return OMK_MODEL_TABLE.some((entry) => entry.id === model.id && entry.harness !== undefined);
}
