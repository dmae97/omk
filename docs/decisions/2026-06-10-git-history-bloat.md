# Decision: Git history bloat — defer rewrite, apply linguist-vendored interim

- Date: 2026-06-10
- Status: Accepted (interim mitigation only; rewrite deferred pending owner approval)

## Problem

The repository pack is far larger than the working tree:

- `git count-objects -vH` → `size-pack: 80.19 MiB`
- Tracked worktree content ≈ 27 MiB

The gap is caused by large binary blobs (GIF/MP4/PNG/PPTX) committed and later
replaced/removed, which remain in history forever.

## Evidence: top-10 largest blobs

Command:

```bash
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | sort -k3 -rn | head -10
```

Output (2026-06-10):

```text
blob f2aa8c50905967a71bab34b5045406ed668b3a1c 29252458 readmeasset/kimicat.gif
blob fee8957c9ff26f7243d375f919c6cba5fa53ca3d 18261906 readmeasset/oneprompt.mp4
blob 8ff0eb7cc1fa08c49fe51ade9dc016fb81f31cd7 10528089 readmeasset/kimicat.gif
blob c4fea42c159c57e82f64e274335b9829ea1e8dbe 7016890 readmeasset/oneprompt.gif
blob e1aa1c049e1444d250da52202944d6f8ef1aed9f 3643625 EGG_PEAK_IR_Malgun_Gothic_FIXED_TRUE_ANIM.pptx
blob f6097940de448e09de07e9b949f6caab13fec433 3041622 readmeasset/kimicat.mp4
blob 5f671d8ac6c8a6011891164a0bdfa84ea7733749 2802989 readmeasset/kimicat.mp4
blob 75169d7c30c48b552c621c2f23779d6354974e9f 1849634 kimichan.png
blob 8edbf5a56bf456284bbd8fb5aa580245684d72e0 1708509 readmeasset/kimicat.png
blob 13a70fc8e0a35e20c1967b0306b29540bfb75b88 1522325 readmeasset/kimicat.png
```

The top 4 blobs alone account for ~65 MB of the 80.19 MiB pack.

## Decision

1. **No history rewrite now.** A `git filter-repo` rewrite of the blobs above
   would shrink the pack to roughly worktree scale, but it rewrites every
   commit hash, **invalidates all existing clones, forks, and open PRs**, and
   requires a coordinated force-push. Execute it ONLY with explicit owner
   approval and a scheduled migration window.
2. **Interim mitigation:** mark the intentionally hand-written template JS
   under `templates/web-bridge/chrome-extension/**` as `linguist-vendored` in
   `.gitattributes` so language stats and code-scanning surfaces stay clean.
   `dist/` and `coverage/` remain git-ignored (already present in `.gitignore`).

## Follow-up (requires owner approval)

- `git filter-repo --strip-blobs-bigger-than 1M` (or an explicit path list for
  `readmeasset/` historical media + the stray `.pptx`/`.png`), then force-push
  and re-clone guidance for all contributors.
- Move future README media to GitHub release assets or an external CDN instead
  of committing binaries.
