# Neo candidate and operational boundaries

Checked 2026-09-17 against checkout `887152bc5d` and [Draft PR #35](https://github.com/dmae97/omk/pull/35).
The PR was open; this checkout had no `resources/neo/skills`, `src/core/neo`, or `neo-cli.ts` under `packages/coding-agent`.
These are dated observations, not a permanent statement about newer installations.

Local follow-up on 2026-09-17: the candidate has now been integrated into this
working tree and built. The local launcher reports six packaged skills through
`omk neo list`; clean built-loader and CLI subprocess checks passed. This is an
uncommitted local integration, not a PR merge or published release. Existing MCP
configuration was preserved. Playwright answered a read-only probe; Context7
returned an invalid API-key error. Restart OMK to load the rebuilt code.

## Check availability before commands

The [candidate commit](https://github.com/dmae97/omk/commit/493ddeb666930b32ad57dab25dc324999d3362c4)
proposes six public skills: `omk-computeruse`, `omk-browser`, `omk-site`,
`omk-research`, `omk-code-review`, and `omk-mcp-setup`.
Their proposed location is `packages/coding-agent/resources/neo/skills`.
This project-local skill update neither ships that bundle nor wires its loader.
Do not read nonexistent sibling skills or create a second copy to imply availability.

When routing a Neo task, prefer the project entry skill `omk-neo`
(`.omk/skills/omk-neo/SKILL.md`); it selects the matching workflow skill per target.
Before relying on Neo commands, inspect the installed version, its help, and the matching
[source documentation](https://github.com/dmae97/omk/blob/493ddeb666930b32ad57dab25dc324999d3362c4/packages/coding-agent/docs/neo.md).
Only in a version confirmed to implement them:

- `omk neo list` checks packaged files and offered presets, not active connections.
- `omk neo setup playwright context7` is a preview without `--apply`.
- `omk neo mcp-config playwright context7` prints inactive configuration for review.

If the commands are absent, use the live tool inventory and the installed version's
normal MCP setup documentation. Do not merge the PR, install packages, or change settings
merely to make a skill instruction executable.

## Evidence states

| Resource | State | Required evidence |
| --- | --- | --- |
| Skill | packaged | File exists in the inspected installation |
| Skill | loaded | Actual discovery/selection identifies its source path |
| MCP | offered | A preset is available, with no connection claim |
| MCP | configured | The intended config file contains the selected server |
| MCP | connected | Successful handshake and current tool list |
| MCP | verified | A scoped read-only request succeeds against the intended target |

In the candidate, `connected: null` and `connectionStatus: "not_probed"` mean unknown,
not connected. A successful setup or inventory command is not a GUI smoke test.
Same-name skills can shadow each other: inspect the selected path after resource reload.
The candidate gives user/project/explicit skills precedence over the bundle;
`noSkills` stops automatic bundle loading and `OMK_BUNDLED_SKILLS=0` disables only the bundle.
Do not assume those candidate switches exist in this checkout or every release.

## Setup only within an approved scope

The candidate offers stdio presets for `@playwright/mcp@0.0.81` and
`@upstash/context7-mcp@4.1.1`. These are candidate pins, not recommendations for the
latest versions. Direct pins do not freeze all transitive dependencies.

- Confirm the target host, versions, configuration path, permissions, and network effects.
- Candidate project config is `<cwd>/.omk/mcp.json`; global config is `~/.omk/mcp.json`,
  not `~/.omk/agent/mcp.json`. Confirm the actual loader before writing.
- `--apply` requires authorization for that scope. Setup itself does not start servers,
  but the next normal OMK start may cause `npx` to download and execute packages.
- Preserve existing config, including invalid JSON and symlinks. Do not overwrite,
  delete, or bypass a no-replace failure. Ask for a separately scoped migration if needed.
- The candidate uses `--headless --isolated --sandbox` for Playwright. Profile isolation
  is not OS/network isolation. Stop on sandbox failure; never substitute `--no-sandbox`.
- Personal Chrome sessions, native CUA, Stagehand, Browserbase, credentials, and cloud
  billing are separate choices. No skill or preset authorizes their activation.

## Verification and release claims

The September 16 record reported 13 standalone Node checks passing, but loader integration
checks were unrun and PR CI failed in the existing DAG build. Neither that failure nor a
newer main CI pass proves this unmerged candidate works. Recheck the exact revision.

For a bundle delivery task, verify actual loader discovery and name precedence, a clean
installed package and platform archives, then authorized MCP handshake/tool-list/read-only
requests and browser sandbox behavior. Report unrun checks explicitly. Packaging tests do
not establish native desktop support, model success rates, or permission enforcement.

Version changes, merge, tags, GitHub Release, and npm publishing each remain outside a
skill update. Follow repository release policy only when those actions are requested.
