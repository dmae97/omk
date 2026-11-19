---
phase: 02-native-extensions-and-explicit-migration
reviewed: 2026-11-05T13:59:54Z
initial_reviewed: 2026-11-05T13:46:22Z
recheck_scope: CR-01, CR-02, and test substitution only
depth: standard
files_reviewed: 19
files_reviewed_list:
  - packages/coding-agent/src/core/extensions/loader.ts
  - packages/coding-agent/src/core/extensions/direct-discovery-entries.ts
  - packages/coding-agent/src/core/extensions/bundled-virtual-modules.ts
  - packages/coding-agent/src/core/extensions/lazy-imports.ts
  - packages/coding-agent/src/core/resource-loader.ts
  - packages/coding-agent/src/cli/args.ts
  - packages/coding-agent/src/cli/help.ts
  - packages/coding-agent/src/main.ts
  - packages/coding-agent/src/core/package-doctor.ts
  - packages/coding-agent/src/core/package-doctor-runtime-imports.ts
  - packages/coding-agent/src/commands/package-doctor-cli.ts
  - packages/coding-agent/src/core/agent-session.ts
  - packages/coding-agent/src/core/extensions/runner.ts
  - packages/coding-agent/test/native-extension-retained-runtime.test.ts
  - packages/coding-agent/test/extensions-native-discovery.test.ts
  - packages/coding-agent/test/native-extension-services.test.ts
  - packages/coding-agent/test/native-repository-extension-preservation.test.ts
  - packages/coding-agent/test/native-example-extension-preservation.test.ts
  - packages/coding-agent/test/fixtures/native-extension-harness.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
  necessity: 0
resolved_findings:
  critical: 2
  warning: 0
  info: 0
  total: 2
status: clean
---

# Phase 2: Code Review Report

**Reviewed:** 2026-11-05T13:59:54Z
**Initial review:** 2026-11-05T13:46:22Z
**Depth:** standard, with caller/lifecycle tracing
**Files Reviewed:** 19 cumulative source/test entries; the latest recheck covers only the two fixes and test substitution.
**Status:** clean for the focused recheck; both historical findings resolved

## Summary

- CR-01 and CR-02 are independently verified resolved: both original reproductions now satisfy corrected expectations, and 68 focused tests across seven files pass with maxWorkers=1.
- Omitted/replaced-runtime invalidation still retires both old contexts and old runtimes; retained-runtime reload retires old contexts while preserving the shared API, including repeated reload.
- The two removed aggregate count tests are replaced by 178 individually named registration cases covering the exact same 10 repository and 79 example entry identities in both dialects; remaining services tests still execute tool/provider, immutable-policy and virtual-module checks.
- Initial review compared nine existing loader/resource/CLI/doctor files against verified originals and inspected two new helpers; the pre-invalidation AgentSession backup matched SHA-256 `8a4badc2f189ece0afc2b5722e2be252584529cc9bf4224910fef4cf57fd6858`.
- This recheck verified all five review-fix baseline files against their receipt and compared the three production fixes without attributing the pre-existing Runner overlay to this work.
- This is not a review of the full dirty Git diff, packaging/tooling, Atelier, private extensions, preservation claims, or compiled artifacts.
- Concurrent `package-doctor-runtime-imports.ts` changes are outside this recheck: its current digest differs from the historical initial-review digest and is not newly approved by this report.
- The optional private deep-review/size-review skill files were unavailable; the configured GSD reviewer skill query returned no additional skills.

## Narrative Findings (AI reviewer)

### Resolved Critical Issues (historical)

### CR-01: Reload permanently disables extensions when a custom ResourceLoader retains its runtime [RESOLVED]

