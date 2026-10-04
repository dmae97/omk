# Explicit evidence-bearing AdaptOrch reviews

The `omk-adaptorch-wpl` package exports an explicit, opt-in review workflow:
`ReviewWorkflow.submit`, `resume`, and `assess`. This is separate from the CLI's
read-only advisory bridge. The bridge still cannot dispatch runs or transmit
source evidence. Existing benchmark callers must invoke this new workflow;
this patch does not automatically replace an external benchmark integration.

## What is implemented

- `buildReviewRequest` includes the selected specification, diff, test commands,
  and supplied results in each independent subtask's `description`. The current
  AdaptOrch engine reads `description`, not `subtask.prompt`. Raw `payload` is the
  authoritative MCP argument; loose `prompt`/`context` cannot supplement it.
- Two independent review subtasks are the default, with an explicit supported
  range of two to four. This increases model calls and potential cost under the
  server's existing budget. It does not guarantee different models or independent
  execution verification.
- Each reviewer is instructed to end with `FINAL: PASS` or `FINAL: FAIL`. This is
  a requested model-output convention, not enforced execution evidence or an
  approval signal. There is no output-extractor metadata consumer in the current
  engine, and the client does not invent one.
- `AdaptOrchClient.run` preserves its public camelCase API and translates it to
  actual MCP fields: `taskPayload` -> `payload`, `connector` -> `connector_name`,
  `synthesisMode` -> `synthesis_mode`, `budgetPolicy` -> `budget_policy`, and the
  wait/timeout/poll fields to snake_case. Explicit false/zero/empty payload values
  survive. Undocumented extra properties are not forwarded.
- Submission sets `wait_for_terminal: false`. `resume` polls `adaptorch_get_run`
  with a bounded deadline and exponential backoff. A timeout or read error means
  observation is incomplete, not that the remote run failed or was cancelled.
- Canonical MCP text JSON envelopes are decoded for run submission and the
  run/artifact/trace evidence reads. `isError`, invalid JSON, and ambiguous
  envelopes fail closed. Decoded evidence is preserved; callers needing the
  original transport envelope should archive it at their injected transport.

## Callable path

Supply the existing authorized MCP session's `callTool`, a private journal
folder, and only explicitly selected material approved for disclosure:

```ts
import {
  createLiveAdaptOrchClient,
  FileReviewStore,
  ReviewWorkflow,
} from "omk-adaptorch-wpl";

const workflow = new ReviewWorkflow({
  client: createLiveAdaptOrchClient(callTool),
  store: new FileReviewStore(configuredPrivateReviewDirectory),
});
const submitted = await workflow.submit(selectedReviewEvidence);
// Save/report submitted.runId. A submission_unknown result must be reconciled.
const observed = await workflow.resume(packetId, specRevision);
// After observation, assess the latest submitted evidence, not a changed packet.
const assessment = await workflow.assess(selectedReviewEvidence, authorizedTestExecutor);
```

`selectedReviewEvidence` is a `ReviewEvidenceInput`: packet ID, explicit spec
revision, 1–32 uniquely identified specification items, nonempty diff, 0–16
selected test records, and `disclosureApproved: true`. Test records bind to spec
IDs and distinguish `executed` (timestamp/exit code/output) from `not_run`
(no fabricated output/exit code). This declaration records caller-supplied
reports; it does not establish independent authenticity.

No filesystem scanning, environment collection, provider activation, credential
setup, arbitrary remote command execution, or artifact-URL fetching occurs.
Secret-pattern checks are defense in depth, not a guarantee that all sensitive
content was detected. The caller must select related evidence, redact secrets
and environment values, and obtain any required disclosure authorization.
Identifiers and transmitted metadata are scanned too.

## Bounded evidence and advisory policy

Every section carries original/included SHA-256, byte counts, and omitted-byte
counts. Limits are 768 UTF-8 bytes per spec item, 12 KiB for the diff, and 2 KiB
per test record; each description is capped at 64 KiB and selected raw input at
1 MiB. UTF-8 truncation does not split code points. A truncated JSON test record
is explicitly incomplete text, not a complete execution record. The caller
retains the complete original evidence. Omitted material is not verified.

The returned `wallMode: "soft"` describes this client's advisory-only review
policy. There is no supported per-request remote soft-wall override in the
pinned server contract, so no wire field, environment setting, authentication
setting, or security/correctness wall is changed.

