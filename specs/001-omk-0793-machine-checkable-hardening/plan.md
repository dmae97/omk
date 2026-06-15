# Implementation Plan: OMK 0.79.3 Machine-Checkable Hardening

**Spec**: `./spec.md`
**Date**: 2026-06-15
**Package Version**: `open-multi-agent-kit@0.79.3`
**Runtime Contract Family**: `v1.2`

## Summary

Update OMK's spec-kit, docs, runtime gates, and tests so release truth, authority, evidence, health-aware routing, decision tracing, and headroom compaction are enforced by code and verified by commands rather than only documented as claims.

## Runtime / Authority Plan

| Lane | Runtime mode | Authority | Health gate | Evidence gate |
|------|--------------|-----------|-------------|---------------|
| Docs/spec sync | local edit | write/patch | repo writable | diff/summary |
| Version truth | local Node script | shell | node/npm available | command-pass |
| Native turn safety | runtime tests | write/shell metadata only | test runtime available | command-pass |
| Router health | runtime router | selected runtime capability | `health()` available or default healthy | decision trace |
| Headroom | context broker/runner | context-only | compactor available or fallback | command-pass |

## Files Expected

- `.speckit/config.yaml` — spec-kit project config
- `specs/constitution.md` — project spec constitution
- `specs/templates/{spec-template.md,plan-template.md,tasks-template.md}` — current feature templates
- `specs/001-omk-0793-machine-checkable-hardening/{spec.md,plan.md,tasks.md}` — active hardening feature
- `ROADMAP.md`, `docs/*.md`, `.omk/specs/native-orchestrator-phase1/*.md` — current-facing docs synced to `0.79.3` reality
- `src/**`, `test/**` — runtime/test changes for machine-checkable gates

## Quality Gates

- `npm run version:check`
- `npm run lint`
- `npm run secret:scan`
- `npm run check`
- `npm run build:clean`
- `npm test`

## Safety Notes

- Historical Markdown under `.omk/runs`, `.omk/goals`, `.omk/worktrees`, and old changelog sections may preserve old claims as evidence; do not rewrite them as current docs.
- OS-level sandboxing remains not claimed.
