Reads files using syntax-aware chunks.

<instruction>
## Parameters
- `path` -- file path or URL; may include `:selector` suffix as an alternative to `sel`
- `sel` -- optional selector (see table below)
- `timeout` -- seconds, for URLs only

## Selectors

|Input|Behavior|
|---|---|
|_(omitted)_|Render the file root chunk|
|`class_Foo`|Read a chunk by path|
|`class_Foo.fn_bar`|Read a nested chunk path|
|`L50` or `L50-L120`|Absolute file line range|
|`raw`|Read full raw file content (no chunk rendering)|

Each anchor line shows `<:name#CCCC>` or `<.name#CCCC>` — `#CCCC` is the edit checksum. Copy it when editing with `chunk-edit`.

If `path:chunk` and `sel` are both provided, `sel` wins. Missing chunk paths return `[Chunk not found]`.

Code rows use **absolute file line numbers** in the gutter. `chunk-edit` `line`/`end_line` use those same numbers.

## Examples

`read(path="src/math.ts")`

```text
   │ src/math.ts  ·  120ln  ·  ts  ·  #A744
   │

 5 │ export function sum(values: readonly number[]): number {
   │ <:sum#3286>
 6 │   return values.reduce((total, value) => total + value, 0);
 7 │ }

10 │ export class Calculator {
   │ <:Calculator#5D36>
11 │   multiply(left: number, right: number): number {
   │   <.multiply#B592>
12 │     return left * right;
13 │   }
14 │ }
```

## Language Support

Chunk trees: JavaScript, TypeScript, TSX, Python, Rust, Go. Others use blank-line fallback.
</instruction>

<critical>
- **MUST** use `read` instead of shell commands for file reading.
- **MUST** copy the current checksum before editing a chunk with `chunk-edit`.
- **MUST NOT** assume chunk names; always read the current output first.
</critical>
</output>