All review workflow results keep `canApply: false` and `shouldSubmit: false`.
`assess` consumes the actual correctness-wall evaluator and preserves a captured
negative run snapshot: explicit `BLOCKED` rejects even if lifecycle information
is incomplete. Transport `SUCCEEDED`, `result_status: OK`, model agreement,
artifact references, and `FINAL: PASS` cannot unlock apply/submit.

## Durable admission and one missing-input retry

`FileReviewStore` stores packet/spec/diff bindings, request/evidence hashes,
attempts, admitted run IDs, and the retry counter. It reserves an attempt before
remote I/O using an exclusive lock, fsynced file, atomic rename, and revision
check. An application store may instead implement the same durable atomic
`ReviewStore` contract; an in-memory map is not sufficient for production.

A simultaneous call, restart, timeout, lost response, or uncertain persistence
result never automatically submits another paid run. A late admission response
can fill in the existing journal. If persistence fails after admission, the
returned `submission_unknown` retains the known run ID for reconciliation.
A crashed process can leave a lock or an ambiguous reserved attempt. These are
blocked for operator reconciliation, not automatically stolen or reset.
Refusal persistence is monotonic for successfully committed observations. If a
refusal cannot be stored, the current action stops and requires reconciliation;
a restart cannot recover an observation that never committed. This is a bounded
client-side admission journal, not a remote exactly-once or power-loss guarantee.

`retryMissingInput` requires all of:

1. A caller input audit with `code: MISSING_REVIEW_INPUT`,
   `source: caller_input_audit`, the original run ID, and concrete missing
   evidence section IDs
2. The original run is known terminal and the packet, specification revision,
   specification hash, diff hash, and candidate count are unchanged
3. New requested evidence bytes are actually included on the wire. Renaming an
   identical test record, changing only its timestamp, or modifying bytes beyond
   a truncation boundary does not qualify
4. No authoritative `correctness_wall.verdict: BLOCKED` has been observed for
   this review. Refusals are retained in the journal and cannot be overridden by
   a missing-input label or a later non-blocked snapshot
5. The durable per-review retry counter has not already been consumed

The one retry is reserved before submission, including across concurrency and
restart. Without new evidence, the result is `revalidation_required`.

There is no stable server missing-input reason field and no arbitrary-prose
substring parser. `get_run` does not carry final model text; the `raw_results`
artifact contains `final_output`, while `get_artifacts` returns references.
Automatic missing-input diagnosis/artifact reading is therefore not wired.
Neither a reference nor an unparsed `FINAL` claim supplies permission to retry.

## Revalidation boundary

`assess` makes unverified results reach a per-specification boundary-test plan.
Without an `AuthorizedReviewTestExecutor`, the outer state remains
`revalidation_required`; the nested plan is blocked and lists zero executions.
The application must bind its existing authorized OMK coding/test tools to
`prepare` and `execute`. This patch supplies the interface and gate, not a
hosted shell or an automatic CLI tool adapter.

The executor authorization is bound to packet, spec revision/hash, and diff hash.
It must prepare two to four distinct source-backed boundary tests for every spec
item and return actual command, output, timestamp, source hash, structured
passed/failed/skipped outcome, and assertion count for each executed case.
Missing/mismatched records, skipped tests, zero assertions, failures, and timeouts
cannot become `evidence_ready`. Source evidence and plan/receipt collections are
snapshotted across awaits. A timeout is an unknown execution outcome requiring
reconciliation, not authorization to rerun.

`evidence_ready` only means the trusted injected executor supplied complete
successful records for the declared boundary tests. It does not establish
hidden-test success, exhaustiveness, independent review approval, or permission
to apply/submit. The package performs no automatic retry from this state.

## Verification and limits

Tests use clearly labeled synthetic fixtures, mock MCP responses, temporary
filesystem journals, and injected synthetic executors. They make no paid
provider calls. The original external report and 17 result JSON files were not
available, so these tests do not reproduce those original runs.

Run the named focused tests under `packages/adaptorch-wpl`:

```sh
node ../../node_modules/vitest/dist/cli.js --run \
  test/adaptorch-review-wire.test.ts test/review-evidence.test.ts \
  test/review-workflow.test.ts test/review-poll.test.ts \
  test/review-revalidation.test.ts test/review-store.test.ts
```

This implementation requires integration with the negative semantic/default-
unverified adjudicator change. The full repository aggregate check must still
be run in a complete checkout; a partial source checkout cannot certify all
repository guards, dependency graphs, release checks, or CLI wiring.
