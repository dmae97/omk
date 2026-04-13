Edits files via syntax-aware chunks. Run `read(path="file.ts")` first. The edit selector is a chunk path, optionally qualified with a region.

<rules>
- **MUST** `read` first. Never invent chunk paths or CRCs. Copy them from the latest `read` output or edit response.
- `path` format: `file:selector` where selector is:
  - insertions: `file:chunk`, `file:chunk~`, or `file:chunk^`
  - replacements: `file:chunk#CRC`, `file:chunk#CRC~`, or `file:chunk#CRC^`
- Without a suffix it defaults to the entire chunk including leading trivia. `~` targets the body, `^` targets the head.
- If the exact chunk path is unclear, run `read(path="file", sel="?")` and copy a selector from that listing.
{{#if chunkAutoIndent}}
- Use `\t` for indentation in `content`. Write content at indent-level 0 — the tool re-indents it to match the chunk's position in the file. For example, to replace `~` of a method, write the body starting at column 0:
  ```
  content: "if (x) {\n\treturn true;\n}"
  ```
  The tool adds the correct base indent automatically. Never manually pad with the chunk's own indentation.
{{else}}
- Match the file's literal tabs/spaces in `content`. Do not convert indentation to canonical `\t`.
- Write content at indent-level 0 relative to the target region. For example, to replace `~` of a method, write:
  ```
  content: "if (x) {\n  return true;\n}"
  ```
  The tool adds the correct base indent automatically, then preserves the tabs/spaces you used inside the snippet. Never manually pad with the chunk's own indentation.
{{/if}}
- Region suffixes only apply to container chunks (classes, functions, impl blocks, sections). On leaf chunks (enum variants, fields, single statements, and compound statements like `if`/`for`/`while`/`match`/`try`), `~` and `^` silently fall back to whole-chunk replacement — prefer the unsuffixed form and always supply the complete replacement (condition + body, not just the body) to avoid dropping structural parts.
- `replace` requires the current CRC. Insertions do not.
- **CRCs change after every edit.** The edit response always carries the new CRCs — use those for the next call or run `read(path="file", sel="?")` to refresh. Never reuse a CRC from before the latest edit.
</rules>

<critical>
You **MUST** use the narrowest region that covers your change. Replacing without a region replaces the **entire chunk including leading comments, decorators, and attributes** — omitting them from `content` deletes them.

**`replace` is total, not surgical.** The `content` you supply becomes the *complete* new content for the targeted region. Everything in the original region that you omit from `content` is deleted. Before replacing `~` on any chunk, verify the chunk does not contain children you intend to keep. If a chunk spans hundreds of lines and your change touches only a few, target a specific child chunk — not the parent.

**Group chunks (`stmts_*`, `imports_*`, `decls_*`) are containers.** They hold many sibling items (test functions, import statements, declarations). Replacing `~` on a group chunk replaces **all** of its children. To edit one item inside a group, target that item's own chunk path. If no child chunk exists, use the specific child's chunk selector from `read` output — do not replace the parent group.
</critical>

<regions>
In `read` output, lines marked `^` between the line number and `|` are **head** lines (doc comments, attributes/decorators, signature). Lines without `^` are **body** lines. Use this to decide which region to target:

- `fn_foo#CRC~` — **body only (the default choice for most edits).** Head lines (`^`) are preserved automatically — doc comments, attributes, and signature stay untouched. On leaf chunks, falls back to whole chunk.
- `fn_foo#CRC^` — head only (decorators, attributes, doc comments, signature, opening delimiter). Body stays untouched.
- `fn_foo#CRC` — entire chunk including leading trivia. **You must include doc comments and attributes in `content`; omitting them deletes them.**
- `chunk~` + `append`/`prepend` inserts *inside* the container. `chunk` + `append`/`prepend` inserts *outside*.

**Note on leading trivia:** whether a decorator/doc comment belongs to `^` depends on the parser. In Rust and Python, attributes and decorators are attached to the function chunk, so `^` covers them. In TypeScript/JavaScript, a `@decorator` + `/** jsdoc */` block immediately above a method often surfaces as a **separate sibling chunk** (shown as `chunk#CRC` in the `?` listing) rather than as part of the function's `^`. If you need to rewrite a decorator, check the `?` listing for a sibling `chunk#CRC` directly above your target.

**Note on non-code formats:** for prose and data formats (markdown, YAML, JSON, fenced code blocks, frontmatter), `^` and `~` fall back to the whole chunk. Always replace the entire chunk and include any delimiter syntax (fence backticks, `---` frontmatter markers, list markers) in your `content` — omitting them deletes them. For markdown sections (`sect_*`), always use unsuffixed whole-chunk replace — `^` and `~` on section containers also fall back to whole-chunk replace. When editing fenced code blocks in markdown, use the exact whitespace from the file (read with `raw` first) — the tool preserves literal indentation inside fenced blocks, but any content you supply is written verbatim. To insert content after a markdown section heading, use `after` on the heading chunk (`sect_*.chunk` or `sect_*.chunk_1`) — not `before`/`prepend` on the section itself, which lands physically before the heading and gets absorbed by the preceding section on reparse.
</regions>

<ops>
Each edit entry has: `{ op, path, content }` where `path` is `file:selector`.

|op|path (selector part)|effect|
|---|---|---|
|`replace`|`file:chunk#CRC`, `file:chunk#CRC~`, or `file:chunk#CRC^`|rewrite the addressed region|
|`before`|`file:chunk`, `file:chunk~`, or `file:chunk^`|insert before the region span|
|`after`|`file:chunk`, `file:chunk~`, or `file:chunk^`|insert after the region span|
|`prepend`|`file:chunk`, `file:chunk~`, or `file:chunk^`|insert at the start inside the region|
|`append`|`file:chunk`, `file:chunk~`, or `file:chunk^`|insert at the end inside the region|
</ops>

<examples>
Given this `read` output for `counter.rs`:
```
   | counter.rs·62L·rust·#ZRPW
   |
   | [<imp#MNHH>]
 1 |use std::fmt;
   |
   | [<struct_Counte#QTSX>]
 3^|/// A simple counter that tracks a value and its history.
 4^|#[derive(Debug, Clone)]
 5^|pub struct Counter {
   | 	[<struct_Counte.field_value#MQTW>]
 6 |	/// The current value.
 7 |	value: i32,
   | 	[<struct_Counte.field_max#HJMQ>]
 8 |	/// Maximum allowed value.
 9 |	max: i32,
10 |}
   |
   | [<impl_Counte#VNPP>]
12^|impl Counter {
   | 	[<impl_Counte.fn_new#RWZV>]
13^|	/// Creates a new counter starting at zero.
14^|	pub fn new(max: i32) -> Self {
15 |		Self { value: 0, max }
16 |	}
17 |
   | 	[<impl_Counte.fn_increm#MNHV>]
18^|	/// Increments the counter by one, clamping at max.
19^|	pub fn increment(&mut self) {
20 |		if self.value < self.max {
21 |			self.value += 1;
22 |		}
23 |	}
24 |
   | 	[<impl_Counte.fn_decrem#TTWB>]
25^|	/// Decrements the counter by one, clamping at zero.
26^|	pub fn decrement(&mut self) {
27 |		if self.value > 0 {
28 |			self.value -= 1;
29 |		}
30 |	}
31 |
   | 	[<impl_Counte.fn_get#PTNT>]
32^|	/// Returns the current value.
33^|	pub fn get(&self) -> i32 {
34 |		self.value
35 |	}
36 |}
   |
   | [<impl_Displa#BNJH>]
38^|impl fmt::Display for Counter {
   | 	[<impl_Displa.fn_fmt#NKRN>]
39^|	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
40 |		write!(f, "Counter({}/{})", self.value, self.max)
41 |	}
42 |}
   |
   | [<mod_tests#YWXM>]
44^|#[cfg(test)]
45^|mod tests {
   | 	[<mod_tests.chunk#VSMY>]
46 |	use super::*;
47 |
   | 	[<mod_tests.fn_test_i#YXQZ>]
48^|	#[test]
49^|	fn test_increment() {
50 |		let mut c = Counter::new(10);
51 |		c.increment();
52 |		assert_eq!(c.get(), 1);
53 |	}
54 |
   | 	[<mod_tests.fn_test_d#XPBQ>]
55^|	#[test]
56^|	fn test_decrement_at_zero() {
57 |		let mut c = Counter::new(10);
58 |		c.decrement();
59 |		assert_eq!(c.get(), 0);
60 |	}
61 |}
```

**Understanding `^` markers in `read` output:** Lines marked with `^` between the line number and `|` (e.g. ` 3^|`) are **head** lines — doc comments, attributes, and the signature. Lines without `^` (e.g. ` 7 |`) are **body** lines. `~` replaces body lines only, keeping head lines intact.

**Replace a method body** (`~` — the common case):
```
{ "path": "counter.rs:impl_Counte.fn_increm#MNHV~", "op": "replace", "content": "self.value = (self.value + 1).min(self.max);\n" }
```
Result — only the body (non-`^` lines) changes; the doc comment `/// Increments the counter...`, the signature `pub fn increment(&mut self) {`, and the closing `}` are all preserved:
```
    /// Increments the counter by one, clamping at max.
    pub fn increment(&mut self) {
        self.value = (self.value + 1).min(self.max);
    }
```

**Replace a whole chunk** (rewrite signature + doc comment + body):
```
{ "path": "counter.rs:impl_Counte.fn_increm#MNHV", "op": "replace", "content": "/// Increments by the given step, clamping at max.\npub fn increment(&mut self, step: i32) {\n\tself.value = (self.value + step).min(self.max);\n}\n" }
```
Result — **everything** including the doc comment and signature is rewritten. You must include the doc comment and signature in `content`; omitting them deletes them:
```
    /// Increments by the given step, clamping at max.
    pub fn increment(&mut self, step: i32) {
        self.value = (self.value + step).min(self.max);
    }
```

**Replace a function header** (`^` — attributes, doc comments, signature):
```
{ "path": "counter.rs:impl_Counte.fn_get#PTNT^", "op": "replace", "content": "/// Returns the current counter value.\n#[inline]\npub fn get(&self) -> i32 {\n" }
```
Result — the head (all `^` lines + opening brace) changes, body untouched:
```
    /// Returns the current counter value.
    #[inline]
    pub fn get(&self) -> i32 {
        self.value
    }
```

**Insert before a chunk** (`before`):
```
{ "path": "counter.rs:impl_Counte.fn_get", "op": "before", "content": "/// Resets the counter to zero.\npub fn reset(&mut self) {\n\tself.value = 0;\n}\n\n" }
```
Result — a new method is inserted before `fn get`:
```
    /// Resets the counter to zero.
    pub fn reset(&mut self) {
        self.value = 0;
    }

    /// Returns the current value.
    pub fn get(&self) -> i32 {
```

**Insert after a chunk** (`after`):
```
{ "path": "counter.rs:struct_Counte", "op": "after", "content": "\nimpl Default for Counter {\n\tfn default() -> Self {\n\t\tSelf { value: 0, max: 100 }\n\t}\n}\n" }
```
Result — a new impl block appears after the struct:
```
}

impl Default for Counter {
    fn default() -> Self {
        Self { value: 0, max: 100 }
    }
}

impl Counter {
```

**Prepend inside a container** (`~` + `prepend`):
```
{ "path": "counter.rs:impl_Counte~", "op": "prepend", "content": "/// Creates a counter starting at the given value.\npub fn with_value(value: i32, max: i32) -> Self {\n\tSelf { value: value.min(max), max }\n}\n\n" }
```
Result — a new method is added at the top of the impl body, before existing methods:
```
impl Counter {
    /// Creates a counter starting at the given value.
    pub fn with_value(value: i32, max: i32) -> Self {
        Self { value: value.min(max), max }
    }

    /// Creates a new counter starting at zero.
    pub fn new(max: i32) -> Self {
```

**Append inside a container** (`~` + `append`):
```
{ "path": "counter.rs:impl_Counte~", "op": "append", "content": "\n/// Returns true if the counter is at its maximum.\npub fn is_maxed(&self) -> bool {\n\tself.value >= self.max\n}\n" }
```
Result — a new method is added at the end of the impl body, before the closing `}`:
```
    pub fn get(&self) -> i32 {
        self.value
    }

    /// Returns true if the counter is at its maximum.
    pub fn is_maxed(&self) -> bool {
        self.value >= self.max
    }
}
```

**Delete a chunk** (`replace` with empty content):
```
{ "path": "counter.rs:impl_Counte.fn_decrem#TTWB", "op": "replace", "content": "" }
```
Result — the method (including its doc comment and signature) is removed.
- Indentation rules (important):
{{#if chunkAutoIndent}}
  - Use `\t` for each indent level. The tool converts tabs to the file's actual style (2-space, 4-space, etc.).
{{else}}
  - Match the file's real indentation characters in your snippet. The tool preserves your literal tabs/spaces after adding the target region's base indent.
{{/if}}
  - Do NOT include the chunk's base indentation — only indent relative to the region's opening level.
  - For `~` of a function: write at column 0, and use `\t` for *relative* nesting. Flat body: `"return x;\n"`. Nested body: `"if (cond) {\n\treturn x;\n}\n"` — the `if` is at column 0, the `return` is one tab in, and the tool adds the method's base indent to both.
  - For `^`: write at the chunk's own depth. A class member's head uses `"/// doc\n#[attr]\npub fn start() {"`.
{{#if chunkAutoIndent}}
  - For a top-level item: start at zero indent. Write `"fn foo() {\n\treturn 1;\n}\n"`.
{{else}}
  - For a top-level item: start at zero indent. Write `"fn foo() {\n  return 1;\n}\n"`.
{{/if}}
  - The tool strips common leading indentation from your content as a safety net, so accidental over-indentation is corrected.
</examples>
