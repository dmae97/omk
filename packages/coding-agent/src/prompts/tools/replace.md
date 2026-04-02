Performs string replacements in files with fuzzy whitespace matching.

<instruction>
- You **MUST** use the smallest edit that uniquely identifies the change
- If `old_text` not unique, you **MUST** expand to include more context or use `all: true` to replace all occurrences
- Fuzzy matching handles minor whitespace/indentation differences automatically
- You **SHOULD** prefer editing existing files over creating new ones
{{#if editManageImportsEnabled}}
- `imports` is **OPTIONAL**. Use it when the replacement introduces code that needs imports/includes.
- Each `imports` entry starts with `from` and **MAY** include named `imports`, `default`, `namespace`, `alias`, or `system`.
- Import management runs after the main replacement, so use `new_text` for the code change and `imports` for declarations to merge or add.
{{/if}}
</instruction>

<parameters>
```ts
type T = {
  path: string;
  old_text: string;
  new_text: string;
  all?: boolean;
{{#if editManageImportsEnabled}}
  imports?: Array<{
    from: string;
    imports?: string[];
    default?: string;
    namespace?: string;
    alias?: string;
    system?: boolean;
  }>;
{{/if}}
};
```
</parameters>

<output>
Returns success/failure status. On success, file modified in place with replacement applied. On failure (e.g., `old_text` not found or matches multiple locations without `all: true`), returns error describing issue.
</output>

<critical>
- You **MUST** read the file at least once in the conversation before editing. Tool errors if you attempt edit without reading file first.
</critical>

{{#if editManageImportsEnabled}}
<example name="typescript-helper">
```json
{
  "path": "src/widget.ts",
  "old_text": "return value;",
  "new_text": "return formatValue(value);",
  "imports": [
    {
      "from": "./format",
      "imports": ["formatValue"]
    }
  ]
}
```
`imports` are merged after `new_text` is written, so existing imports stay canonical and only missing ones are added.
</example>

<example name="namespace-import">
```json
{
  "path": "src/widget.ts",
  "old_text": "uuid()",
  "new_text": "crypto.randomUUID()",
  "imports": [
    {
      "from": "node:crypto",
      "namespace": "crypto"
    }
  ]
}
```
Use only supported fields: `from`, optional `imports`, `default`, `namespace`, `alias`, and `system`.
</example>
{{/if}}

<bash-alternatives>
Replace for content-addressed changes—you identify _what_ to change by its text.

For position-addressed or pattern-addressed changes, bash more efficient:

|Operation|Command|
|---|---|
|Append to file|`cat >> file <<'EOF'`…`EOF`|
|Prepend to file|`{ cat - file; } <<'EOF' > tmp && mv tmp file`|
|Delete lines N-M|`sed -i 'N,Md' file`|
|Insert after line N|`sed -i 'Na\text' file`|
|Regex replace|`sd 'pattern' 'replacement' file`|
|Bulk replace across files|`sd 'pattern' 'replacement' **/*.ts`|
|Copy lines N-M to another file|`sed -n 'N,Mp' src >> dest`|
|Move lines N-M to another file|`sed -n 'N,Mp' src >> dest && sed -i 'N,Md' src`|

Use Replace when _content itself_ identifies location.
Use bash when _position_ or _pattern_ identifies what to change.
</bash-alternatives>
