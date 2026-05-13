# 60-90s verified-run video shot list

| Time | Shot | Proof point |
| --- | --- | --- |
| 0-8s | Title card and clean terminal | Demo states: one prompt to verified proof |
| 8-18s | Paste `raw-prompt.md` into OMK/Kimi | Single prompt starts the run |
| 18-30s | Show Kimi edit and `git diff --stat` | Real file change exists |
| 30-42s | Show premature completion blocked | OMK refuses done before evidence |
| 42-55s | Run `omk verify --run "$RUN_ID" --json` | Machine-readable evidence gate passes |
| 55-70s | Show cockpit for the same run id | Operator can inspect status and changed files |
| 70-84s | Show replay evidence/decisions | Proof is reconstructable after the run |
| 84-90s | End card with known limitation | Skeleton slots must be filled by real capture |

Recording rule: if any TODO slot is missing, keep the video labeled `draft` and do not present it as verified evidence.
