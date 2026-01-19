Performs string replacements in files with fuzzy whitespace matching.

Usage:
- Use the smallest edit that uniquely identifies the change. To toggle a checkbox: `- [ ] Task` → `- [x] Task`, not the entire line.
- If the old text is not unique, expand the replacement to a larger block (function/class/section) so it is unique.
- You must use your read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- Fuzzy matching handles minor whitespace/indentation differences automatically - you don't need to match indentation exactly.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.

## When to use bash instead

Edit is for content-addressed changes—you identify *what* to change by its text.

For position-addressed or pattern-addressed changes, bash is more efficient:

| Operation | Command |
|-----------|---------|
| Append to file | `cat >> file <<'EOF'`...`EOF` |
| Prepend to file | `{ cat - file; } <<'EOF' > tmp && mv tmp file` |
| Delete lines N-M | `sed -i 'N,Md' file` |
| Insert after line N | `sed -i 'Na\text' file` |
| Regex replace | `sd 'pattern' 'replacement' file` |
| Bulk replace across files | `sd 'pattern' 'replacement' **/*.ts` |
| Copy lines N-M to another file | `sed -n 'N,Mp' src >> dest` |
| Move lines N-M to another file | `sed -n 'N,Mp' src >> dest && sed -i 'N,Md' src` |

Use Edit when the *content itself* identifies the location.
Use bash when *position* or *pattern* identifies what to change.