**Classification:** BLOCKER (historical severity)
**Status:** RESOLVED, independently verified 2026-11-05T13:59:54Z
**Resolution:** `ExtensionRunner.invalidate(message, replacementRuntime?)` always retires runner contexts but invalidates its runtime only when the incoming runtime differs (`src/core/extensions/runner.ts:458-466`); AgentSession supplies the incoming runtime after loader reload (`src/core/agent-session.ts:4780-4782`).
**Recheck:** Retained API remains usable through repeated reload, old contexts reject, incoming contexts work, reload handler errors are empty, and omitted/different runtime controls still invalidate old APIs/runtimes.
**File:** `packages/coding-agent/src/core/agent-session.ts:4774-4785`
**Full path:** `/home/dmae97/Project/omk/packages/coding-agent/src/core/agent-session.ts:4781`
**Issue:** (Historical, resolved.) The newly unconditional `this._extensionRunner.invalidate()` invalidated the shared ExtensionRuntime, not just the outgoing runner/context.

- `ExtensionRunner.invalidate()` calls `runtime.invalidate()` (`src/core/extensions/runner.ts:458-464`), whose stale state is permanent (`src/core/extensions/loader.ts:217-250`).
- The public ResourceLoader contract does not require reload to replace its extensions/runtime (`src/core/resource-loader.ts:45-57`); the repository's `createTestResourceLoader()` already retains the result and implements no-op reload (`test/utilities.ts:162-180`).
- `_buildRuntime()` then constructs the incoming runner with that same runtime (`src/core/agent-session.ts:4737-4755`), so retained extension handlers throw stale errors even when invoked with the new context.
- This is not restricted to native mode: it also breaks existing compatibility-mode SDK/custom-loader consumers.

**Historical reproduction (pre-fix assertions):** Run from `/home/dmae97/Project/omk`; this creates only an isolated temporary directory and makes no provider calls; the focused recheck below reverses only the defect expectations.

```bash
env -i PATH="$PATH" HOME=/mnt/omkdata/tmp/opencode TMPDIR=/mnt/omkdata/tmp/opencode OMK_OFFLINE=1 OMK_SKIP_VERSION_CHECK=1 OMK_GOAL_AUTONOMY=0 OMK_DOMAIN_ROUTING=0 OMK_VERIFIED_MEMORY=0 node --import tsx --input-type=module -e '
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const root = mkdtempSync("/mnt/omkdata/tmp/opencode/phase2-review-reused-runtime-");
process.env.HOME = root;
process.env.OMK_CODING_AGENT_DIR = join(root,"agent");
mkdirSync(process.env.OMK_CODING_AGENT_DIR);
let network = 0;
globalThis.fetch = async () => { network++; throw new Error("Network prohibited in review reproduction"); };
const { createAgentSession } = await import("./packages/coding-agent/src/core/sdk.ts");
const { AuthStorage } = await import("./packages/coding-agent/src/core/auth-storage.ts");
const { SessionManager } = await import("./packages/coding-agent/src/core/session-manager.ts");
const { SettingsManager } = await import("./packages/coding-agent/src/core/settings-manager.ts");
const { createEventBus } = await import("./packages/coding-agent/src/core/event-bus.ts");
const { createExtensionRuntime, loadExtensionFromFactory } = await import("./packages/coding-agent/src/core/extensions/loader.ts");
const { getModel } = await import("omk-ai");
const runtime = createExtensionRuntime();
const bus = createEventBus();
let api;
const starts = [];
const errors = [];
const extension = await loadExtensionFromFactory((a) => {
  api = a;
  a.on("session_start", (event) => { a.getActiveTools(); starts.push(event.reason); });
}, root, bus, runtime);
const result = { extensions:[extension], errors:[], runtime };
const resourceLoader = {
  getExtensions: () => result,
  getSkills: () => ({skills:[], diagnostics:[]}),
  getPrompts: () => ({prompts:[], diagnostics:[]}),
  getThemes: () => ({themes:[], diagnostics:[]}),
  getAgentsFiles: () => ({agentsFiles:[]}),
  getSystemPrompt: () => "isolated review fixture",
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
  getEventBus: () => bus,
};
let session;
try {
  ({session} = await createAgentSession({cwd:root, agentDir:process.env.OMK_CODING_AGENT_DIR,
    model:getModel("openai","gpt-4o-mini"), authStorage:AuthStorage.inMemory(),
    settingsManager:SettingsManager.inMemory(), sessionManager:SessionManager.inMemory(root), resourceLoader,
    noTools:"all"}));
  await session.bindExtensions({mode:"print", onError:error => errors.push(error.error)});
  assert.deepEqual(api.getActiveTools(),[]);
  await session.reload();
  let after;
  try { api.getActiveTools(); after="active"; } catch (error) { after=error.message; }
  console.log(JSON.stringify({before:"active", after, starts, reloadHandlerErrors:errors, network}));
  assert.match(after,/stale/);
  assert.deepEqual(starts,["startup"]);
  assert.equal(errors.length,1);
  assert.equal(network,0);
} finally {
  if (session) await session.close();
  rmSync(root,{recursive:true,force:true});
}
'
```

