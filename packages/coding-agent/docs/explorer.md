# Read-only codebase explorer

`omk explore <question>` searches the current workspace **read-only** and prints a JSON
evidence pack: matching files, line ranges with reasons, what was searched, what was left
out, and which query terms matched nothing. It never writes to the workspace and never
returns whole files.

This is the producer half of read-only exploration delegation. A later step can pass the
same pack to a subagent or to the main agent's read path; the CLI is the first live call
path, so the behavior is testable end to end.

## Usage

```sh
omk explore "where does acceptance receipt reuse happen"
```

The command prints `ExplorerResult` as JSON:

```json
{
  "question": "authenticateUser zzzz",
  "files": [
    {
      "path": "src/auth.ts",
      "ranges": [{ "start": 1, "end": 5, "reason": "matched: authenticateuser" }],
      "score": 15.1
    }
  ],
  "coverage": {
    "searched": ["authenticateuser", "zzzz"],
    "visited": ["src/auth.ts"],
    "notVisited": []
  },
  "negative": ["zzzz"],
  "budget": { "filesScanned": 3, "bytesRead": 182, "truncated": false }
}
```

## What the fields mean

- `files[].path`: workspace-relative path. Paths outside the workspace are never returned.
- `files[].ranges`: 1-based inclusive line ranges with the terms that matched. At most two
  ranges per file, and each range is capped by `maxRangeLines`.
- `coverage.searched`: the query terms used after tokenizing and lowercasing.
- `coverage.visited`: every file opened, whether it matched or not.
- `coverage.notVisited`: work skipped because a cap was reached. Truncation is always
  reported, never silent.
- `negative`: query terms with no match in any scanned file. A "not found" claim is only
  meaningful together with `coverage`.
- `budget.truncated`: true whenever anything was left out.

## Budget defaults

| Option | Default | Meaning |
| --- | --- | --- |
| `maxFilesScanned` | 400 | Files opened at most |
| `maxBytesPerFile` | 65536 | Bytes read per file |
| `maxFilesReturned` | 6 | Files returned |
| `maxRangesTotal` | 12 | Ranges across all files |
| `maxRangeLines` | 40 | Lines in one range |
| `contextLines` | 3 | Context lines on each side of a match |

`.git`, `node_modules`, `dist`, `vendor`, `coverage`, and `.omk` directories are skipped,
as are binary files and files without a common source or text extension.

## Ranking

Search runs through ripgrep when it is available, honoring `.gitignore` and skip globs for
`node_modules`, `dist`, `vendor`, `coverage`, and `.omk`. Without ripgrep, a pure-Node walk
is the fallback. The read and range budgets apply after that search, so a large repository
does not turn into thousands of file reads.

Files score by matched term count, a path-hint bonus, and capped match frequency. A
definition in source outranks the same term in documentation or a test reference, so
`.md` files and `*.test.*`/`*.spec.*` files are penalized rather than allowed to dominate
the top of the list. Results are deterministic for the same question and budget.

## Next steps

- Delegate the same exploration to a read-only subagent with the same schema, with an
  in-process fallback when the extension is unavailable.
- Feed ranges into the main read path instead of whole files, and re-check the range
  before any edit. Line numbers are hints, not proof; the main agent re-reads before it
  changes code.
