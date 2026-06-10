# Lane C2 — Enforce writableRoots in tool dispatch

Status: APPLIED (helpers + test). Dispatch wiring DEFERRED with exact point documented (NON-BREAKING).

## Changed files
- `src/runtime/sandbox-profile.ts` (+1 import, +65 lines): added pure helpers
  `isPathWritable(p, roots)`, `assertWritable(p, roots)`, and error class
  `SandboxWriteDeniedError`. No existing exports changed.
- `test/sandbox-writable-roots.test.mjs` (new): 6 unit tests.
- (Did NOT touch dispatch/tool source — see deferral rationale; budget preserved.)

Untouched per constraints: package.json, CI, crates, native files. No `any`.
Concurrent worker edits to secret-scanner.ts / model-registry.ts left intact.

## Prefix-safety logic
- Normalize both target and each root via `node:path.resolve`, which collapses
  `.` and `..` segments. So `..` escapes are judged at the RESOLVED location
  (e.g. `/a/b/../../etc/passwd` -> `/etc/passwd`).
- Match = `target === resolvedRoot` OR `target.startsWith(resolvedRoot + path.sep)`.
  Appending `path.sep` enforces a segment boundary, so root `/a/b` does NOT
  match sibling `/a/bc` (because `/a/bc` does not start with `/a/b/`).
- SAFE DEFAULT: empty/undefined `roots` => `isPathWritable` returns `true` and
  `assertWritable` is a no-op. Current behavior (writableRoots used only as
  metadata) is byte-preserved; enforcement activates only when a profile sets a
  non-empty `writableRoots`. The agent's own writes are unaffected unless a
  caller explicitly opts in.

## Exact wiring point (deferred, ready to wire)
Central write dispatch checkpoint:
- `src/runtime/tool-dispatch-contracts.ts`
  - `buildGatedDispatch<A,R>` at line 192; insert before `return dispatchOne(call)`
    at line 202.
  - `ToolAuthorityWiring` interface at line 46 (add optional
    `readonly writableRoots?: readonly string[]`; threaded from the active
    `RuntimeSandboxProfile.writableRoots`).
- Suggested guarded call (only fires for write ops with explicit roots):
  ```ts
  if (wiring.writableRoots?.length && mapToolNameToOp(call.toolName) === "write") {
    const target = extractTargetPath(call.args); // path | file_path | filePath
    if (target) assertWritable(target, wiring.writableRoots);
  }
  ```

### Why deferred (risk-minimizing, per task branch 3)
1. `dispatchToolCallsByContract` uses opaque generic `A` args — there is no
   guaranteed path field across tools; extracting one requires a tool-specific
   arg shape contract not present today (would risk unsafe casts).
2. `writableRoots` is not currently threaded into `ToolAuthorityWiring`; adding
   it changes the wiring contract consumed by
   `commands/chat/native-root-loop.ts` (live turn dispatch).
3. Task mandates NON-BREAKING + minimal/reversible. Shipping IO-free, fully
   tested helpers now lets a follow-up wire enforcement in one guarded line
   without re-deriving policy. Mirrors existing `tool-authority-gate` staging
   pattern (primitive landed before dispatch wiring).

## Test command + result
```
node --test test/sandbox-writable-roots.test.mjs
# tests 6 # pass 6 # fail 0   => PASS
```
Cases proven: (a) unset roots => allow; (b) inside root => allow; (c) sibling
`/a/bc` vs root `/a/b` => deny; (d) `..` escape => deny; plus in-root `..` =>
allow and multi-root any-match.

Quality gates on touched file:
- `eslint --max-warnings=0 src/runtime/sandbox-profile.ts` => PASS (exit 0)
- `tsc --noEmit src/runtime/sandbox-profile.ts` => PASS
- `npm run secret:scan` => PASS (no secrets)

## Security rationale + residual risk
- Rationale: prevents path-traversal / sibling-prefix write escapes once a
  sandbox sets explicit writable roots; fail-safe error names the resolved
  target without leaking secret values.
- Residual risk:
  - Enforcement is NOT yet active at dispatch (helpers unused in live path);
    no runtime protection until the documented wiring lands. Tracked above.
  - Symlinks are not resolved (`resolve` != `realpath`); a symlink inside a
    root pointing outside would still pass. Follow-up: `fs.realpathSync` on
    parent dir before check if symlink escape is in scope.
  - Windows case-insensitive / UNC paths not special-cased (resolve handles
    separators; drive-letter casing left as-is).
