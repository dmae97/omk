/**
 * Apply the `devin-harness` domain loadout when the active provider is Devin.
 * Does not require `OMK_DOMAIN_ROUTING=1`. Convenience wrapper over
 * `tryProviderHarnessDispatch()` bound to the real loadout runtime.
 */

import { DEVIN_HARNESS_SPEC } from "./devin-harness.ts";
import { LOADOUT_HARNESS_RUNTIME } from "./domain-dispatch.ts";
import type { LoadoutRuntimeSession, LoadoutRuntimeState } from "./loadout-runtime.ts";
import {
	type ProviderHarnessDispatchInput,
	type ProviderHarnessDispatchResult,
	tryProviderHarnessDispatch,
} from "./provider-harness-dispatch.ts";
import type { ResourceLoader } from "./resource-loader.ts";

export type DevinHarnessDispatchInput = ProviderHarnessDispatchInput<LoadoutRuntimeSession, ResourceLoader>;
export type DevinHarnessDispatchResult = ProviderHarnessDispatchResult<LoadoutRuntimeState>;

export function tryDevinHarnessDispatch(input: DevinHarnessDispatchInput): DevinHarnessDispatchResult {
	return tryProviderHarnessDispatch(DEVIN_HARNESS_SPEC, LOADOUT_HARNESS_RUNTIME, input);
}
