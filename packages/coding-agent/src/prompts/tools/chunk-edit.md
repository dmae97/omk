Edits files via syntax-aware chunks. Run `read(path="file.ts")` first. The edit selector is a chunk path, optionally qualified with a region.

<rules>
- **MUST** `read` first. Never invent chunk paths or CRCs. Copy them from the latest `read` output (opening lines start with `+++`) or edit response.
- `sel` format:
  - insertions: `chunk` or `chunk@region`
  - replacements: `chunk#CRC` or `chunk#CRC@region`
- Without a `@region` it defaults to the entire chunk. Valid regions: `head`, `body`, `tail`.
- If the exact chunk path is unclear, run `read(path="file", sel="?")` and copy a selector from that listing.
- Use `\t` for indentation in `content`. Write content at indent-level 0 — the tool re-indents it to match the chunk's position in the file. For example, to replace `@body` of a method, write the body starting at column 0:
  ```
  content: "if (x) {\n\treturn true;\n}"
  ```
  The tool adds the correct base indent automatically. Never manually pad with the chunk's own indentation.
- `@region` only works on container chunks (classes, functions, impl blocks, sections). Do **not** use `@head`/`@body`/`@tail` on leaf chunks (enum variants, fields, single statements) — use the whole chunk instead.
- `replace` requires the current CRC. Insertions do not.
- **CRCs change after every edit.** Always use the selectors/CRCs from the most recent `read` or edit response. Never reuse a CRC from a previous edit.
</rules>

<regions>
- `@head` — attached trivia, header/signature, and opening delimiter.
- `@body` — the editable interior only.
- `@tail` — the closing delimiter or trailing owned trailer.

For leaf chunks (fields, variants, single-line items), `@body` falls back to the full chunk.

**Important:** `append`/`prepend` without a `@region` inserts _outside_ the chunk. To add children _inside_ a class, struct, enum, or function body, use `@body`:
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
~~~
  | example.ts·34L·ts·#QBMH
  |
  | +++interface_Config#BWTR
 1| interface Config {
  | 	+++interface_Config.field_host#TTMN
 2| 	host: string;
  | 	+++interface_Config.field_port#QSMH
 3| 	port: number;
  | 	+++interface_Config.field_debug#JPRR
 4| 	debug: boolean;
 5| }
  |
  | +++class_Counter#HZHY
 7| class Counter {
  | 	+++class_Counter.field_value#QJBY
 8| 	value: number = 0;
 9|
  | 	+++class_Counter.fn_increment#NQWY
10| 	increment(): void {
11| 		this.value += 1;
12| 	}
13|
  | 	+++class_Counter.fn_decrement#PMBP
14| 	decrement(): void {
15| 		this.value -= 1;
16| 	}
17|
  | 	+++class_Counter.fn_toString#ZQZP
18| 	toString(): string {
19| 		return `Counter(${this.value})`;
20| 	}
21| }
  |
  | +++enum_Status#HYQJ
23| enum Status {
  | 	+++enum_Status.variant_Active#PQNS
24| 	Active = "ACTIVE",
  | 	+++enum_Status.variant_Paused#HHNM
25| 	Paused = "PAUSED",
  | 	+++enum_Status.variant_Stopped#NHTY
26| 	Stopped = "STOPPED",
27| }
  |
  | +++fn_createCounter#PQQY
29| function createCounter(initial: number): Counter {
30| 	const counter = new Counter();
31| 	counter.value = initial;
32| 	return counter;
33| }
~~~

**Replace a whole chunk** (rename a function):
~~~json
{ "sel": "fn_createCounter#PQQY", "op": "replace", "content": "function makeCounter(start: number): Counter {\n\tconst c = new Counter();\n\tc.value = start;\n\treturn c;\n}\n" }
~~~
Result — the entire chunk is rewritten:
~~~
function makeCounter(start: number): Counter {
  const c = new Counter();
  c.value = start;
  return c;
}
~~~

**Replace a method body** (`@body`):
~~~json
{ "sel": "class_Counter.fn_increment#NQWY@body", "op": "replace", "content": "this.value += 1;\nconsole.log('incremented to', this.value);\n" }
~~~
Result — only the body changes, signature and braces are kept:
~~~
  increment(): void {
    this.value += 1;
    console.log('incremented to', this.value);
  }
~~~

**Replace a function header** (`@head` — signature and doc comment):
~~~json
{ "sel": "fn_createCounter#PQQY@head", "op": "replace", "content": "/** Creates a counter with the given start value. */\nfunction createCounter(initial: number, label?: string): Counter {\n" }
~~~
Result — adds a doc comment and updates the signature, body untouched:
~~~
/** Creates a counter with the given start value. */
function createCounter(initial: number, label?: string): Counter {
  const counter = new Counter();
  counter.value = initial;
  return counter;
}
~~~

**Insert before a chunk** (`before`):
~~~json
{ "sel": "fn_createCounter", "op": "before", "content": "/** Factory function below. */\n" }
~~~
Result — a comment is inserted before the function:
~~~
/** Factory function below. */

function createCounter(initial: number): Counter {
~~~

**Insert after a chunk** (`after`):
~~~json
{ "sel": "enum_Status", "op": "after", "content": "\nfunction isActive(s: Status): boolean {\n\treturn s === Status.Active;\n}\n" }
~~~
Result — a new function appears after the enum:
~~~
enum Status {
  Active = "ACTIVE",
  Paused = "PAUSED",
  Stopped = "STOPPED",
}

function isActive(s: Status): boolean {
  return s === Status.Active;
}

function createCounter(initial: number): Counter {
~~~

**Prepend inside a container** (`@body` + `prepend`):
~~~json
{ "sel": "class_Counter@body", "op": "prepend", "content": "label: string = 'default';\n\n" }
~~~
Result — a new field is added at the top of the class body, before existing members:
~~~
class Counter {
  label: string = 'default';

  value: number = 0;
~~~

**Append inside a container** (`@body` + `append`):
~~~json
{ "sel": "class_Counter@body", "op": "append", "content": "\nreset(): void {\n\tthis.value = 0;\n}\n" }
~~~
Result — a new method is added at the end of the class body, before the closing `}`:
~~~
  toString(): string {
    return `Counter(${this.value})`;
  }

  reset(): void {
    this.value = 0;
  }
}
~~~

**Delete a chunk** (`replace` with empty content):
~~~json
{ "sel": "class_Counter.fn_toString#ZQZP", "op": "replace", "content": "" }
~~~
Result — the method is removed from the class.
- Indentation rules (important):
  - Use `\t` for each indent level. The tool converts tabs to the file's actual style (2-space, 4-space, etc.).
  - Do NOT include the chunk's base indentation — only indent relative to the region's opening level.
  - For `@body` of a function: write at column 0, e.g. `"return x;\n"`. The tool adds the correct base indent.
  - For `@head`: write at the chunk's own depth. A class member's head uses `"/** doc */\nstart(): void {"`.
  - For a top-level item: start at zero indent. Write `"function foo() {\n\treturn 1;\n}\n"`.
  - The tool strips common leading indentation from your content as a safety net, so accidental over-indentation is corrected.
</examples>
