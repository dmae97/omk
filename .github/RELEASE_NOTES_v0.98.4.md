# OMK v0.98.4

This patch updates the provider catalog and hardens model-dispatch, metrics,
sandbox configuration, and claim-repair boundaries. The published v0.98.3
lineage is preserved.

## Highlights

- DeepSeek V4.1 Flash is available in the bundled catalog on four existing routes:

  | Provider | Model ID |
  | --- | --- |
  | DeepSeek | `deepseek-flash` |
  | OpenCode Go | `deepseek-flash` |
  | OpenRouter | `deepseek/deepseek-v4.1-flash` |
  | Vercel AI Gateway | `deepseek/deepseek-v4.1-flash` |

  All four expose text/image input and off/low/high/max thinking. Native and Go
  requests preserve explicit output limits; gateway effort uses each gateway's
  own request format. Catalog presence is not account-specific availability.
- Opt-in CLI/SDK model contracts pin logical model/provider, thinking and output
  limits. Chat Completions additionally checks the final model ID and output-limit
  field. Text-only contracted tool images become explicit uninspected-image notices
  without rewriting the stored transcript. Final CLI failures return nonzero.
- Metrics v2 writes bounded error classes instead of raw tool errors, projects known
  fields, rejects malformed records, and still reads valid v1 data.
- Empty, sparse or externally mutated gate lists cannot bypass validation. Sandbox
  overrides cannot silently downgrade enforcement or expand the filesystem root.
- Shared-DAG repair explanations account for shared repairs and local counterexamples.
  Bounded-search fallback is labeled not-proven. Strict witness grouping is opt-in;
  arbitrary group labels are not authenticated independent evidence.
- Candidate verification also fixes non-finite token counts, stable optional-context
  ordering, whitespace-invariant routing and false-positive redaction of recognized
  public code expressions. Forced persistence/report masking is not disabled.
- Previously committed CLI/provider work includes Meta/Muse Code integration, explicit
  provider synchronization, active-skill handling, clipboard and terminal-link fixes,
  and side-effect-free service-link helpers. The changelogs distinguish these from
  already released lifecycle/advisory changes.

## Compatibility and limits

All seven public packages use 0.98.4. Existing published changelog sections are retained.
The native `deepseek-v4-flash` ID remains a V4.1 compatibility alias. Static native costs
use published peak prices; they are not time-dependent billing guarantees.

Metrics consumers must recognize schema v2. Historical metrics files are not rewritten
or scrubbed. Model contracts do not attest all network destinations, provider-internal
routing, reasoning-token accounting, or billing. No new default judge, service call,
benchmark run, credential change, or current-model switch is introduced by release prep.

The model catalogs are the reviewed committed snapshot; release preparation does not
fetch or regenerate them. Private pending retry, timeout and TB audit/selection changes
are excluded from the candidate.

## Verification and publication status

See [the release audit](../packages/coding-agent/docs/release-audit-0.98.4.md) for
actual check results, artifact inventory, and remaining gates. A local check or pack is
not publication and is not a harness-performance claim.

The internal research document was removed from unpublished local history before
publication. The cleaned branch cannot reach its path or blob, its candidate tree
matches the previously verified tree, and existing public commits and tags are unchanged.
Private recovery material is kept outside the repository and is never pushed.

The existing CI workflow must validate the exact tag,
build the six platform archives, publish all seven npm packages, and create the GitHub
Release. Existing CI token authentication remains unchanged; OIDC/Sigstore provenance
is not claimed.
