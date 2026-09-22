import type { ResourceClaimInput } from "../../coordination/resource.ts";
import type { GrantToken } from "../../coordination/types.ts";
import type { AuthorityStore } from "./authority-store.ts";
import { VerifiedRunError } from "./storage.ts";

export function assertPublishEffectStart(
	store: AuthorityStore,
	token: GrantToken,
	claims: readonly ResourceClaimInput[],
	_pending: boolean,
	now?: number,
): void {
	// A lookup result cannot substitute for a fresh durable start transition.
	if (!store.effectStarted(token, claims, undefined, now)) throw new VerifiedRunError("authority");
}
