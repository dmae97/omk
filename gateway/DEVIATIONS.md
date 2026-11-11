# Deviations from `specs/omk-gateway/spec.md` (room decisions win; spec file untouched)

| Spec text | Prototype | Why |
|---|---|---|
| `billing_instant: request_end` (section 5) | peak flag by request START (KST) | room decision |
| user-billed cost follows peak/off-peak | user-billed cost ALWAYS at peak; upstream cost uses the flag | room decision (Pricing Analyst) |
| T-09: revoked -> 401 | 403 `token_revoked` | error contract 1A and QA |
| T-02: code `monthly_token_cap` | `quota_exceeded` | error contract 1A |
| aborted stream: `usage_missing`, bill zero (Q6) | `estimated=true`; input estimated from the request body (same chars-per-token rule as the reservation) and priced all as cache miss; output estimated from received text; never the reserved max; reconciliation reports estimated rows separately | PM decisions 2026-11-11 |
| store last 4 chars of the token | hash only; logs show first 8 chars of the hash | QA 4, PM adopted |
| `POST /admin/keys` etc. | CLI scripts only | PM: no admin UI |
| `cost_usd_micros` | `billed_cost_nano_usd`, `upstream_cost_nano_usd` | exact integer math for 0.006 USD/1M style prices |
| single `usage_missing` flag | `estimated` + `end_reason` (`complete`, `client_abort`, `upstream_error`, `upstream_ended_without_usage`) | follows from the estimate decision |
| request_limit_exceeded always `x-omk-retryable: false` | false for ceilings and "can never fit"; omitted (retryable, Retry-After 1) when only other in-flight reservations block | transient case should be retried |
| quota message "Use OMK/coder or wait" | "Wait for the reset or ask the admin to raise the plan" | the cap is shared by both models, so switching model does not help |
| `model_not_allowed` message names the model | generic message | echoing client input would reproduce any brand string the client typed |
| `/v1/models` unauthenticated? (unspecified) | requires a token | consistent with all other `/v1` routes |
| Postgres server | PGlite (embedded Postgres) | no local server or paid service on the box |
| T-13 (real omk client against the gateway) | run against the local mock (`npm run dev:mock` stack), not a real upstream: 9/9 client cases and the usage_events check passed with client 674eded44a (contains #387 head cd25e92907); see `e2e/T-13-results.md`. Re-run 2026-11-11 12:13 KST with client 13753b84ac (#392 merge, token login and gateway errors): 9/9 and usage_events PASS, see `e2e/t13-392/` | no real upstream key on the box; repeat against a real upstream before hosting |

- 2026-11-11: reasoner effort is low/high only for every user (PM decision). `max` always returns 429 `request_limit_exceeded`. The `users.allow_max_effort` column and `issueKey({allowMaxEffort})` option remain but are ignored by validation; remove them in a later cleanup.

- 2026-11-11: `scripts/dev-mock.ts` mock upstream gained deterministic stream / tool-call / tool-follow-up modes (see README). T-13 client e2e against this mock ran on 2026-11-11 06:36 KST and passed (`e2e/T-13-results.md`).
