Edits files via syntax-aware chunks. Run `read(path="file.ts")` first. The edit selector is a chunk path, optionally qualified with a region.

<rules>
- **MUST** `read` first. Never invent chunk paths or CRCs. Copy them from the latest `read` output or edit response.
- `sel` format:
  - insertions: `chunk` or `chunk@region`
  - replacements: `chunk#CRC` or `chunk#CRC@region`
- Without a `@region` it defaults to the entire chunk including leading trivia. Valid regions: `head`, `body`, `tail`, `decl`.
- If the exact chunk path is unclear, run `read(path="file", sel="?")` and copy a selector from that listing.
{{#if chunkAutoIndent}}
- Use `\t` for indentation in `content`. Write content at indent-level 0 — the tool re-indents it to match the chunk's position in the file. For example, to replace `@body` of a method, write the body starting at column 0:
  ```
  content: "if (x) {\n\treturn true;\n}"
  ```
  The tool adds the correct base indent automatically. Never manually pad with the chunk's own indentation.
{{else}}
- Match the file's literal tabs/spaces in `content`. Do not convert indentation to canonical `\t`.
- Write content at indent-level 0 relative to the target region. For example, to replace `@body` of a method, write:
  ```
  content: "if (x) {\n  return true;\n}"
  ```
  The tool adds the correct base indent automatically, then preserves the tabs/spaces you used inside the snippet. Never manually pad with the chunk's own indentation.
{{/if}}
- `@region` only works on container chunks (classes, functions, impl blocks, sections). Do **not** use `@head`/`@body`/`@tail` on leaf chunks (enum variants, fields, single statements) — use the whole chunk instead.
- `replace` requires the current CRC. Insertions do not.
- **CRCs change after every edit.** Always use the selectors/CRCs from the most recent `read` or edit response. Never reuse a CRC from a previous edit.
</rules>

<critical>
You **MUST** use the narrowest region that covers your change. Replacing without a region replaces the **entire chunk including leading comments, decorators, and attributes** — omitting them from `content` deletes them.

**`replace` is total, not surgical.** The `content` you supply becomes the *complete* new content for the targeted region. Everything in the original region that you omit from `content` is deleted. Before replacing `@body` on any chunk, verify the chunk does not contain children you intend to keep. If a chunk spans hundreds of lines and your change touches only a few, target a specific child chunk — not the parent.

**Group chunks (`stmts_*`, `imports_*`, `decls_*`) are containers.** They hold many sibling items (test functions, import statements, declarations). Replacing `@body` on a group chunk replaces **all** of its children. To edit one item inside a group, target that item's own chunk path. If no child chunk exists, use the specific child's chunk selector from `read` output — do not replace the parent group.
</critical>

<regions>
```
  @head ··· ┊ /// doc comment
          · ┊ #[attr]
  @decl ··· ┊ fn foo(x: i32) {
   @body ·· ┊     body();
   @tail ·· ┊ }
```
- `@body` — the interior only. **Use for most edits.**
- `@head` — leading trivia + signature + opening delimiter.
- `@tail` — the closing delimiter.
- `@decl` — everything except leading trivia (signature + body + closing delimiter).
- *(no region)* — the entire chunk including leading trivia. Same as `@head` + `@body` + `@tail`.

**`@decl` excludes leading trivia** (doc comments, decorators, attributes). In Rust, `#[attr]` is trivia; in Python, `@decorator` is trivia; in TypeScript, JSDoc + decorators are trivia. To modify attributes or decorators, target `@head` instead. Including them in `@decl` replacement content **will duplicate them** because the original trivia is preserved.

For leaf chunks (fields, variants, single-line items), `@body` falls back to the full chunk.

In TypeScript, if a doc comment or decorator is separated from the function by a blank line, it may appear as its own orphan `chunk` node instead of being absorbed into the function's `@head`. Use the `?` selector (`read(path="file", sel="?")`) to discover the actual chunk layout before editing.

`append`/`prepend` without a `@region` inserts _outside_ the chunk. To add children _inside_ a class, struct, enum, or function body, use `@body`:
- `class_Foo@body` + `append` → adds inside the class before `}`
- `class_Foo@body` + `prepend` → adds inside the class after `{`
- `class_Foo` + `append` → adds after the entire class (after `}`)
</regions>

<ops>
|op|sel|effect|
|---|---|---|
|`replace`|`chunk#CRC(@region)?`|rewrite the addressed region|
|`before`|`chunk(@region)?`|insert before the region span|
|`after`|`chunk(@region)?`|insert after the region span|
|`prepend`|`chunk(@region)?`|insert at the start inside the region|
|`append`|`chunk(@region)?`|insert at the end inside the region|
</ops>

<examples>
Given this `read` output for `example.ts`:
```
  | example.ts·34L·ts·#QBMH
  |
  | [<interface_Config#BWTR>]
 1| interface Config {
  | 	[<interface_Config.field_host#TTMN>]
 2| 	host: string;
  | 	[<interface_Config.field_port#QSMH>]
 3| 	port: number;
  | 	[<interface_Config.field_debug#JPRR>]
 4| 	debug: boolean;
 5| }
  |
  | [<class_Counter#HZHY>]
 7| class Counter {
  | 	[<class_Counter.field_value#QJBY>]
 8| 	value: number = 0;
 9|
  | 	[<class_Counter.fn_increment#NQWY>]
10| 	increment(): void {
11| 		this.value += 1;
12| 	}
13|
  | 	[<class_Counter.fn_decrement#PMBP>]
14| 	decrement(): void {
15| 		this.value -= 1;
16| 	}
17|
  | 	[<class_Counter.fn_toString#ZQZP>]
18| 	toString(): string {
19| 		return `Counter(${this.value})`;
20| 	}
21| }
  |
  | [<enum_Status#HYQJ>]
23| enum Status {
  | 	[<enum_Status.variant_Active#PQNS>]
24| 	Active = "ACTIVE",
  | 	[<enum_Status.variant_Paused#HHNM>]
25| 	Paused = "PAUSED",
  | 	[<enum_Status.variant_Stopped#NHTY>]
26| 	Stopped = "STOPPED",
27| }
  |
  | [<fn_createCounter#PQQY>]
29| function createCounter(initial: number): Counter {
30| 	const counter = new Counter();
31| 	counter.value = initial;
32| 	return counter;
33| }
```

**Replace a whole chunk** (rename a function):
~~~json
{{#if chunkAutoIndent}}
{ "sel": "fn_createCounter#PQQY", "op": "replace", "content": "function makeCounter(start: number): Counter {\n\tconst c = new Counter();\n\tc.value = start;\n\treturn c;\n}\n" }
{{else}}
{ "sel": "fn_createCounter#PQQY", "op": "replace", "content": "function makeCounter(start: number): Counter {\n  const c = new Counter();\n  c.value = start;\n  return c;\n}\n" }
{{/if}}
~~~
Result — the entire chunk is rewritten:
```
function makeCounter(start: number): Counter {
  const c = new Counter();
  c.value = start;
  return c;
}
```

**Replace a method body** (`@body`):
```
{ "sel": "class_Counter.fn_increment#NQWY@body", "op": "replace", "content": "this.value += 1;\nconsole.log('incremented to', this.value);\n" }
```
Result — only the body changes, signature and braces are kept:
```
  increment(): void {
    this.value += 1;
    console.log('incremented to', this.value);
  }
```

**Replace a function header** (`@head` — signature and doc comment):
```
{ "sel": "fn_createCounter#PQQY@head", "op": "replace", "content": "/** Creates a counter with the given start value. */\nfunction createCounter(initial: number, label?: string): Counter {\n" }
```
Result — adds a doc comment and updates the signature, body untouched:
```
/** Creates a counter with the given start value. */
function createCounter(initial: number, label?: string): Counter {
  const counter = new Counter();
  counter.value = initial;
  return counter;
}
```

**Insert before a chunk** (`before`):
```
{ "sel": "fn_createCounter", "op": "before", "content": "/** Factory function below. */\n" }
```
Result — a comment is inserted before the function:
```
/** Factory function below. */

function createCounter(initial: number): Counter {
```

**Insert after a chunk** (`after`):
~~~json
{{#if chunkAutoIndent}}
{ "sel": "enum_Status", "op": "after", "content": "\nfunction isActive(s: Status): boolean {\n\treturn s === Status.Active;\n}\n" }
{{else}}
{ "sel": "enum_Status", "op": "after", "content": "\nfunction isActive(s: Status): boolean {\n  return s === Status.Active;\n}\n" }
{{/if}}
~~~
Result — a new function appears after the enum:
```
enum Status {
  Active = "ACTIVE",
  Paused = "PAUSED",
  Stopped = "STOPPED",
}

function isActive(s: Status): boolean {
  return s === Status.Active;
}

function createCounter(initial: number): Counter {
```

**Prepend inside a container** (`@body` + `prepend`):
```
{ "sel": "class_Counter@body", "op": "prepend", "content": "label: string = 'default';\n\n" }
```
Result — a new field is added at the top of the class body, before existing members:
```
class Counter {
  label: string = 'default';

  value: number = 0;
```

**Append inside a container** (`@body` + `append`):
~~~json
{{#if chunkAutoIndent}}
{ "sel": "class_Counter@body", "op": "append", "content": "\nreset(): void {\n\tthis.value = 0;\n}\n" }
{{else}}
{ "sel": "class_Counter@body", "op": "append", "content": "\nreset(): void {\n  this.value = 0;\n}\n" }
{{/if}}
~~~
Result — a new method is added at the end of the class body, before the closing `}`:
```
  toString(): string {
    return `Counter(${this.value})`;
  }

  reset(): void {
    this.value = 0;
  }
}
```

**Delete a chunk** (`replace` with empty content):
```
{ "sel": "class_Counter.fn_toString#ZQZP", "op": "replace", "content": "" }
```
Result — the method is removed from the class.
- Indentation rules (important):
{{#if chunkAutoIndent}}
  - Use `\t` for each indent level. The tool converts tabs to the file's actual style (2-space, 4-space, etc.).
{{else}}
  - Match the file's real indentation characters in your snippet. The tool preserves your literal tabs/spaces after adding the target region's base indent.
{{/if}}
  - Do NOT include the chunk's base indentation — only indent relative to the region's opening level.
  - For `@body` of a function: write at column 0, e.g. `"return x;\n"`. The tool adds the correct base indent.
  - For `@head`: write at the chunk's own depth. A class member's head uses `"/** doc */\nstart(): void {"`.
{{#if chunkAutoIndent}}
  - For a top-level item: start at zero indent. Write `"function foo() {\n\treturn 1;\n}\n"`.
{{else}}
  - For a top-level item: start at zero indent. Write `"function foo() {\n  return 1;\n}\n"`.
{{/if}}
  - The tool strips common leading indentation from your content as a safety net, so accidental over-indentation is corrected.
</examples>
