# Verified-run demo evidence skeleton

Status: **skeleton only**. This bundle defines TODO/capture slots for a future verified run; it does not contain real proof yet.

## Story

One prompt -> Kimi edits -> OMK blocks premature done -> evidence passes -> cockpit/replay shows proof.

## Bundle map

| Path | Purpose | Status |
| --- | --- | --- |
| `raw-prompt.md` | Exact prompt for the capture run | Ready to copy |
| `generated-diff.md` | Diff capture rules and placeholder metadata | TODO/capture slot |
| `capture-plan.md` | Commands and paths for verify, cockpit, and replay proof | TODO/capture slots |
| `video-shot-list.md` | 60-90s recording outline | Ready storyboard |
| `artifacts/README.md` | Expected raw evidence filenames | TODO/capture slots |

## Acceptance criteria for filling this bundle

- Use a disposable branch or worktree.
- Capture Kimi's generated diff before manual cleanup.
- Capture the premature-done block exactly as emitted; if no block occurs, mark the demo failed.
- Capture `omk verify --json` to the documented JSON path and validate it parses.
- Capture cockpit and replay proof from the same run id.
- Do not commit secrets, tokens, private paths requiring redaction, or fabricated outputs.

## Known limitation

This skeleton cannot prove the verified-run story by itself.
It becomes demo evidence only after TODO slots are filled from a real local run
with matching run id, timestamps, and captured artifacts.