**Originally observed:** Exit 0 confirmed the defect assertions; API access worked before reload, the reload session_start handler produced a stale error, starts remained `["startup"]`, subsequent API access remained stale, and network attempts were 0.

**Fix:** Separate outgoing-runner/context retirement from runtime retirement: always invalidate the outgoing runner's contexts, but invalidate its ExtensionRuntime only when the incoming loader result has a different runtime identity; retain the existing stale-API guard for genuinely replaced runtimes.

**Regression coverage:** Assert both retained-runtime reload usability and distinct-runtime stale-context/API rejection through public custom-loader injection.

### CR-02: A dangling symlink silently removes every native direct-discovered sibling [RESOLVED]

**Classification:** BLOCKER (historical severity)
**Status:** RESOLVED, independently verified 2026-11-05T13:59:54Z
**Resolution:** Native direct discovery catches resolver failures per entry and continues to later siblings, while explicit compatibility rethrows to the original outer error boundary (`src/core/extensions/direct-discovery-entries.ts:76-86`).
**Recheck:** The original dangling-symlink fixture now discovers its valid file in both dialects; public-discovery tests preserve valid files before and after a dangling link under native, explicit compatibility and omission.
**File:** `packages/coding-agent/src/core/extensions/direct-discovery-entries.ts:17,66-82`
**Full path:** `/home/dmae97/Project/omk/packages/coding-agent/src/core/extensions/direct-discovery-entries.ts:17`
**Issue:** (Historical, resolved.) Native resolution called realpathSync before checking whether an entry existed, while discovery passed every symlink without a .ts/.js suffix to that resolver and caught errors around the entire directory walk.

- A dangling directory symlink makes realpathSync throw ENOENT; the outer catch returns `[]`, discarding valid extensions already collected and preventing later siblings from being examined.
- Compatibility mode still discovers the valid sibling, and the original backed-up algorithm did not require realpath for these entries.
- `discoverAndLoadExtensions()` uses this helper for project/global/configured direct discovery (`src/core/extensions/loader.ts:605-624`), so the failure produces missing extensions without a load error.

**Historical reproduction (pre-fix assertions):** Run from `/home/dmae97/Project/omk`; the focused recheck below reverses only the defect expectation.

```bash
env -i PATH="$PATH" HOME=/mnt/omkdata/tmp/opencode TMPDIR=/mnt/omkdata/tmp/opencode node --import tsx --input-type=module -e '
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { discoverDirectExtensionsInDir } from "./packages/coding-agent/src/core/extensions/direct-discovery-entries.ts";
const root = mkdtempSync("/mnt/omkdata/tmp/opencode/phase2-review-discovery-");
try {
  writeFileSync(join(root, "a-good.ts"), "export default api => api.registerCommand(\"good\", {handler: async () => {}});");
  symlinkSync(join(root, "missing"), join(root, "z-broken"));
  const compat = discoverDirectExtensionsInDir(root, "omk+pi");
  const native = discoverDirectExtensionsInDir(root, "omk");
  console.log(JSON.stringify({compat: compat.map(p => p.slice(root.length)), native: native.map(p => p.slice(root.length))}));
  assert.equal(compat.length, 1);
  assert.equal(native.length, 0);
} finally { rmSync(root, {recursive:true, force:true}); }
'
```

