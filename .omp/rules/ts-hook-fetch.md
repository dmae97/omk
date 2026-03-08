---
description: Use hookFetch instead of assigning globalThis.fetch directly in tests
condition: "globalThis\\.fetch\\s*="
scope: "tool:edit(**/*.test.{ts,tsx,js,jsx}), tool:write(**/*.test.{ts,tsx,js,jsx})"
---

**Do not assign `globalThis.fetch = ...` directly in tests.**

## Why it's wrong

- It bypasses the project's standard fetch mocking helper
- It is easier to forget restoration and leak state across tests
- It makes test mocking inconsistent across the codebase

## What to use instead

Use `hookFetch` from `@oh-my-pi/pi-utils`:

```ts
import { hookFetch } from "@oh-my-pi/pi-utils";

using _hook = hookFetch((input, init, next) => {
	// return a mocked Response, or delegate with next(input, init)
});
```

## Examples

```ts
// WRONG
globalThis.fetch = async () => new Response("ok");

// RIGHT
using _hook = hookFetch(() => new Response("ok"));
```

If you need to intercept fetch in tests, use `hookFetch`.
