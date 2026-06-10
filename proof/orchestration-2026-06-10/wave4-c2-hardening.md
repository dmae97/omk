# Wave-4 C2 HARDENING — close 3 remaining-risk items from wave3-review.md

Date: 2026-06-10
Mode: APPLY, NON-BREAKING, no commit, no web.
Skills: omk-security-review, omk-secret-guard, omk-typescript-strict.
Closes wave3-review NITS: (1) symlink/realpath gap, (2) deferred dispatch wiring,
(3) missing EOF newline in sandbox-profile.ts.

## Changed files (exactly 4, scope-clean)
- src/runtime/sandbox-profile.ts        — realpath/symlink hardening + EOF newline
- src/runtime/tool-dispatch-contracts.ts — non-breaking write-path enforcement wiring
- test/sandbox-writable-roots.test.mjs   — +3 cases (e/f/g)
- test/tool-dispatch-contracts.test.mjs  — +3 cases (a/b/c)

NOT touched (concurrent worker, left intact): src/providers/*, src/mcp/secret-scanner.ts,
test/secret-scanner.test.mjs, test/provider-openrouter-fable-activation.test.mjs,
package.json, CI, crates, native, secret-scanner.

## ITEM 1 — realpath ancestor-walk (src/runtime/sandbox-profile.ts)

New helper `resolveRealPathBestEffort(p)` (sandbox-profile.ts:100), used by both
`isPathWritable` (:155 target, :158 each root) and `assertWritable` error target.

Logic (best-effort, fail-safe, never throws from resolution):
1. `resolved = nodePath.resolve(p)` — collapses `.` / `..`.
2. Walk UP from `resolved`: try `fs.realpathSync(current)`.
   - On success: return `realpath(current)` joined with the popped trailing
     (non-existent) segments. This resolves a SYMLINK on the existing portion
     even when the final write target does not exist yet.
   - On throw (ENOENT while walking / EACCES): push `basename(current)` onto
     `trailing`, set `current = dirname(current)`, repeat.
   - If `dirname(current) === current` (filesystem root, nothing resolvable):
     fall back to the plain `resolved` path (prior behavior). NEVER throws.
3. Segment-boundary prefix check is unchanged: target must equal a realpath-
   resolved root or sit under `root + path.sep` (so `/a/b` still denies `/a/bc`).

Safe default preserved: empty/undefined `roots` => `isPathWritable` returns true,
`assertWritable` is a no-op (unrestricted). Only a genuine deny throws
`SandboxWriteDeniedError`. Trailing EOF newline added.

Security: a symlink inside a root whose real target escapes every root is now
DENIED (was previously allowed because `resolve` != `realpath`).

## ITEM 2 — dispatch wiring (src/runtime/tool-dispatch-contracts.ts)

Import: `import { assertWritable } from "./sandbox-profile.js";`

ToolAuthorityWiring extended with TWO optional fields (no `any`):
- `readonly writableRoots?: readonly string[];`                        (:73)
- `readonly resolveWritePath?: (call: OmkToolCall) => string | undefined;` (:81)
  (interface is non-generic over A; param typed as `OmkToolCall` =
  `OmkToolCall<unknown>`. `OmkToolCall<A>` is assignable to it since `args` is
  readonly/covariant — no `any` introduced.)

buildGatedDispatch (tool-dispatch-contracts.ts:218-227), AFTER verdict +
`onDecision` + blocked-throw, BEFORE `dispatchOne(call)`:

```ts
if (wiring.enforce === true && wiring.writableRoots?.length && wiring.resolveWritePath) {
  const writeTarget = wiring.resolveWritePath(call);
  if (writeTarget) {
    assertWritable(writeTarget, wiring.writableRoots);
  }
}
```

A deny throws `SandboxWriteDeniedError` (reused from sandbox-profile, Error-
consistent with the file). The verdict-record/onDecision flow still runs.

### Non-breaking proof
- The new block is entered ONLY when ALL of: `enforce === true` AND non-empty
  `writableRoots` AND `resolveWritePath` present AND it returns a non-empty path.
- When `resolveWritePath` OR `writableRoots` is absent, OR `enforce === false`,
  the `if` is skipped entirely => dispatch is byte-identical to pre-C2.
- When `authority` wiring is omitted from `dispatchToolCallsByContract`,
  `effectiveDispatch = dispatchOne` (unchanged top-level no-op path).
- Verified by test (c): enforce=false and missing-resolveWritePath both pass
  through to dispatchOne with NO path check, even for an out-of-root arg.

## ITEM 3 — tests

test/sandbox-writable-roots.test.mjs (+3, real fs via os.tmpdir/mkdtempSync/symlinkSync, cleaned up):
- (e) symlink inside root -> outside all roots => deny (isPathWritable false + assertWritable throws SandboxWriteDeniedError)
- (f) legit nested NON-existent target under a root => allow
- (g) realpath failure (no existing ancestor) => falls back gracefully, no throw

test/tool-dispatch-contracts.test.mjs (+3, real fs + symlink, cleaned up):
- (a) enforce + writableRoots + resolveWritePath out-of-root => dispatch rejects (SandboxWriteDeniedError), dispatchOne NOT called (count 0)
- (b) same but in-root => dispatchOne called (count 1), fulfilled
- (c) enforce=false (with roots+resolver) AND enforce=true-without-resolver => byte-identical pass-through, dispatchOne called, no path check

## Verification results

Command: `node --test test/sandbox-writable-roots.test.mjs test/tool-dispatch-contracts.test.mjs`
Result: tests 13, pass 13, fail 0  (sandbox 9: a-d + nested + multi + e/f/g; dispatch 4: existing + a/b/c)

Command: `npx tsc --noEmit 2>&1 | grep -E 'sandbox-profile|tool-dispatch|error TS' || echo TSC_CLEAN`
Result: TSC_CLEAN (full-project typecheck, no errors)

Command: `npm run build` (regenerates dist/ consumed by the dist-importing tests)
Result: clean (tsc && chmod-dist)

Command: `npm run secret:scan | tail -3`
Result: "Secret scan passed: no high-confidence secrets or maintainer-private paths found."

## Residual risk
- TOCTOU: realpath is resolved at check time; a symlink could be swapped between
  the check and the actual write (classic filesystem TOCTOU). Mitigation would
  require O_NOFOLLOW / openat-based atomic write, out of scope for an IO-light gate.
- Windows path casing / 8.3 short names: prefix compare is case-sensitive and
  byte-based; case-insensitive FS could under-match. Linux/macOS path here OK.
- EACCES on an ancestor mid-walk falls back to plain resolve (fail-safe = allow
  relative to roots if the remainder matches); a permission-hidden symlink on an
  unreadable ancestor is not fully resolved. Acceptable (never throws), tracked.
- Enforcement is opt-in: callers must pass `enforce:true` + `writableRoots` +
  `resolveWritePath` for live protection; default dispatch remains unprotected
  by design (non-breaking). Wiring real callers is a separate follow-up.
