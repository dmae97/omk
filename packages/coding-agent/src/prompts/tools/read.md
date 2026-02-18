# Read

Reads files from local filesystem or internal URLs.

<instruction>
- Reads up to {{DEFAULT_MAX_LINES}} lines default
- Use `offset` and `limit` for large files
{{#if IS_HASHLINE_MODE}}
- Text output is hashline-prefixed: `LINE:HASH|content`
{{else}}
{{#if IS_LINE_NUMBER_MODE}}
- Text output is line-number-prefixed
{{else}}
- Text output is plain (no line prefixes)
{{/if}}
{{/if}}
- Supports images (PNG, JPG) and PDFs
- For directories, returns formatted listing with modification times
- Parallelize reads when exploring related files
- Supports internal URLs:
  - `skill://<name>` - read SKILL.md for a skill
  - `skill://<name>/<path>` - read relative path within skill directory
  - `rule://<name>` - read rule content
  - `memory://root` - read memory summary (`memory_summary.md`)
  - `memory://root/<path>` - read relative path within project memory root
  - `agent://<id>` - read agent output artifact
  - `agent://<id>/<path>` or `agent://<id>?q=<query>` - extract JSON from agent output
</instruction>

<output>
- Returns file content as text
- Images: returns visual content for analysis
- PDFs: returns extracted text
- Missing files: returns closest filename matches for correction
- Internal URLs: returns resolved content with pagination support
</output>