# Evidence-gated coding agents

## Short answer

Evidence-gated coding means an agent cannot simply say "done." It must produce verifiable artifacts such as diffs, command output, test results, review logs, or DAG run records before a task is treated as complete.

## What does evidence-gated mean in OMK?

OMK compiles a task into a DAG, assigns scoped lanes, runs provider-specific agents, collects evidence, and writes replayable artifacts under `.omk/runs/<run-id>/`. If a required evidence gate is missing, completion is blocked instead of assumed.

## How OMK implements it

1. The user goal becomes an input envelope.
2. The envelope compiles into a DAG with lane-level acceptance and evidence expectations.
3. Lanes execute with explicit read/write/shell/merge authority.
4. Evidence is collected: command output, diff, artifact, metric, or review.
5. A verify gate checks the evidence before completion is claimed.

## Example

```bash
omk do "review this repo for release risk" --dry-run --json
```

Dry-run artifacts:

```txt
.omk/runs/<run-id>/input-envelope.json
.omk/runs/<run-id>/dag.json
.omk/runs/<run-id>/dag-compile-report.json
```

Executing the compiled DAG adds loop artifacts such as `loop-state.json` and `loop-decisions.jsonl`.

## How do I verify it locally?

```bash
npm run verify:no-kimi
npm run proof:check
```

Source-controlled proof bundles are listed in the [proof index](https://github.com/dmae97/open-multi-agent-kit/blob/main/proof/PROOF_INDEX.md).

## What this does not claim

Evidence gates do not prove a provider has write authority, do not prove a release is safe, and do not replace full CI. Safety claims are scoped to the exact adapter, command, and gate that produced them.

## Related

- [What is OMK?](../what-is-omk.md)
- [Replayable agent runs](replayable-agent-runs.md)
- [Provider routing for AI coding](provider-routing-for-ai-coding.md)
