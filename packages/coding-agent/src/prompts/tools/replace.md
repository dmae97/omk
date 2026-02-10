# Edit (Replace)

String replacements in files with fuzzy whitespace matching.

<instruction>
- Use smallest edit that uniquely identifies change
- If `old_text` not unique, expand to include more context or use `all: true` to replace all occurrences
- Fuzzy matching handles minor whitespace/indentation differences automatically
- Prefer editing existing files over creating new ones
</instruction>

<output>
Returns success/failure status. On success, file modified in place with replacement applied. On failure (e.g., `old_text` not found or matches multiple locations without `all: true`), returns error describing issue.
</output>

<critical>
- Must read file at least once in conversation before editing. Tool errors if you attempt edit without reading file first.
</critical>

<bash*alternatives>
Replace for content-addressed changes—you identify \_what* to change by its text.

For position-addressed or pattern-addressed changes, bash more efficient:

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

Use Replace when _content itself_ identifies location.
Use bash when _position_ or _pattern_ identifies what to change.
</bash_alternatives>