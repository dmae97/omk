# Find

Fast file pattern matching that works with any codebase size.

<instruction>
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Speculatively perform multiple searches in parallel when potentially useful
</instruction>

<output>
Matching file paths sorted by modification time (most recent first). Results truncated at 1000 entries or 50KB.
</output>

<avoid>
Open-ended searches requiring multiple rounds of globbing and grepping — use Task tool instead.
</avoid>