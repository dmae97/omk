# Raw prompt for verified-run capture

Copy the block below into the future OMK/Kimi capture session.
Replace bracketed placeholders before running.
Do not edit the captured transcript afterward.

```txt
Goal: Make one tiny, reviewable change in the disposable demo fixture so the run has a real diff and evidence.
Scope/write ownership: [DEMO_FIXTURE_PATH] only.
Story requirement: show that OMK does not accept premature completion before evidence exists.
Then show the run passing after evidence is captured.
Constraints: no secrets, no production files, no package metadata, no unrelated refactor, no fabricated outputs.
Required evidence:
1. generated diff from Kimi's edit
2. terminal excerpt where premature done is blocked by OMK evidence gate
3. `omk verify --run [RUN_ID] --json` result
4. cockpit proof for `[RUN_ID]`
5. replay proof for `[RUN_ID]` with evidence/decision details
Stop condition: report done only after evidence exists and `omk verify --json` passes.
If evidence is missing, leave TODO/capture slots open instead of claiming completion.
```