**Originally observed:** `{"compat":["/a-good.ts"],"native":[]}`, exit 0 confirmed the defect assertions.

**Fix:** Handle an unreadable/dangling entry at the per-entry boundary and continue scanning siblings; keep canonical cycle detection and terminal Pi-only rejection, but do not let one entry's realpath/stat failure replace the entire discovery result with an empty array.

**Regression coverage:** Include a valid file both before and after a dangling non-source symlink, under native and compatibility direct discovery.

## Initial Execution Evidence and Limits (historical)

- Runtime: Node `v26.12.1` on Linux; both defect reproductions ran as isolated, keyless Node/tsx processes with temporary directories removed in finally.
- Focused existing source controls, exit 0, **20 tests across 3 files**:

```bash
# Working directory: /home/dmae97/Project/omk/packages/coding-agent
env -i PATH="$PATH" HOME=/mnt/omkdata/tmp/opencode TMPDIR=/mnt/omkdata/tmp/opencode OMK_CODING_AGENT_DIR=/mnt/omkdata/tmp/opencode/phase2-review-no-user-agent LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/extensions-native-resolution-routes.test.ts test/package-doctor-native-profile.test.ts test/extension-loader-lazy-imports.test.ts
```

- Those controls exercise source alias/ordinary-dependency routing, static doctor diagnosis and lazy Jiti loading; passing controls do not negate either reproduced regression or establish compiled Bun/package acceptance.
- No full suite, build, network/provider call, artifact-tooling review, source edit, dependency change, stage, or commit was performed; root npm check remains owned by the main session.

### Initial reviewed source digests (historical)

```text
a80a17d8bb40d04491a59007a0838bc2cd3dd0f06f4d928b7437698666ca9ece  packages/coding-agent/src/core/extensions/loader.ts
54e91cbc5d368a17e3e40cffaf56f1a982d60617b554a31da3f1a1b567a0dd16  packages/coding-agent/src/core/extensions/direct-discovery-entries.ts
5cda6152aaf7d7180ca1003804f83cb3139232a0d4abb1f7822c9dd012ef0ec4  packages/coding-agent/src/core/extensions/bundled-virtual-modules.ts
6ad5a2beab02149905f3440f090f988690d6ed35ecb1598f4d7d5f60ea1b7987  packages/coding-agent/src/core/extensions/lazy-imports.ts
643b76641692820232ec38c913002212d1dba1deb7aac3557096ca86f02ffc27  packages/coding-agent/src/core/resource-loader.ts
9269af52dae3aa1bb92900e5e9e4eac2478fd17e7f5fb5259295625a7c84d271  packages/coding-agent/src/cli/args.ts
b173adb0f205b980fbf4e6c31fa36d4718aae41d5acbc4cb77b2a9578990387f  packages/coding-agent/src/cli/help.ts
2444d88f557d01cfc0c59a2ed56ed1c136fa7eb4cd45e8829b55ef8a1b8bd90a  packages/coding-agent/src/main.ts
b2b36491da91bf46e1f39a9db7ad52cbe4e0fb1f8437d6b344e4ad2fd092a789  packages/coding-agent/src/core/package-doctor.ts
ac962519703e143578b95bee7ea8c67683d55d3c9b7e05079fb404f6246e0f95  packages/coding-agent/src/core/package-doctor-runtime-imports.ts
a23eccad5ff33d5050a75e0c06fa8ebba6284fd264cc22c58d5ffcb336ce9770  packages/coding-agent/src/commands/package-doctor-cli.ts
827005a590f05c2a976e142d22dbaffb064a57a23af7d758806474adca87d248  packages/coding-agent/src/core/agent-session.ts
```

---

## Focused Fix Recheck

