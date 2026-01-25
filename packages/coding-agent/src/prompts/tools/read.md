# Read

Reads files from the local filesystem or internal URLs.

<instruction>
- Reads up to {{DEFAULT_MAX_LINES}} lines by default
- Use `offset` and `limit` for large files
- Use `lines: true` to include line numbers
- Supports images (PNG, JPG) and PDFs
- For directories, use the ls tool instead
- Parallelize reads when exploring related files
- Supports internal URLs:
  - `skill://<name>` - read SKILL.md for a skill
  - `skill://<name>/<path>` - read relative path within skill directory
  - `rule://<name>` - read rule content
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