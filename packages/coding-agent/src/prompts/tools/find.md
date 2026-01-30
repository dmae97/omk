# Find

Fast file pattern matching that works with any codebase size.

<instruction>
- Pattern includes the search path: `src/**/*.ts`, `lib/*.json`, `**/*.md`
- Simple patterns like `*.ts` automatically search recursively from cwd
- Includes hidden files by default (use `hidden: false` to exclude)
- Speculatively perform multiple searches in parallel when potentially useful
</instruction>

<output>
Matching file paths sorted by modification time (most recent first). Results truncated at 1000 entries or 50KB (configurable via `limit`).
</output>

<avoid>
Open-ended searches requiring multiple rounds of globbing and grepping — use Task tool instead.
</avoid>