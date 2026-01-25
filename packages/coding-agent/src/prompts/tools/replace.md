# Replace

Performs string replacements in files with fuzzy whitespace matching.

<instruction>
- Use the smallest edit that uniquely identifies the change
- If `old_text` is not unique, expand to include more context or use `all: true` to replace all occurrences
- Fuzzy matching handles minor whitespace/indentation differences automatically
- Prefer editing existing files over creating new ones
</instruction>

<output>
Returns success/failure status. On success, the file is modified in place with the replacement applied. On failure (e.g., `old_text` not found or matches multiple locations without `all: true`), returns an error describing the issue.
</output>

<critical>
- You must read the file at least once in the conversation before editing. The tool will error if you attempt an edit without reading the file first.
</critical>

<bash*alternatives>
Replace is for content-addressed changes—you identify \_what* to change by its text.

For position-addressed or pattern-addressed changes, bash is more efficient:

|Operation|Command|
|---|---|
|Append to file|`cat >> file <<'EOF'`...`EOF`|
|Prepend to file|`{ cat - file; } <<'EOF' > tmp && mv tmp file`|
|Delete lines N-M|`sed -i 'N,Md' file`|
|Insert after line N|`sed -i 'Na\text' file`|
|Regex replace|`sd 'pattern' 'replacement' file`|
|Bulk replace across files|`sd 'pattern' 'replacement' **/*.ts`|
|Copy lines N-M to another file|`sed -n 'N,Mp' src >> dest`|
|Move lines N-M to another file|`sed -n 'N,Mp' src >> dest && sed -i 'N,Md' src`|

Use Replace when the _content itself_ identifies the location.
Use bash when _position_ or _pattern_ identifies what to change.
</bash_alternatives>