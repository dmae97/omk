# Output

Retrieves complete output from background tasks spawned with the Task tool.

<conditions>
- Task tool returns truncated preview with "Output truncated" message
- You need full output to debug errors or analyze detailed results
- Task tool's summary shows substantial line/character counts but preview is incomplete
- You're analyzing multi-step task output requiring full context
</conditions>

<parameters>
- `ids`: Array of output IDs from Task results (e.g., `["ApiAudit", "DbAudit"]`)
- `format` (optional):
	- `"raw"` (default): Full output with ANSI codes preserved
	- `"json"`: Structured object with metadata
	- `"stripped"`: Plain text with ANSI codes removed for parsing
- `query` (optional): jq-like query for JSON outputs (e.g., `.endpoints[0].file`)
- `offset` (optional): Line number to start reading from (1-indexed)
- `limit` (optional): Maximum number of lines to read

Use offset/limit for line ranges to reduce context usage on large outputs. Use `query` for structured agent outputs (agents that call `complete` with `output`).
</parameters>

<output>
Returns the requested task output content:
- `raw`: Full output text with ANSI escape codes intact
- `json`: Structured object with metadata (status, timing, structured data from `complete`)
- `stripped`: Plain text with ANSI codes removed for easier parsing

Output is truncated after 50KB.
</output>

<example name="query syntax">
For agents returning structured data via `complete`, use `query` to extract fields:
```
# Given output: { properties: { endpoints: { elements: { properties: { file, line, hasAuth } } } } }

.endpoints                    # Get all endpoints array
.endpoints[0]                 # First endpoint object
.endpoints[0].file            # First endpoint's file path
.endpoints[0]["hasAuth"]      # Bracket notation (equivalent to .hasAuth)
```

Query paths:
- `.foo` - property access
- `[0]` - array index
- `.foo.bar[0].baz` - chained access
- `["special-key"]` - properties with special characters
</example>

<avoid>
- Using when Task preview already shows complete output (no truncation indicator)
- Using when summary alone answers your question
</avoid>
