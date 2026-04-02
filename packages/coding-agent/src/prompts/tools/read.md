Reads the content at the specified path or URL.

<instruction>
The `read` tool is a multi-purpose tool that can be used to inspect all kinds of files and URLs.
- You **MUST** parallelize reads when exploring related files

# Filesystem
- Reads up to {{DEFAULT_LIMIT}} lines by default
- Use `offset` and `limit` for large files; max {{DEFAULT_MAX_LINES}} lines per call
{{#if IS_HASHLINE_MODE}}
- If reading from FS, result will be prefixed with anchors: `41#ZZ:def alpha():`
{{else}}
  {{#if IS_LINE_NUMBER_MODE}}
- If reading from FS, result will be prefixed with line numbers: `41:def alpha():`
  {{/if}}
{{/if}}

# Inspection
When used with a PDF, Word, PowerPoint, Excel, RTF, EPUB, or Jupyter notebook file, the tool will return the extracted text.
It can also be used to inspect images.

# Directories & Archives
When used against a directory, or an archive root, the tool will return a list of directory entries within.
- Formats: `.tar`, `.tar.gz`, `.tgz`, and `.zip`.
- Use `archive.ext:path/inside/archive` to read or list archive contents

# URLs
- Extract information from web pages, GitHub issues/PRs, Stack Overflow, Wikipedia, Reddit, NPM, arXiv, technical blogs, RSS/Atom feeds, JSON endpoints
- `raw: true` for untouched HTML or debugging
- `timeout` to override the default request timeout
</instruction>

<critical>
- You **MUST** use `read` instead of bash for ALL file reading: `cat`, `head`, `tail`, `less`, `more` are FORBIDDEN.
- You **MUST** use `read` instead of `ls` for directory listings.
- You **MUST** use `read` instead of shelling out to `tar` or `unzip` for supported archive reads.
- You **MUST** always include the `path` parameter, NEVER call `read` with empty arguments `{}`.
- When reading specific line ranges, use `offset` and `limit`: `read(path="file", offset=50, limit=100)` not `cat -n file | sed`.
- You **MAY** use `offset` and `limit` with URL reads; the tool will paginate the cached fetched output.
</critical>
