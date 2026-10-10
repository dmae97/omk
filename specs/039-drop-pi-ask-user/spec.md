---
description: "Remove pi-ask-user from the Pi package intake candidates"
---

# Feature Specification: Drop pi-ask-user from Pi package intake

**Specification ID**: `039-drop-pi-ask-user`
**Feature Branch**: `chore/drop-pi-ask-user`
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: OMK's Pi research (`/workspace/omk-research/HARNESS_PI_SKILLS_20261011.md`, `PI1_API_COMPAT_20261011.md`) and Tech Lead's decision in the group room, 2026-10-11: extensions that stop to ask a person (ask-user, plan mode, approval-style permissions) are out of scope for omk's harness work, and `pi-ask-user` comes off the intake list in its own small PR, separate from 031.

## Why

`P1_PI_PACKAGE_PORT_CANDIDATES` lists `pi-ask-user` as a measurement-gated `interactive-ui` candidate, with metrics `clarification-round-trip-count` and `selection-ui-render-latency`. omk's harness direction is unattended runs that finish against checks; a tool that waits for a human answer cannot run headless and would stall a benchmark run until it times out. Keeping it on the list invites a port nobody should do.

## Requirements

1. Remove the `pi-ask-user` entry from `P1_PI_PACKAGE_PORT_CANDIDATES`.
2. It was the only `interactive-ui` candidate. Remove `"interactive-ui"` from `PiPackageLane` so the lane cannot come back silently, and drop it from the lane test's expected list.
3. A test asserts that no P0 or P1 candidate has id or origin `pi-ask-user`.
4. No other candidate changes. `package-procurement.ts` rules and the `@juicesharp/rpiv-ask-user-question` procurement fixtures are untouched; they test the policy, not the intake list.
5. Gates: `npm run check` passes; the module-size baseline is not raised.

## Acceptance criteria

- `vitest run test/pi-package-intake.test.ts` passes, including the new case, which fails on main `226e096`.
- `rg "pi-ask-user" packages/coding-agent/src` finds nothing.

## Expected Files

- `specs/039-drop-pi-ask-user/spec.md` (first commit)
- `packages/coding-agent/src/core/pi-package-intake-candidates.ts`
- `packages/coding-agent/test/pi-package-intake.test.ts`
- `packages/coding-agent/CHANGELOG.md`, `README.md` (release sync)
