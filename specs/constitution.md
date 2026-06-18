# OMK Spec Constitution

## Principles

1. Preserve runtime behavior unless a feature spec explicitly changes it.
2. Prefer deterministic, testable state transitions over implicit side effects.
3. Treat model, thinking, theme, compaction, and compatibility warnings as harness control-plane state.
4. Record implementation evidence in local artifacts without secrets or raw credentials.
5. Verify with targeted tests first, then `npm run check` after code changes.

## Safety

- Do not write secrets, tokens, `.env` contents, or raw credential material into specs or evidence.
- Do not delete or overwrite project-authored artifacts without explicit approval.
- Use scoped git staging only when committing.
