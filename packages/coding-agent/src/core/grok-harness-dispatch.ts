/**
 * Apply the `grok-harness` domain loadout when the active provider is Grok OAuth.
 * Does not require `OMK_DOMAIN_ROUTING=1`. Convenience wrapper over
 * `tryProviderHarnessDispatch()` bound to the real loadout runtime.
 */

import { LOADOUT_HARNESS_RUNTIME } from "./domain-dispatch.ts";
import { GROK_HARNESS_SPEC } from "./grok-harness.ts";
import type { LoadoutRuntimeSession, LoadoutRuntimeState } from "./loadout-runtime.ts";
import {
	type ProviderHarnessDispatchInput,
	type ProviderHarnessDispatchResult,
	tryProviderHarnessDispatch,
} from "./provider-harness-dispatch.ts";
import type { ResourceLoader } from "./resource-loader.ts";

export type GrokHarnessDispatchInput = ProviderHarnessDispatchInput<LoadoutRuntimeSession, ResourceLoader>;
export type GrokHarnessDispatchResult = ProviderHarnessDispatchResult<LoadoutRuntimeState>;

export function tryGrokHarnessDispatch(input: GrokHarnessDispatchInput): GrokHarnessDispatchResult {
	return tryProviderHarnessDispatch(GROK_HARNESS_SPEC, LOADOUT_HARNESS_RUNTIME, input);
}
