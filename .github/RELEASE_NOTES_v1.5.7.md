# OMK v1.5.7

OMK 1.5.7 is a patch release. It adds three opt-in harness features, all off by
default, plus a bash output fix and a package metadata fix. With every new flag
off, behavior is the same as 1.5.6.

## Opt-in features (default off)

- **Edit diagnostics (`OMK_EDIT_DIAGNOSTICS`).** Structured diagnostics after
  `edit` and `write`. Skipped when remote `operations` are passed (#250).
- **Head plus tail bash output (`OMK_EXEC_TRUNCATE_MIDDLE`).** Long bash output
  keeps both the start and the end (#246).
- **JSON session info (`OMK_JSON_SESSION_INFO`).** Adds a `session_info` line to
  JSON output (#244).

## Fixed

- **Bash long-line tail.** Output keeps the full 50KB tail when one long line
  spans several chunks (#238).
- **book-to-skill `bin` path** normalized to `dist/cli.js` (#248).

## Tooling and docs

- ATIF trajectory exporter for bench runs, including seq 2+ session-info lines
  (#239, #251).
- Specs 113 and 114 added, not implemented (#245, #249).
- `AGENTS.md` records autonomous mode and the patch-release order (#241, #247).

## Not yet measured

- There is no on/off benchmark for any of the three new flags yet.
