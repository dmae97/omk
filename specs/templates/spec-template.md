# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`
**Created**: [DATE]
**Status**: Draft
**Package Version**: `open-multi-agent-kit@0.79.3`
**Runtime Contract Family**: `v1.2`
**Release Channel**: `pre-1.0`

## Problem Statement

[Describe the user or operator problem. Avoid making claims that are not verified by code, tests, or release evidence.]

## Requirements

### FR1 — [Requirement]

- **Risk class**: `read | write | shell | merge | ask`
- **Required authority**: `read | write | patch | shell | mcp | review | merge`
- **Provider/runtime mode**: [e.g. `kimi:api` advisory, `opencode:cli` write-capable]
- **Evidence gate**: `summary | command-pass | file-exists | review-pass | diff-nonempty`
- **Acceptance**:
  1. [Measurable acceptance criterion]
  2. [Measurable acceptance criterion]

## Evidence Completion Rule

For any `write`, `shell`, or `merge` task, at least one required evidence gate must be present and replayable. Evidence must be redacted and safe to store under `.omk/runs/<run-id>/`.

## Provider Health / Authority Notes

- Unhealthy providers must not be selected for executable lanes.
- Advisory API runtimes must not receive write/shell/merge authority unless their runtime-mode contract explicitly supports it.
- OS-level sandboxing must not be claimed unless the feature implements and verifies it.

## Verification Commands

- `npm run version:check`
- `npm run lint`
- `npm run secret:scan`
- `npm run check`
- `npm run build:clean`
- `npm test`

## Out of Scope

- [List explicit non-goals]
