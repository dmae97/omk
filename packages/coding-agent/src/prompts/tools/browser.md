# Browser

Use this tool to navigate, click, type, scroll, drag, query DOM content, and capture screenshots.

<instruction>
- Use `action: "open"` to start a new headless browser session (or implicitly launch on first action)
- Use `action: "goto"` with `url` to navigate
- Use `action: "observe"` to capture a numbered accessibility snapshot with URL/title/viewport/scroll info
	- Prefer `click_id`, `type_id`, or `fill_id` actions using the returned `element_id` values
	- Optional flags: `include_all` to include non-interactive nodes, `viewport_only` to limit to visible elements
- Use `action: "click"`, `"type"`, `"fill"`, `"press"`, `"scroll"`, or `"drag"` for selector-based interactions
	- Prefer ARIA or text selectors (e.g. `p-aria/[name="Sign in"]`, `p-text/Continue`) over brittle CSS
- Use `action: "click_id"`, `"type_id"`, or `"fill_id"` to interact with observed elements without selectors
- Use `action: "wait_for_selector"` before interacting when the page is dynamic
- Use `action: "evaluate"` with `script` to run a JavaScript expression in the page context
- Use `action: "get_text"`, `"get_html"`, or `"get_attribute"` for DOM queries
	- For batch queries, pass `args: [{ selector, attribute? }]` to get an array of results (attribute required for `get_attribute`)
- Use `action: "extract_readable"` to return reader-mode content (title/byline/excerpt/text or markdown)
	- Set `format` to `"markdown"` (default) or `"text"`
- Use `action: "screenshot"` to capture images (optionally with `selector` to capture a single element)
- Use `action: "close"` to release the browser when done
</instruction>

<critical>
**Default to `observe`, not `screenshot`.**
- `observe` is cheaper, faster, and returns structured data — use it to understand page state, find elements, and plan interactions.
- Only use `screenshot` when visual appearance matters (verifying layout, debugging CSS, capturing a visual artifact for the user).
- Never screenshot just to "see what's on the page" — `observe` gives you that with element IDs you can act on immediately.
</critical>

<output>
Returns text output for navigation and DOM queries, and image output for screenshots. Screenshots can optionally be saved to disk via the `path` parameter.
</output>