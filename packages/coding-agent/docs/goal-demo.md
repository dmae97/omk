# Make “done” pass a check

This small example lets you try OMK's explicit goal acceptance check on a local
bug. It uses Node's built-in test runner, so the test needs no downloaded
dependencies or network access. Provider access is required for the agent.

Use OMK 1.3.0 or newer and Node.js 22.19 or newer. Local bash needs
`sandbox-exec` on macOS or `bwrap` with unprivileged user namespaces on Linux.
See [quickstart](quickstart.md) for installation and provider setup.

## Create the fixture

Create a new directory for the demo, outside your existing project:

```bash
mkdir omk-goal-demo
cd omk-goal-demo
git init
```

Save this as `add.mjs`:

```javascript
export function add(a, b) {
  return a - b;
}
```

Save this as `check.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";
import { add } from "./add.mjs";

test("add returns the sum", () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-2, 3), 1);
});
```

Run `node --test check.test.mjs`. It must fail before you start. Leave both files
untracked if you do not want to configure a Git identity; the workspace binding
includes untracked files as well as tracked edits.

## Approve the check

Start `omk` from the demo directory. Use `/login` and `/model` if this is your
first session. Enter:

```text
/goal Fix add.mjs so the existing test passes. Keep check.test.mjs unchanged.
/goal verify node --test check.test.mjs
```

Approve the command when OMK asks. The initial check should fail. Ask the agent
to fix `add.mjs` without editing the test. After the turn settles, OMK runs the
approved command again. A passing check can complete the goal; a failure starts
another round, up to the goal's eight-round cap.

Use `/goal` to inspect the approved command and completion evidence. Outside
OMK, run `git diff --no-index /dev/null add.mjs` to inspect the new file, and
run `node --test check.test.mjs` yourself. That diff command exits 1 when the
file differs; this is expected.

## Show why freshness matters

After the first goal completes, keep the fixed file and start a new goal:

```text
/goal Recheck add.mjs against the unchanged test.
/goal verify node --test check.test.mjs
```

This manually run check should pass. It attaches evidence to the open goal;
it does not immediately mark the goal complete. Before sending another prompt
or completing it, use another editor to change `add.mjs` back to `a - b`.
Use `/goal` to see that the evidence is stale, then `/goal complete` to see
completion refused. Re-run `/goal verify node --test check.test.mjs` to observe
the failing check on the changed workspace.

A completed goal is a historical result: editing afterward does not reopen it,
and `/goal verify` requires an open goal. Do not describe an old passing receipt
as proof that the new file works.

The goal journal and receipt are not a proof of general correctness. This demo
checks two inputs, and a test can be edited or weakened. Inspect the files and
test yourself. Approval is held by the current OMK process; after restarting,
approve the command again. See [acceptance checks](run-protocol.md#acceptance-checks)
for the complete boundaries.

## Share a useful result

Record the initial failing test, the unchanged assertions, the fixed function,
the passing check, and the stale-evidence state after the edit. Keep the demo
free of credentials and private source. Share the commands, installed version,
OS, and any reproducible failure in a [GitHub issue](https://github.com/dmae97/omk/issues).

If this workflow is useful, [star OMK](https://github.com/dmae97/omk) so other
developers can find it.
