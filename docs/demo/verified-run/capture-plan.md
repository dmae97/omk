# Evidence capture plan

Use one real `RUN_ID` for every artifact below.

```bash
RUN_ID=<capture-run-id>
CAPTURE_ROOT=docs/demo/verified-run/artifacts
mkdir -p "$CAPTURE_ROOT"
```

## 1. Prompt and command log

- Prompt source: `docs/demo/verified-run/raw-prompt.md`
- Capture slot: `artifacts/command-log.txt`
- TODO: record the exact OMK/Kimi command used for the run.

## 2. Premature-done block

- Capture slot: `artifacts/premature-done-block.txt`
- TODO: save the exact terminal excerpt where OMK rejects completion because evidence is missing.
- Failure rule: if no block occurs, write `DEMO FAILED: no premature-done block captured` in the slot.

## 3. Verify JSON

```bash
omk verify --run "$RUN_ID" --json > "$CAPTURE_ROOT/verify-result.json"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("json ok")' "$CAPTURE_ROOT/verify-result.json"
```

- Capture slot: `artifacts/verify-result.json`
- TODO: capture only real command output.

## 4. Cockpit proof

```bash
omk cockpit --run-id "$RUN_ID" --height 24 --no-clear
```

- Screenshot capture slot: `artifacts/cockpit-proof.png`
- Optional text slot: `artifacts/cockpit-proof.txt`
- TODO: capture the cockpit view showing run state, TODO/evidence status, and changed files.

## 5. Replay proof

```bash
omk replay "$RUN_ID" --evidence --decisions > "$CAPTURE_ROOT/replay-proof.txt"
```

- Transcript slot: `artifacts/replay-proof.txt`
- Screenshot capture slot: `artifacts/replay-proof.png`
- TODO: capture replay output showing evidence/decision history for the same run.
