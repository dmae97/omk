# OMK v1.5.14

OMK 1.5.14 is a patch release from `main`. It keeps Anthropic OAuth sessions
working on models that require a newer Claude Code version, and it carries the
test coverage our community contributed in this cycle. Rust-core and v2
development are not included.

## Contributors

Thank you to everyone whose pull requests were merged in this cycle:

- [@Abhinav3499](https://github.com/Abhinav3499) added unit tests for
  `hasStatusCodeLike` (#410), the OAuth credential helpers (#412) and the goal
  output recall access tracker (#413).
- [@shoaibriazdev](https://github.com/shoaibriazdev) added unit tests for
  `findGitPaths` (#400).
- [@Sudhakar7J](https://github.com/Sudhakar7J) added unit tests for
  `createPermitDeadline`, including deadlines past the 32-bit timer range (#337).

## OMK + AdaptOrch

OMK writes and runs the code. [AdaptOrch](https://adaptorch.com/?utm_source=github&utm_medium=release&utm_campaign=omk-1.5.14)
checks what it wrote. When an agent's "done" is not enough for your review,
AdaptOrch keeps a record of what actually ran and what happened, and every
report says `correctness_claim=false`. It is a separate, optional product, and
OMK never calls it by default. Start with
[OMK + AdaptOrch](https://github.com/dmae97/omk/blob/main/packages/coding-agent/docs/omk-adaptorch.md).
The README now shows this introduction right below the community contributors
(#424).

The AdaptOrch name and marks identify that separate proprietary product and
appear here with permission. They are excluded from this repository's MIT
grant; see [TRADEMARKS.md](https://github.com/dmae97/omk/blob/main/TRADEMARKS.md).

## Anthropic OAuth

- Anthropic OAuth requests identify as Claude Code 2.1.322 instead of 2.1.280.
  Anthropic rejects an OAuth request whose Claude Code version is older than a
  model's gate with HTTP 400 `claude_code_version_too_old`, and the gate
  observed on the newest model is 2.1.290, so every turn on that model failed
  for a logged-in subscription. The `custom-provider-anthropic` example
  extension sends the same version (#393).

## Verification scope

The identity change is covered by the offline identity test, which asserts the
pinned version is at or above the newest observed gate. It was not exercised
against every Anthropic model, and a future gate above 2.1.322 will need
another bump.

All seven public workspace packages are released at 1.5.14. No dependency
changed.
