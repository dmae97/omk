# OMK v2.0.3

OMK 2.0.3 improves skill selection, next-task suggestions, and the terminal status display. The standalone archives now include the OpenTUI runtime for their target platform.

## Terminal and next-task suggestions

- The built-in footer and `Ctrl+O` control pane can use OpenTUI. The pinned rail fits from 108 columns by 16 rows, `Ctrl+Q` saves the user's choice, and `/debug` reports the selected renderer and its current state. Extension footers and unsupported runtimes retain their native rendering. The standalone build uses Bun 1.3.14, the minimum version needed for its OpenTUI worker (#507, #509).
- `OMK_NEXT_SUGGESTIONS` remains off by default. When enabled, it shows one short next request, leaves the editor empty on a failed or empty response, and drops stale replies. Accepting with Tab does not send the request. Selecting a skill from autocomplete keeps the draft editable rather than submitting it (#506).

## Skills and packages

- Skill auto-loading respects Markdown sections without filling unused slots with more skills from the same section. The section report stays out of model requests and summaries. With context budgeting enabled, a short follow-up without its own skill signal can use the two previous user prompts when ranking skills (#497).
- Install and update reapply reviewed repairs to the exact supported native packages, `pi-subagents` 0.78.0 and `@aeondave/pi-skill-optimizer` 3.1.2. Legacy manifests are not converted (#510).

## Reliability

- A provider-rejected OAuth token can be refreshed and retried once before response events are forwarded. A directory of unrelated files under `tools/` no longer triggers the legacy-tools warning (#494).
- Verified runs handle group-write bits inherited from umask 002 without widening file modes that Git cannot represent. The npm publish job checks token eligibility before publishing (#495, #496).

All eight public npm packages move to 2.0.3 in lockstep. See [the coding-agent changelog](../packages/coding-agent/CHANGELOG.md#203---2026-11-22) for details.
