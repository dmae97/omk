# Extension memory lifecycle

## Scope

The source loader releases two previously retained reference paths in native
`omk` mode and compatibility `omk+pi` mode. Defaults and package versions are
unchanged. These changes support the extension-preservation portion of the
[2.0 migration](omk-2-migration.md), not desktop or Rust execution acceptance.

### Failed factories

A factory can subscribe through `api.events.on()` and then throw. Previously the
loader omitted that extension from its successful result, so resource reload
could not find its unsubscribe callbacks. Every failed reload added another
listener to the shared event bus.

Both file and inline factories now remove their recorded subscriptions on
failure. Successful siblings and listeners registered directly on an injected
bus remain intact. The original factory error is preserved. If an injected
unsubscribe throws, cleanup still attempts the remaining callbacks and throws
an `AggregateError` with the factory error as its `cause` and all failures in
`errors`. A throwing unsubscribe is not proof its listener was removed.

This is not a transaction for all factory side effects: provider registrations,
external resources, detached asynchronous work and retained user references are
not rolled back by subscription cleanup.

### Retired runtimes

Runtime invalidation previously set a stale marker but retained action callbacks,
pending provider payloads, flag values, provider ownership and the loaded-extension
inventory. A captured extension API could therefore keep references to an old
session and other extensions after replacement.

Invalidation now replaces bound action/provider callbacks with inactive stubs,
unbinds the MCP callback, empties the pending registrations and maps, and drops
the runtime's inventory reference without clearing the caller's extension array.
The first stale reason remains authoritative. Pre-bind registration remains
available. Invalidation does not cancel an already-started operation; session
shutdown and settlement keep their existing ownership rules.

A custom resource loader that deliberately retains its runtime across reload
still retains that live runtime. The existing runner identity check continues to
retire only outgoing contexts in that case. This change does not clear module
caches, delete sessions, invoke garbage collection or change provider context
budgets. It does not promise that all references held by extensions are released.

## Source verification, 2026-11-06

The six initial regression cases failed on the intended assertions before the
fix. A failed factory reloaded three times produced three obsolete callbacks in
each dialect. After the fix, those callbacks no longer execute while the live
listener still executes once.

The final focused suite passed **87 tests in eight files**, with zero skips:

```sh
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run \
  test/extensions-memory-lifecycle.test.ts \
  test/native-extension-retained-runtime.test.ts \
  test/native-extension-lifecycle.test.ts test/extensions-runner.test.ts \
  test/resource-loader.test.ts test/interactive-reload-core.test.ts \
  test/session-extension-settlement.test.ts test/extension-loader-lazy-imports.test.ts \
  --maxWorkers=1
```

The same run with V8 coverage limited to `runtime.ts` and
`initialize-extension.ts` measured 100% lines/statements/functions and 88.88%
branches across those two modules. Root `tsgo --noEmit` passed. Primary LSP
checking was inconclusive for four paths and reported an existing auxiliary
`unknown`-alias finding at `types.ts:1020`; it is not reported as a clean LSP run.

`npm run check` reached the script tests: 579 passed, one failed, 30 skipped.
The failure reported four pre-existing `dist/core/subscription-usage-cache.*`
outputs with no corresponding source. Those unrelated generated files were not
removed. Later chained checks did not run in that invocation; the independent
compiler pass does not make the complete root check green.

Tests ran with one Vitest worker. The root check and compiler were restricted to
two CPUs; the root check used a 4096 MiB Node heap cap to limit verification
pressure. No other process or system memory setting was changed. There is no
whole-process RSS/heap A/B result, installed-engine activation, packaged-artifact
acceptance or 2.0 release claim.
