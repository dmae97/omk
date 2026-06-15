# Implementation Plan: [FEATURE]

**Spec**: `[link]`
**Date**: [DATE]
**Package Version**: `open-multi-agent-kit@0.79.3`
**Runtime Contract Family**: `v1.2`

## Summary

[One-paragraph approach.]

## Runtime / Authority Plan

| Lane | Runtime mode | Authority | Health gate | Evidence gate |
|------|--------------|-----------|-------------|---------------|
| Explore | advisory API or local read | read | available | summary |
| Implement | authority-capable CLI/runtime | write/patch | available + auth/model/quota ok | diff/summary |
| Verify | local commands | shell | local toolchain ok | command-pass |
| Review | advisory or reviewer runtime | review/read | available | review-pass |

## Context Plan

- Keep context capsules bounded.
- If headroom compaction triggers, the compacted capsule must be the effective runtime payload.
- Do not store secrets, raw `.env`, private tokens, or unredacted provider config.

## Files Expected

- `[path]` — [purpose]

## Quality Gates

- `npm run version:check`
- `npm run lint`
- `npm run secret:scan`
- `npm run check`
- `npm run build:clean`
- `npm test`

## Rollback / Safety

- [Rollback instructions]
- [Known risks]