**Verified:** 2026-11-05T13:59:54Z
**Verdict:** Both historical findings resolved; no new findings in the requested fixes or test substitution.

### Independent regression execution

Working directory: `/home/dmae97/Project/omk/packages/coding-agent`.

```bash
env -i PATH="$PATH" HOME=/mnt/omkdata/tmp/opencode TMPDIR=/mnt/omkdata/tmp/opencode OMK_CODING_AGENT_DIR=/mnt/omkdata/tmp/opencode/phase2-review-no-user-agent LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/native-extension-retained-runtime.test.ts test/extensions-native-discovery.test.ts test/native-extension-lifecycle.test.ts test/interactive-reload-core.test.ts test/session-extension-settlement.test.ts test/extensions-runner.test.ts test/native-extension-services.test.ts --maxWorkers=1
```

Observed exit 0: **68 passed, seven files**, comprising the parent's six-file/65-test scope plus the three retained services tests; no timeout increase or skipped test was used.

| Control | Independently observed |
|---|---|
| Retained custom runtime | Two reloads; same runtime and API remain active; old contexts stale; incoming contexts active; no handler errors or fetch calls. |
| DefaultResourceLoader replacement | Captured API and context reject after reload; new native runtime remains usable. |
| New/cwd-changing session replacement | Existing stale-context/API, owner/trust and event-subscription assertions pass. |
| Direct discovery | Before/after siblings survive a dangling link for omitted, explicit compatibility and native selection. |
| Compatibility and manifest controls | Existing order/dedup, index priority, authoritative empty/malformed manifests, terminal nested Pi rejection and native cycle tests pass. |
| Services substitution | Remaining tool/provider execution, constructor-policy immutability and source virtual-module execution tests pass. |

### Original repros with corrected expectations

Ran the two historical repro scripts above unchanged except their defect expectations, using this command from the repository root:

```bash
python3 -c 'import pathlib,re,subprocess; text=pathlib.Path(".planning/phases/02-native-extensions-and-explicit-migration/02-REVIEW.md").read_text(); blocks=re.findall(r"```bash\n(.*?)```",text,re.S); cases=[blocks[0].replace("assert.match(after,/stale/);", "assert.equal(after,\"active\");").replace("assert.deepEqual(starts,[\"startup\"]);", "assert.deepEqual(starts,[\"startup\",\"reload\"]);").replace("assert.equal(errors.length,1);", "assert.equal(errors.length,0);"), blocks[1].replace("assert.equal(native.length, 0);", "assert.deepEqual(native, compat);")]; [(print("FIXED_ORIGINAL_REPRO",i+1,"exit",r.returncode),print(r.stdout),print(r.stderr),r.check_returncode()) for i,b in enumerate(cases) for r in [subprocess.run(["bash","-c",b],cwd="/home/dmae97/Project/omk",capture_output=True,text=True,timeout=120)]]'
```

Both exited 0 with these outputs:

```json
{"before":"active","after":"active","starts":["startup","reload"],"reloadHandlerErrors":[],"network":0}
{"compat":["/a-good.ts"],"native":["/a-good.ts"]}
```

Also executed a separate keyless Node/tsx control directly against source ExtensionRunner with real ExtensionRuntime objects, asserting old context getters, runtime.assertActive and incoming context getters:

| Invocation | Old context | Old runtime | Incoming runtime/context |
|---|---|---|---|
| `runner.invalidate()` | stale | stale | active |
| `runner.invalidate(undefined, oldRuntime)` | stale | active | active |
| `runner.invalidate(undefined, differentRuntime)` | stale | stale | active |

All assertions passed; fetch attempts were 0, and all temporary fixtures were removed.

### Test substitution check

