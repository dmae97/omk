# goal-diagnostics-holdout4 (blind)

Ten real failure outputs, captured by running each tool on small throwaway projects
built outside this repo (Go 1.27, Python 3.13 + pylint/flake8, Node test runner,
Perl prove, shellcheck 0.10). Created blind: the author did not read holdout1-3
fixture files or the goal-diagnostics excerpt/pattern code (spec 097).

## Sanitization
Absolute paths were rewritten to `/home/dev/project` and `/home/dev/.venv`.
No usernames, hostnames, keys, or tokens remain (grepped). Durations were kept as captured.
Every fixture is > 1,536 bytes or > 40 lines (see `sanitizedBytes` / `sanitizedLines`).

## Line numbering
`groundTruthLine` / `groundTruthLastLine` are 1-based indices into
`content.split("\n")` of the sanitized file. `groundTruthText` is that element verbatim.
`sanitizedBytes` / `sanitizedLines` are measured after trimming trailing whitespace at end of file
(UTF-8 bytes; lines = `trimmed.split("\n").length`). No ANSI escapes are present.
Extra per-entry keys `tool`, `kind`, `sha256` (of the file as committed), `linesBefore`, `tags` are informational.
`linesBefore` = `groundTruthLine - 1`.

## What counts as a "real error line"
A line that itself states what went wrong:
- tests: the assertion/exception message line (`AssertionError: ...`, `KeyError: ...`,
  Go `t.Errorf` output, `panic: ...`); for Test::More the `#   Failed test '<name>'`
  diag line; for doctest the `Failed example:` line, or an exception message inside a failure.
- build: each compiler diagnostic line (`file:line:col: message`).
- lint: diagnostics of error severity only: pylint E/F codes, shellcheck `(error)`,
  flake8 pyflakes F82x (undefined name). Style/warning/info/convention findings are noise.

Not real error lines: runner banners and status lines (`--- FAIL:`, `FAIL pkg`, `✖ name`,
`not ok N`, `ERROR: test_x`, `Dubious`), stack frames, got/expected detail lines,
runtime warnings, and end-of-run recap/statistics sections that restate earlier errors.

`groundTruthLine` is the first such line; `groundTruthLastLine` is the last such line
outside recap sections. Each label was checked by hand twice.

## Manifest fields
`kind` = difficulty types (array, computed mechanically, keyword regex `/error|fail|exception/i`):
- `a`: more than 24 lines precede `groundTruthLine`.
- `b`: some line outside `[groundTruthLine, groundTruthLastLine]` matches the keyword regex (decoys, banners, summaries, package names like `errors`).
- `c`: the `groundTruthText` line matches no keyword.
- `d`: failure details appear only in the final summary block (node dot reporter; the progress line shows only `X` marks).

`failureType` = test / build / lint. Counts: a=4, b=9, c=5, d=1.
All outputs are unedited tool output apart from path sanitization.

## Author declaration
Top-level manifest key `authorDeclaration` (not a fixture entry): "작성 전 097 spec, PR #174, 하네스 방 논의를 보지 않았음"
