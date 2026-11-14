/**
 * Request-key failures that never reached the provider.
 *
 * Sessions share auth.json. A request that finds its stored login expired while another session
 * holds the refresh, or that cannot read the store at all, has no key to send. The provider
 * rejected nothing, and the next attempt reads whatever the other session wrote, so the retry gate
 * treats these as transient. A credential the provider answered 401 for is a different failure and
 * stays permanent, and so does a refresh the token endpoint refused: the refresh token is dead and
 * only a new login replaces it.
 *
 * The messages are built here so the text a user reads and the text the gate matches cannot drift.
 */

export function unresolvedOAuthLoginMessage(provider: string): string {
	return (
		`Authentication failed for "${provider}": the stored OAuth login could not be used` +
		` (token refresh failed, or the credential store was busy). No other key was sent in its place.` +
		` Retry, or run '/login ${provider}' to re-authenticate.`
	);
}

export function rejectedOAuthLoginMessage(provider: string): string {
	return (
		`Authentication failed for "${provider}": the provider refused to refresh the stored OAuth login.` +
		` No other key was sent in its place. Run '/login ${provider}' to re-authenticate.`
	);
}

export function credentialStoreUnreadableMessage(provider: string): string {
	return (
		`The credential store for "${provider}" could not be read` +
		` (another OMK session may be refreshing credentials). Retry in a moment.`
	);
}

const TRANSIENT_CREDENTIAL_FAILURE =
	/the stored OAuth login could not be used|The credential store for "[^"]*" could not be read/;

export function isTransientCredentialFailureMessage(text: string | undefined): boolean {
	return text !== undefined && TRANSIENT_CREDENTIAL_FAILURE.test(text);
}

/**
 * RFC 6749 section 5.2: a token endpoint answers 400 or 401 for a grant or client it will not
 * accept, which no retry of the same refresh token changes. The status is read from the refresh
 * error texts the OAuth providers in omk-ai produce. Anything this does not recognize, a 403 or an
 * unreachable endpoint included, stays retryable: ending a turn early is the costlier mistake.
 */
const REFUSED_GRANT = /invalid_grant|invalid_client|(?:status\s*[=:]\s*|HTTP\s+|refresh failed:?\s*\(?)40[01]\b/i;

/** True when `error`, or a cause up to four levels down, reports a refused refresh. */
export function isOAuthRefreshRejection(error: unknown): boolean {
	let current = error;
	for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
		if (REFUSED_GRANT.test(current.message)) return true;
		current = current.cause;
	}
	return false;
}
