# Partial JSON parser source notice

`src/partial_json.rs` is a Rust adaptation of the default `Allow.ALL` algorithm
in `partial-json` 0.1.7, already pinned in the Node workspace. It adds no Rust or
Node dependency. OMK's `src/json_parse.rs` ports its own MIT JSON repair wrapper.

Upstream: https://github.com/promplate/partial-json-parser-js
Package: https://www.npmjs.com/package/partial-json/v/0.1.7
Reviewed source: `partial-json/dist/index.js`, SHA-256
`23f750aa1170c830b7ef180135852317886cc58ce7d2597e5eeee044539072c7`.
Reviewed license SHA-256:
`cd519ad3d7e012427f978dfb2e3b92ee403d189d7b859ba6bf68fd7e12ca456f`.

This is separate from the frozen B1 registry-dependency notice inventory. Include
this file, `THIRD-PARTY-NOTICES.md` and root LICENSE/NOTICE with any future binary
that includes the adapted parser. No binary distribution occurs in this change.

```text
MIT License

Copyright (c) 2023 Promplate Dev Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
