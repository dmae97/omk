import type { SessionTerminationCause } from "../session-termination.ts";
import { isOmkProviderEnabled } from "./flag.ts";

/**
 * The OMK texts for a missing/rejected token and a missing base URL (messages.ts). Matched by their fixed leading
 * words rather than by status digits: the generic classifier only recognises `401`/`403` next to a transport word
 * and `/login` in the text, so a 403 `model_not_allowed` or a base-URL text would fall through to
 * `provider.protocol` (retryable, "invalid provider response") instead of `provider.auth`.
 */
const OMK_AUTH_FAILURE_TEXT =
	/\bOMK (?:account token missing|token (?:rejected|expired|revoked)|model not allowed for this token|gateway base URL missing)\b/;

/** `provider.auth` for the OMK account texts when `OMK_PROVIDER_OMK=1`; undefined for everything else. */
function omkAuthFailureCause(text: string, env: NodeJS.ProcessEnv): SessionTerminationCause | undefined {
	return isOmkProviderEnabled(env) && OMK_AUTH_FAILURE_TEXT.test(text)
		? { area: "provider", code: "auth" }
		: undefined;
}

/** The OMK `provider.auth` cause when `text` is one of the OMK account texts (flag on), else whatever `generic` says. */
export function omkAuthAwareCause(
	text: string,
	generic: () => SessionTerminationCause,
	env: NodeJS.ProcessEnv = process.env,
): SessionTerminationCause {
	return omkAuthFailureCause(text, env) ?? generic();
}
