import type { ResourceClaimInput } from "../../coordination/resource.ts";
import type { GrantToken } from "../../coordination/types.ts";
import type { AuthorityStore } from "./authority-store.ts";
import { VerifiedRunError } from "./storage.ts";

export function assertPublishEffectStart(
	store: AuthorityStore,
	token: GrantToken,
	claims: readonly ResourceClaimInput[],
	pending: boolean,
	now: number,
): void {
	const stored = store.state.grants.get(token.grantSequence);
	if (stored?.state === "reserved" && !store.effectStarted(token, claims, undefined, now))
		throw new VerifiedRunError("authority");
	if (!stored && !pending && !store.effectStarted(token, claims, undefined, now))
		throw new VerifiedRunError("authority");
}
