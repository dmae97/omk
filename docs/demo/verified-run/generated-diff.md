# Generated diff capture slot

Expected future file: `artifacts/generated-diff.patch`

## Capture rules

1. Run the raw prompt in a disposable branch/worktree.
2. Before manual cleanup, save Kimi's generated diff:

```bash
git diff --binary > docs/demo/verified-run/artifacts/generated-diff.patch
git diff --stat > docs/demo/verified-run/artifacts/generated-diff.stat.txt
```

3. If the diff contains secrets or private data, discard the run and recapture with a safe fixture. Do not hand-edit a proof patch.
4. Record metadata only after the real patch exists.

## Metadata placeholder

| Field | Value |
| --- | --- |
| Run id | TODO: capture |
| Branch/worktree | TODO: capture |
| Diff path | `docs/demo/verified-run/artifacts/generated-diff.patch` |
| Diff stat path | `docs/demo/verified-run/artifacts/generated-diff.stat.txt` |
| SHA-256 | TODO: capture after file exists |
| Capture time | TODO: capture |
