# OMK provider

The `OMK` provider is experimental and off by default. In v1 it is supported on the CLI and in RPC only.

## Enable

The provider is registered only when `OMK_PROVIDER_OMK` is the exact string `1`. Any other value, including unset, `true`, or `yes`, leaves it unregistered. Existing providers are unchanged when the flag is off.

```sh
export OMK_PROVIDER_OMK=1
export OMK_GATEWAY_BASE_URL=https://host/v1
omk --model OMK/coder
```

There is no default gateway URL. With the flag on and no base URL, the two OMK/* models still appear in the model list but no request is sent; selecting one shows the base-URL-missing message.

## Models

Select a model by its qualified id (`OMK/coder` or `OMK/reasoner`). In the CLI the provider id is matched case-insensitively; elsewhere it must be exactly `OMK`. Bare ids such as `coder` do not resolve to these models when other providers are also listed.

| Id | Name | Context window | Max output |
| --- | --- | ---: | ---: |
| `OMK/coder` | OMK Coder | 1,000,000 tokens | 384,000 tokens |
| `OMK/reasoner` | OMK Reasoner | 1,000,000 tokens | 384,000 tokens |

The table lists the context window and max output the client declares. The gateway enforces its own per-request output cap. `OMK/reasoner` has a cap of 32,768 tokens; a request with a larger `max_tokens` gets HTTP 429 `request_limit_exceeded` and `x-omk-retryable: false`, and is not retried. `OMK/coder` has no cap and its default is 8,192. These values come from the gateway config and may change.

`OMK/coder` does not send a reasoning level. `OMK/reasoner` always reasons: `low` and `high` are sent as-is, `medium` is sent as `low`, and unsupported levels (`off`, `minimal`, `xhigh`, `max`) are clamped to a supported level. Internal calls that carry no reasoning level are sent as `coder`.

## Credentials

Provide an account token in either of these ways:

- Run `/login` and choose OMK, then paste the token. It is stored in the usual auth file, with no browser step and no local expiry.
- Set `OMK_ACCOUNT_TOKEN`.

A stored `/login` token takes precedence over `OMK_ACCOUNT_TOKEN`, as it does for other providers.

Set the gateway base URL with `OMK_GATEWAY_BASE_URL` (for example `https://host/v1`). Trailing slashes are ignored. There is no default. If the flag is on and this variable is unset or blank, a warning with the base-URL-missing message is printed at startup, and no OMK request is sent.

## Error messages

These client texts replace the raw transport error when the corresponding case applies. For `quota_exceeded`, `request_limit_exceeded`, and `rate_limited`, if the gateway also sent `error.message`, the text below is followed by ` Gateway: ` and that message. The account token is never included in a message. Unlisted gateway codes keep the original text (still with the token redacted).

| When | Message |
| --- | --- |
| Token missing | OMK account token missing. Set OMK_ACCOUNT_TOKEN or run /login and choose OMK. |
| Base URL missing | OMK gateway base URL missing. Set OMK_GATEWAY_BASE_URL (for example https://host/v1); OMK requests are refused until it is set. |
| `token_invalid` | OMK token rejected (401 token_invalid): the gateway does not accept this token. Check OMK_ACCOUNT_TOKEN or run /login to store a new one. |
| `token_expired` | OMK token expired (401 token_expired): ask the admin for a new token, then run /login (choose OMK) or update OMK_ACCOUNT_TOKEN. |
| `token_revoked` | OMK token revoked (403 token_revoked): ask the admin for a new token, then run /login (choose OMK) or update OMK_ACCOUNT_TOKEN. |
| `model_not_allowed` | OMK model not allowed for this token (403 model_not_allowed): choose another OMK model with /model or ask the admin to change the plan. |
| `quota_exceeded` | OMK monthly quota exceeded (quota_exceeded, not retried). |
| `request_limit_exceeded` | OMK per-request limit exceeded (request_limit_exceeded). |
| `request_limit_exceeded` and `x-omk-retryable: false` | OMK per-request limit exceeded (request_limit_exceeded, not retried). |
| `rate_limited` | OMK rate limited (429 rate_limited), still throttled after retrying. |
