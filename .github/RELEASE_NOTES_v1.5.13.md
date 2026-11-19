# OMK v1.5.13

OMK 1.5.13 is a patch release from `main`. It fixes turns that ended in the
middle of work when several sessions shared one account and one `auth.json`: a
logged-in session sending the wrong key, sessions waiting on each other's
credential lock, and rate limits that used up the retry budget in seconds.
Rust-core and v2 development are not included.

No external pull request was merged in this cycle.

## Stored OAuth logins

- A logged-in session no longer sends the `models.json` provider key when its
  stored OAuth login cannot be resolved. With `anthropic.apiKey:
  "$ANTHROPIC_API_KEY"` in `models.json` and a dead key in the environment, a
  request that could not take the credential lock used to go out with that key
  and end the turn with `401 invalid x-api-key`. A stored token that has not
  expired is now used as it is, and a login that cannot be resolved is reported
  as an authentication failure naming `/login <provider>`; no other key is sent
  in its place (#407).
- A request whose stored login could not be resolved at that moment (the token
  endpoint was unreachable, or another session held the credential store) is
  retried within the normal `retry.maxRetries` budget instead of ending the turn.
  When the token endpoint refuses the refresh (HTTP 400 or 401, `invalid_grant`,
  `invalid_client`), the turn ends at once with the `/login <provider>` message,
  because the refresh token is dead (#415).

## Credential store locking

- Sessions sharing `auth.json` no longer wait on each other's token refresh. The
  refresh request runs under a per-provider refresh lock
  (`auth.json.refresh-<provider>.lock`) instead of the store lock, so two
  sessions still refresh an expired token once, while other providers are not
  delayed (#408).
- The store lock is held only to read and to write, and is taken and released
  within one event-loop turn. A session that blocked its event loop right after
  resolving its key used to keep the lock for as long as that work ran (#408).
- The write-back after a refresh re-reads the store. It finds the account by the
  refresh token that was spent, keeps the stored account selection, and leaves an
  account alone when a newer login replaced it during the refresh (#408).
- The Kimi token refresh request aborts after 30 seconds, like the other
  providers'. It had no timeout (#408).
- The usage rail no longer sends a token request every minute for a login that
  cannot refresh. Usage polling waits one minute before trying the same refresh
  token again, doubling with each consecutive failure up to thirty minutes. A
  request you are waiting on always tries, and a new login or another account is
  tried at once. Each session remembers this for itself, so every session still
  tries a dead login once (#409).

## Rate limits

- A 429 or `rate_limit_error` that is not quota exhaustion and carries no
  `Retry-After` hint waits 8 times the configured backoff per attempt, capped at
  60 seconds, minus up to 25% jitter. With `retry.baseDelayMs: 2000` and
  `retry.maxRetries: 3` the retries span 81 to 108 seconds instead of 14. A
  `Retry-After` hint, a retry on a route OMK just switched to and
  `retry.baseDelayMs: 0` behave as before (#415).
- Compaction and branch-summary calls wait out a rate limit the same way and
  honor a `Retry-After` hint in the error text (#415).

See
[rate limits and credential retries](../packages/coding-agent/docs/provider-resilience.md#rate-limits-and-credential-retries).

## SDK

- `AuthStorageBackend.withRefreshLock(key, fn)` is a new optional backend
  method. `FileAuthStorageBackend` and `InMemoryAuthStorageBackend` implement it;
  a custom backend without it runs token refreshes unserialized (#408).
- `AuthStorage.getApiKey(provider, { background: true })` and
  `ModelRegistry.getApiKeyForProvider(provider, { background: true })` mark a
  caller nobody is waiting on. Such a call skips an OAuth refresh that failed
  recently (#409).
- `omk-ai`: `RetryPolicy.delayMs(backoffMs, errorMessage)` lets a caller of
  `retryAssistantCall` replace the backoff of one retry, and the
  `Failed to refresh OAuth token for <provider>` error carries the provider's
  refresh error as its `cause` (#415).

## Verification scope

The credential changes are covered by offline tests against real files and real
lock directories, and were run against a local build with a stand-in token
endpoint. They were not exercised against a live provider end to end, or on
macOS or Windows. The lock contention was measured on one machine with about
five concurrent sessions; the wait of more than 40 seconds behind the old store
lock was inferred from session logs and not reproduced.

All seven public workspace packages are released at 1.5.13. No dependency
changed.
