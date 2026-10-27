# Spec 098: Raw-output recall for failing acceptance checks

Status: implemented behind a flag, not measured. Base: `origin/main` `29933049fe`.
Owner: Harness Engineer. Reviewer: Tech Lead. Research input: Agent Researcher design draft (098).
Flag: `OMK_GOAL_OUTPUT_RECALL=1` (default off; off = exactly current `main` behavior).
New dependencies: 0.

## 1. Problem (verified in source at `29933049fe`)

- The settled-turn follow-up for a failing acceptance check
  (`core/extensions/builtin/goal-controller-acceptance.ts`, `settle()`) tells the model
  ``Run it to see the output, fix the cause, and end your turn when it passes.``
  The model never sees the check's output; it must re-run the command only to read it.
- `GoalAcceptanceResult.outputTail` (last 2,000 chars) only goes to `ctx.ui.notify`.
- The verified-bash receipt keeps the last 64 KiB; it is not the full output and
  is the completion evidence, so 098 must not change it.

Excerpt rules (094→097) keep missing the cause on new holdouts (severity-blind
lint lines, summaries taking the last window). 098 keeps the full raw output
on disk and points the model at it, so the excerpt becomes a hint.

## 2. Change (flag on)

1. **Artifact.** The acceptance check's combined output (the same `onData` stream
   that feeds the receipt) is also streamed to
   `<cwd>/.omk/goals/recall/acceptance-<goalId>-<round>-<rev>-<attempt>.log`
   in every mode (dir 0700 with a `*` `.gitignore`, file 0600, `flag: "wx"`).
   - Why not `<session>.artifacts/`: the real `read` tool opens a session-dir path
     only without a loadout policy; a workspace-scoped loadout (`readSet: ["."]`)
     blocks it (`Read blocked by active loadout policy`). `.omk/goals` is inside
     the workspace and already excluded from the goal workspace fingerprint, so a
     recall file never makes a receipt stale.
   - `<attempt>` grows per (goal, round, revision) and is never reused, so a
     re-run (for example `/goal verify` then the settled-turn check) keeps both.
2. **Bytes cap 4 MiB.** Over the cap the file keeps the first 1 MiB and the last
   3 MiB with one `[omk: N bytes elided]` line in between.
3. **Count cap.** Per goal the latest 3 artifacts, per recall dir 20; oldest
   first. Files are not tied to the session lifetime; the caps bound them, and
   clearing or replacing a goal deletes all of that goal's recall files (in any
   flag state, so files from an earlier flag-on run do not linger).
4. **Abort / runner error.** The partial file is deleted and no reference is given.
5. **Follow-up** (replaces the `Run it to see the output` sentence):
   ```
   Acceptance check `<cmd>` <failure> (<receipt>).
   Diagnostic hint (may be incomplete):
   <last ≤1.5 KB of the cleaned output>
   Full output: <path> (<lines> lines, <size>; complete | middle elided N bytes)
   Read ranges with read(path, offset, limit) instead of re-running the check to see output.
   Fix the cause, then end your turn; the check re-runs automatically.
   ```
   The path is relative to cwd and inside the workspace, so `read` can open it.
   If the artifact could not be written, the follow-up falls back to the `main` text.
6. **Trace.** The `goal_verification` entry gets `outputArtifact: { sha256, bytes,
   lines, complete, elidedBytes, elidedRatio }`, and the next check's entry gets
   `priorRecall: { readAfterFollowUp, readCalls }` (the model's `read` calls on the
   recall path named in the last follow-up, seen via `tool_call`; the handler is
   registered only with the flag on). `readCalls`/`readAfterFollowUp` are the
   primary metric: exactly a `read` tool call on that path. `priorRecall.otherAccessCalls`
   counts, for reference only, a `grep` tool call on that path or a bash command
   running grep/rg/cat/sed that names it; it never changes the primary fields.
   Counts, booleans and a digest only, 0 bytes of raw text.
7. **Separation.** The artifact is diagnostic only. Completion and evidence still
   come from the receipt alone. No redaction is applied and none is claimed.

## 2a. Security warning

Since 1.5.5 no redaction runs on bash or log output. A recall file is the check's
output **verbatim**, so it can contain secrets (tokens, keys, connection strings)
that the check printed. Mitigations: the file stays inside the workspace's
`.omk/goals/recall/` with 0700/0600 modes and a `*` `.gitignore`, it is never
copied into the trace, and the flag is off by default. It does not stop the model
from reading the secret (it could already see it by re-running the check), and it
does not protect against tools that ignore `.gitignore` (archives, backups, sync).

## 3. Invariants

1. Flag off: no file is written, the follow-up and the `goal_verification` entry
   are byte-identical to `main` (test).
2. Receipt bytes, receipt policy id and gate decisions are unchanged in both arms.
3. No raw output text in session entries or traces.
4. No new tool; `read` (offset/limit) and `grep` are reused.

## 4. Tests

- Artifact unit: complete file, 4 MiB cap with head/tail + marker and ratio, 0600/0700,
  `wx`, abort deletes, per-goal and per-dir count caps, attempt numbers never reused.
- Real `read` tool opens the recall path with and without a workspace loadout policy.
- Re-run in the same round/revision keeps both files; `priorRecall` counts only `read` calls on the recall path.
- `otherAccessCalls` counts grep tool / bash grep|rg|cat|sed on the path, ignores other files,
  other commands and the directory, and leaves `readCalls`/`readAfterFollowUp` unchanged.
- Clearing a goal, and replacing it, leaves 0 recall files for it.
- In a git repo (main's goal state ignored by the repo), recall files leave
  `git status --porcelain --untracked-files=all` empty via the recall dir's own `*` `.gitignore`.
- Controller: flag off follow-up byte-identical to `main`; flag on follow-up has
  the path, counts, hint, no `Run it to see the output`; the file content equals
  the command output; trace has sha256/counts and no raw text.

## 5. Not in scope / open

- The 097 two-window excerpt is not on `main`; the hint is the cleaned output tail
  until a v3 excerpt lands.
- Metrics (cause-acquired rate, duplicate re-runs) need the offline replay and a
  paid pilot; the cap values (4 MiB, 1:3, 3/20) are unmeasured defaults.
- bash tool spill cleanup (`omk-bash-*.log`) is a separate issue.
