# OMK Spec Constitution

**Project**: `open-multi-agent-kit`
**Current source version**: `open-multi-agent-kit@0.79.3`
**Runtime contract family**: `v1.2`
**Release channel**: `pre-1.0`
**Last updated**: 2026-06-15

## Non-Negotiable Principles

1. **Release truth is machine-checkable**
   - `package.json`, `package-lock.json`, current-version Markdown claims, runtime contract constants, schemas, changelog top entry, and release proof must agree.
   - Historical changelog and archived run artifacts may preserve old versions; current-facing docs must not.

2. **Authority is explicit and scoped**
   - Provider/runtime selection must satisfy task authority before execution.
   - API advisory runtimes stay read/review/advisory unless an explicit runtime-mode contract grants write/shell/merge authority.
   - `shadow`, `warn`, and `enforce` authority modes are staged; release gates must exercise `enforce`.

3. **Evidence before done**
   - `write`, `shell`, and `merge` turns require at least one replayable evidence gate.
   - Completion claims must reference command output, diff/patch summary, artifact, metric, review, or verify/replay proof.

4. **Health-aware routing**
   - Runtime routing must consider `health()` before execution.
   - Unavailable/auth-failed/quota-exhausted runtimes are filtered or strongly penalized.

5. **Context compaction must be effective**
   - Headroom/compaction results must feed the actual runtime context capsule, not only advisory logs.

6. **Sandbox claims remain honest**
   - OS-level sandboxing is planned and experimental only; it is not a public claim for `0.79.3`.

## Required Verification Commands

- `npm run version:check`
- `npm run lint`
- `npm run secret:scan`
- `npm run check`
- `npm run build:clean`
- `npm test`

## Documentation Scope

Current-facing Markdown includes root README/ROADMAP/MATURITY/SECURITY/CHANGELOG top entry, `docs/*.md`, and spec-kit files. Historical proof bundles, archived run artifacts, and old changelog entries may intentionally retain old version references.