- Verified the removal against `review-fix-baseline/packages/coding-agent/test/native-extension-services.test.ts`: only two aggregate count/load tests, their unused imports/setup and the misleading preservation describe title were removed; the former 60-second timeout was removed, not increased.
- Independently enumerated the old aggregate entry selection with the same managed resolver and compared exact identities against `fixtures/native-extension-inventory.json`: **10 repository and 79 example entries match, with no duplicates**.
- Inspected `native-repository-extension-preservation.test.ts:4-14`, `native-example-extension-preservation.test.ts:12-22` and `fixtures/native-extension-harness.ts:56,157-173`: each identity has an individually named test in both dialects, asserts its real load path and exact registry, and retains selected behavior checks without skip/only or timeout changes.
- Static substitution check exited 0 with `{"exactOldEntrySetsMatch":{"repository":10,"example":79},"perEntryDialectCases":178,"removedAggregateCases":2,"remainingServiceCases":3}`.
- The parent's `preservation-main.log` reports 524/21, but this recheck did not rerun that broader matrix or use the receipt as proof of full feature preservation; registration coverage remains distinct from behavior/platform/artifact acceptance.

### Recheck input digests

All five baseline copies match `review-fix-baseline/receipt.json`; the three production diffs contain only the described fixes, preserving the prior Runner overlay.

```text
80f8e86f6075b444e14128fc291be34db691be6c254d6957dd225fea43301b51  packages/coding-agent/src/core/agent-session.ts
85bf2819037d687f90b2634193e79df680ea1ff0fccc90dcc894dd6300eb4ba5  packages/coding-agent/src/core/extensions/runner.ts
24fe07d32fa863931354a521e9a626c8294706a0c2f8190924521343a298d27a  packages/coding-agent/src/core/extensions/direct-discovery-entries.ts
074d3a59a4ba23db91de91ae66a6bab7bbcd5dbbe07938c70c5e8bd0b36aa55a  packages/coding-agent/test/native-extension-retained-runtime.test.ts
4e6875db1e885efd2389ff187d54d3528cb38c3adf7d8698df2d9b7c55bf21d2  packages/coding-agent/test/extensions-native-discovery.test.ts
e7f6348a474bbce6a85766b32d0626d0d5c39656e8a180cc894f57b899de16e1  packages/coding-agent/test/native-extension-lifecycle.test.ts
5e610497f48f94e6248b0011630cd45ad03321f2a567a280b27adeef0b0fce0e  packages/coding-agent/test/interactive-reload-core.test.ts
6e0abf7dd6db541b420fdef83129891547ebc4b6d190b07c01592ef12071e89c  packages/coding-agent/test/session-extension-settlement.test.ts
7485c3a8fd93db676257868a8a71c2a03daae57e0ca1ef20730c54bf24f1a4b8  packages/coding-agent/test/extensions-runner.test.ts
cac74540e0c219c839a8c7e512b0c6c2a29e10dd006345baa1525f7bebd59dc8  packages/coding-agent/test/native-extension-services.test.ts
32ce8ccd7a0ee1668568aee3faded33945b6ce13e37d5ca26a855399e4abca5e  packages/coding-agent/test/native-repository-extension-preservation.test.ts
e1a00d9d265f06d3055d2683827c9ee3c600221be9c456fa5e4e30e6d155ea99  packages/coding-agent/test/native-example-extension-preservation.test.ts
479457d740f7ff3ed63a4a5f09c9e17cadbf31396700c654e14b51362b9d6c29  packages/coding-agent/test/fixtures/native-extension-harness.ts
ae26e8c1a77084074537a341fef1c066c3e71068b6ba062efabf656e81e8bb49  packages/coding-agent/test/fixtures/native-extension-inventory.json
```

Outside-recheck drift: `packages/coding-agent/src/core/package-doctor-runtime-imports.ts` now hashes to `ccea097c8a0f128bd7dcf6c3244aa2760988d8bf3faf80cf52d43ecf0525374a`; its concurrent changes were not reviewed here.

Only this report was edited; no source edits, full suite/build, provider calls, artifact work, stage, commit or delegation occurred.

---

_Reviewed: 2026-11-05T13:59:54Z; initial historical review retained above._
_Reviewer: independent gsd-code-reviewer subagent_
_Depth: standard_
