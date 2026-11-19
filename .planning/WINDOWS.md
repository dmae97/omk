---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 1
total_count: 2
last_updated: 2026-11-05T13:33:58.364Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 02 | unmet-truth | packages/coding-agent/test/native-extension-lifecycle.test.ts | 224 | Captured extension API and ctx remain active after native session reload; previous runtime is not invalidated. | fixed | Parent added old-runner invalidate after resource-loader reload and before _buildRuntime. Parent command: LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/native-extension-lifecycle.test.ts test/interactive-reload-core.test.ts test/session-extension-settlement.test.ts test/extensions-runner.test.ts --maxWorkers=1; 54 passed. Main RED/GREEN proof: /mnt/omkdata/tmp/opencode/omk-phase2-native-extensions-backup/stale-reload-{red,green}-main.log. Own final consumer rerun: 161 passed across 11 files; scoped core typecheck exit 0. | 2026-11-05T13:15:39.398Z | 2026-11-05T13:33:58.364Z |
| 2 | 02 | unrun-verify | .planning/phases/02-native-extensions-and-explicit-migration/02-02-PLAN.md | 151 | Root npm run check is reserved for the parent integration pass and was not run concurrently by this lane. | open |  | 2026-11-05T13:15:39.565Z |  |

````json
[
  {
    "id": 1,
    "kind": "unmet-truth",
    "phase": "02",
    "file": "packages/coding-agent/test/native-extension-lifecycle.test.ts",
    "line": 224,
    "description": "Captured extension API and ctx remain active after native session reload; previous runtime is not invalidated.",
    "status": "fixed",
    "reason": "Parent added old-runner invalidate after resource-loader reload and before _buildRuntime. Parent command: LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/native-extension-lifecycle.test.ts test/interactive-reload-core.test.ts test/session-extension-settlement.test.ts test/extensions-runner.test.ts --maxWorkers=1; 54 passed. Main RED/GREEN proof: /mnt/omkdata/tmp/opencode/omk-phase2-native-extensions-backup/stale-reload-{red,green}-main.log. Own final consumer rerun: 161 passed across 11 files; scoped core typecheck exit 0.",
    "recorded_at": "2026-11-05T13:15:39.398Z",
    "resolved_at": "2026-11-05T13:33:58.364Z",
    "milestone": "v2.0.0"
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "02",
    "file": ".planning/phases/02-native-extensions-and-explicit-migration/02-02-PLAN.md",
    "line": 151,
    "description": "Root npm run check is reserved for the parent integration pass and was not run concurrently by this lane.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-11-05T13:15:39.565Z",
    "resolved_at": null,
    "milestone": "v2.0.0"
  }
]
````
