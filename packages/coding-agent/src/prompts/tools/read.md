Reads files from local filesystem, supported archives, or internal URLs.

<instruction>
- Reads up to {{DEFAULT_LIMIT}} lines default
- Use `offset` and `limit` for large files; max {{DEFAULT_MAX_LINES}} lines per call
{{#if IS_HASHLINE_MODE}}
- Filesystem output is CID prefixed: `LINE#ID:content`
{{else}}
{{#if IS_LINE_NUMBER_MODE}}
- Filesystem output is line-number-prefixed
{{/if}}
{{/if}}
- Supports images (PNG, JPG) and PDFs
- For directories, returns formatted listing with modification times
- Supports `.tar`, `.tar.gz`, `.tgz`, and `.zip` archives
- Use `archive.ext:path/inside/archive` to read or list archive contents
- Parallelize reads when exploring related files
</instruction>

<output>
- Returns file content as text; images return visual content; PDFs return extracted text; archive roots behave like directories
- Missing files: returns closest filename matches for correction
</output>

<critical>
- You **MUST** use `read` instead of bash for ALL file reading: `cat`, `head`, `tail`, `less`, `more` are FORBIDDEN.
- You **MUST** use `read(path="dir/")` instead of `ls dir/` for directory listings.
- You **MUST** use `read(path="archive.zip:path/to/file")` instead of shelling out to `tar` or `unzip` for supported archive reads.
- You **MUST** always include the `path` parameter — NEVER call `read` with empty arguments `{}`.
- When reading specific line ranges, use `offset` and `limit`: `read(path="file", offset=50, limit=100)` not `cat -n file | sed`.
</critical>
