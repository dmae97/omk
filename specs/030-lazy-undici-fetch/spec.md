---
description: "Fix: the lazy undici install silently replaces a fetch hook an extension installed"
---

# Feature Specification: Lazy undici install keeps extension fetch hooks

**Specification ID**: `030-lazy-undici-fetch`
**Feature Branch**: `fix/lazy-undici-fetch`
**Created**: 2026-10-08
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: During the B′ A/B run on main `03b34c2`, the bench logger's `globalThis.fetch` hook (installed by an extension) recorded only the first request of each trial. Tech Lead assigned it as a P0 correctness bug.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: preserve (correctness fix. It restores the pre-#78 behavior for extensions and keeps #78's lazy undici load.)

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Reliability | Hook installed, then an extension wraps `fetch`, 3 requests: the extension hook runs 1 time and `globalThis.fetch` ends up as undici's `fetch` | The extension hook runs 3 times and stays `globalThis.fetch` | Without an extension, `globalThis.fetch` becomes `undici.fetch` and the global dispatcher is an `EnvHttpProxyAgent`, as today | `npx vitest run test/http-dispatcher-fetch-override.test.ts` in `packages/coding-agent` | `packages/coding-agent/test/http-dispatcher-fetch-override.test.ts` |

## Root cause

#78 (`a37dd360a7`) made undici load on the first `fetch`:

1. `cli.ts:20` calls `installHttpDispatcherFetchHook()`, which replaces `globalThis.fetch` with a one-shot wrapper `W` (`core/http-dispatcher-install.ts:65-80`).
2. Extensions load later. An extension that hooks fetch captures `W` and sets `globalThis.fetch = E`.
3. The first request runs `E` → `W` → `ensureHttpDispatcherInstalled()`, which only now imports `core/http-dispatcher.ts`. That module captures `originalGlobalFetch = globalThis.fetch` at import time (`http-dispatcher.ts:11`), so it records `E` as the untouched original.
4. `configureHttpDispatcher` sees `globalThis.fetch === originalGlobalFetch` and calls `undici.install()`, which sets `globalThis.fetch = undici.fetch`. The extension hook is gone without any message.
5. `W` then forwards to the new `globalThis.fetch`. The first request went through `E`; every later request goes straight to undici.

Before #78, `http-dispatcher.ts` was imported at startup, before extensions, so `originalGlobalFetch` was Node's fetch, undici was installed first, and an extension wrapped undici's fetch. That is the behavior to restore.

## Goal

- The "is fetch still ours" check compares against the value omk itself installed (the hook `W`, or Node's fetch when no hook was installed), never against whatever `globalThis.fetch` is when undici first loads.
- When `globalThis.fetch` is not ours at install time (an extension replaced it), omk sets the undici dispatcher but leaves `globalThis.fetch` alone. Reconfiguring the idle timeout later (`scheduleHttpDispatcher`) does not replace it either.
- `W` forwards to the fetch that matches the dispatcher (`undici.fetch`), not to `globalThis.fetch`, so an extension that wraps `W` keeps the pre-#78 chain `E` → undici fetch and cannot recurse into itself.

## Agent-Oriented Requirements

### Requirement 1 - Keep extension fetch hooks across the lazy install (Priority: P0)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: low

**Acceptance** (named vitest cases in `packages/coding-agent/test/http-dispatcher-fetch-override.test.ts`; each fails on main `03b34c2` and passes with the fix, except AC3, which passes on both):
1. Hook installed, then an extension wraps `fetch`, then 3 requests: the extension hook is called 3 times, `globalThis.fetch` is still the extension hook, and the global dispatcher is an `EnvHttpProxyAgent`.
2. Same setup, one request, `scheduleHttpDispatcher(120_000)`, one more request: the extension hook is called 2 times and is still `globalThis.fetch`.
3. Hook installed, no extension, 2 requests: `globalThis.fetch === undici.fetch` and the dispatcher is an `EnvHttpProxyAgent` (unchanged behavior).
4. Existing `http-dispatcher-lazy-undici.test.ts` (undici not loaded until the first fetch) and `http-dispatcher-install-concurrent.test.ts` (one install for overlapping callers) pass unchanged.

### Requirement 2 - Gates (Priority: P0)

- `npm run check` passes before each commit. Explicit-path staging. The first commit is this spec.
- Touched modules stay under the 250 pure-LOC ceiling. Top-level imports only. No `any`.

## Non-goals

- No change to when undici loads (still the first `fetch`, or an explicit `ensureHttpDispatcherInstalled()`).
- No change to the dispatcher options (proxy agent, idle timeouts, `allowH2: false`).
- No extension API for "add a fetch hook". Extensions that replace `globalThis.fetch` keep doing it themselves.
- An extension that replaces `fetch` with something that never calls the fetch it captured is not wrapped or forced through undici.

## Expected Files

- `specs/030-lazy-undici-fetch/spec.md`: this spec (first commit)
- `packages/coding-agent/src/core/http-dispatcher.ts`: one owned-fetch reference instead of the import-time capture; export the fetch that pairs with the dispatcher
- `packages/coding-agent/src/core/http-dispatcher-install.ts`: hand the hook to the dispatcher before the first configure; forward to the paired fetch
- `packages/coding-agent/test/http-dispatcher-fetch-override.test.ts`: the three cases above
- `packages/coding-agent/CHANGELOG.md`: one Fixed entry
