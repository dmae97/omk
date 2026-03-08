---
description: Use hookFetch instead of assigning or spying on globalThis.fetch in tests
condition: "globalThis\\.fetch\\s*=|spyOn\\(globalThis.*fetch"
scope: "tool:edit(**/*.test.{ts,tsx,js,jsx}), tool:write(**/*.test.{ts,tsx,js,jsx})"
---

**Do not assign `globalThis.fetch` or use `vi.spyOn(globalThis, "fetch")` in tests.**

## Why it's wrong

- Forgetting restoration leaks state across tests
- `vi.spyOn` ties fetch mocking to vitest lifecycle instead of explicit scoping
- Makes test mocking inconsistent across the codebase

## What to use instead

Use `hookFetch` from `@oh-my-pi/pi-utils`. It returns a `Disposable` — use `using` for automatic cleanup:

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

// WRONG
vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

// RIGHT — fixed response
using _hook = hookFetch(() => new Response("ok"));

// RIGHT — conditional mock with passthrough
using _hook = hookFetch((input, init, next) => {
	if (String(input).includes("127.0.0.1")) {
		return new Response(JSON.stringify({ data: [] }));
	}
	return next(input, init);
});

// RIGHT — when you need vi.fn() for mock assertions
const fetchSpy = vi.fn(() => new Response("ok"));
using _hook = hookFetch(fetchSpy);
// later: expect(fetchSpy.mock.calls[0]).toEqual(...)
```