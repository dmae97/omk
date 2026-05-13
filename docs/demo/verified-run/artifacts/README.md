# Artifact capture slots

This directory is intentionally empty of real proof until a verified demo run is captured.

Expected future files:

- `command-log.txt` — exact run command and environment notes, no secrets
- `generated-diff.patch` — real Kimi-generated diff
- `generated-diff.stat.txt` — diff summary
- `premature-done-block.txt` — exact evidence-gate rejection excerpt
- `verify-result.json` — real `omk verify --run "$RUN_ID" --json` output
- `cockpit-proof.png` — screenshot for the same run id
- `cockpit-proof.txt` — optional text copy of cockpit state
- `replay-proof.txt` — `omk replay "$RUN_ID" --evidence --decisions` output
- `replay-proof.png` — screenshot of replay proof
- `verified-run-demo.mp4` — final 60-90s video

Do not add fabricated sample outputs. Leave absent files absent until captured.
