> omp can create TUI components. Ask it to build one for your use case.

# TUI Components

Hooks and custom tools can render custom TUI components for interactive user interfaces. This page covers the component system and available building blocks.

**Source:** [`packages/tui`](../../tui)

## Component Interface

All components implement:

```typescript
interface Component {
	render(width: number): string[];
	handleInput?(data: string): void;
	wantsKeyRelease?: boolean;
	getCursorPosition?(width: number): { row: number; col: number } | null;
	invalidate(): void;
}
```

| Member                       | Description                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `render(width)`              | Return array of strings (one per line). Each line **must not exceed `width`**.                            |
| `handleInput?(data)`         | Receive keyboard input when component has focus.                                                          |
| `wantsKeyRelease?`           | Opt-in to key release events (Kitty protocol). Default is `false` (release events are filtered out).      |
| `getCursorPosition?(width)`  | Optional cursor position within the rendered output (0-based row/col) for hardware cursor placement.      |
| `invalidate()`               | Clear cached render state (called when themes change or the component needs a full re-render).            |

## Using Components

**In hooks** via `ctx.ui.custom()`:

```typescript
pi.on("session_start", async (_event, ctx) => {
	const result = await ctx.ui.custom((tui, theme, keybindings, done) => {
		const component = new MySelector(items);
		component.onSelect = (item) => done(item);
		component.onCancel = () => done(null);
		return component;
	});
	if (result) {
		ctx.ui.notify(`Selected: ${result}`, "info");
	}
});
```

**In extensions/custom tools** via `pi.ui.custom()`:

```typescript
async execute(toolCallId, params, onUpdate, ctx, signal) {
	const result = await pi.ui.custom((tui, theme, keybindings, done) => {
		const component = new MyComponent(theme);
		component.onFinish = (value) => done(value);
		return component;
	});
	return { content: [{ type: "text", text: `Result: ${result}` }] };
}
```

The factory receives `tui`, `theme`, `keybindings`, and a `done()` callback. Call `done(value)` to close the component and
resolve the promise with `value`.
(timers, watchers), implement `dispose()`; it is called when `done()` closes the UI. For floating modals, call
`tui.showOverlay(component, options)` inside the factory.

The factory receives `tui`, `theme`, and a `done()` callback. Call `done(value)` to close the component and resolve the promise with `value`.

## Built-in Components

Import from `@oh-my-pi/pi-tui`:

```typescript
import {
	Box,
	CancellableLoader,
	Container,
	Editor,
	Image,
	Input,
	Loader,
	Markdown,
	SelectList,
	SettingsList,
	Spacer,
	TabBar,
	Text,
	TruncatedText,
} from "@oh-my-pi/pi-tui";
```

### Text

Multi-line text with word wrapping.

```typescript
const text = new Text(
	"Hello World", // content
	1, // paddingX (default: 1)
	1, // paddingY (default: 1)
	(s) => bgGray(s) // optional background function
);
text.setText("Updated");
text.setCustomBgFn((s) => bgBlue(s));
```

### TruncatedText

Single-line text truncated to fit the viewport width.

```typescript
const truncated = new TruncatedText("Long status line...", 0, 0);
```

### Box

Container with padding and background color.

```typescript
const box = new Box(
	1, // paddingX
	1, // paddingY
	(s) => bgGray(s) // background function
);
box.addChild(new Text("Content", 0, 0));
box.setBgFn((s) => bgBlue(s));
```

### Container

Groups child components vertically.

```typescript
const container = new Container();
container.addChild(component1);
container.addChild(component2);
container.removeChild(component1);
container.clear();
```

### Spacer

Empty vertical space.

```typescript
const spacer = new Spacer(2); // 2 empty lines
spacer.setLines(3);
```

### Input

Single-line input with editor-style keybindings.

```typescript
const input = new Input();
input.onSubmit = (value) => {
	// ...
};
input.setValue("Prefill");
```

### Editor

Multi-line editor with autocomplete and paste handling. Provide an `EditorTheme`.

```typescript
const editor = new Editor(editorTheme);
editor.onSubmit = (value) => {
	// ...
};
```

### Markdown

Renders markdown with syntax highlighting.

```typescript
import { getMarkdownTheme } from "@oh-my-pi/pi-coding-agent";

const md = new Markdown(
	"# Title\n\nSome **bold** text",
	1, // paddingX
	0, // paddingY
	getMarkdownTheme(),
	defaultTextStyle, // optional DefaultTextStyle
	2 // codeBlockIndent (default: 2)
);
md.setText("Updated markdown");
```

### Loader

Spinner component that auto-renders.

```typescript
const loader = new Loader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
```

### CancellableLoader

Loader with `AbortSignal` and Escape-to-cancel.

```typescript
const loader = new CancellableLoader(tui, theme.fg("accent"), theme.fg("muted"), "Working...");
loader.onAbort = () => {
	// ...
};
```

### SelectList

Interactive list with selection support.

```typescript
import { getSelectListTheme } from "@oh-my-pi/pi-coding-agent";

const list = new SelectList(items, getSelectListTheme());
list.onSelect = (item) => {
	// ...
};
```

### SettingsList

Settings list with labels, values, and hints.

```typescript
import { getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";

const settings = new SettingsList(items, getSettingsListTheme());
```

### TabBar

Horizontal tab switcher.

```typescript
const tabs = [
	{ id: "one", label: "One" },
	{ id: "two", label: "Two" },
];
const tabBar = new TabBar("Mode", tabs, tabTheme); // TabBarTheme
```

### Image

Renders images in supported terminals (Kitty, iTerm2, Ghostty, WezTerm).

```typescript
const image = new Image(
	base64Data, // base64-encoded image
	"image/png", // MIME type
	{ fallbackColor: (text) => theme.fg("muted", text) },
	{ maxWidthCells: 80, maxHeightCells: 24 }, // ImageOptions
	dimensions // optional: { widthPx, heightPx }
);
```

## Keyboard Input

Use `matchesKey()` for key detection:

```typescript
import { isKeyRelease, isKeyRepeat, matchesKey, parseKey } from "@oh-my-pi/pi-tui";

handleInput(data: string) {
	if (matchesKey(data, "up")) {
		this.selectedIndex--;
	} else if (matchesKey(data, "enter")) {
		this.onSelect?.(this.selectedIndex);
	} else if (matchesKey(data, "escape")) {
		this.onCancel?.();
	} else if (matchesKey(data, "ctrl+c")) {
		this.onCancel?.();
	}

	const parsed = parseKey(data);
	if (parsed && parsed.startsWith("alt+")) {
		// ...
	}
}
```

To honor coding-agent keybindings, use the `keybindings` argument from `ctx.ui.custom()`:

```typescript
if (keybindings.matches(data, "interrupt")) {
	this.onCancel?.();
}
```

To receive key release/repeat events, set `wantsKeyRelease = true` on your component and
filter with `isKeyRelease()` / `isKeyRepeat()`.

Supported key identifiers:

- **Letters**: `"a"` through `"z"`
- **Specials**: `"escape"`, `"enter"`, `"tab"`, `"space"`, `"backspace"`, `"delete"`, `"home"`, `"end"`, `"pageUp"`, `"pageDown"`
- **Arrows**: `"up"`, `"down"`, `"left"`, `"right"`
- **Function keys**: `"f1"` through `"f12"`
- **Modifiers**: `"ctrl+c"`, `"shift+tab"`, `"alt+enter"`, `"ctrl+shift+p"`

## Line Width

**Critical:** Each line from `render()` must not exceed the `width` parameter. Use these utilities:

```typescript
import { visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";

render(width: number): string[] {
	// Truncate long lines
	return [truncateToWidth(this.text, width)];
}
```

Utilities:

- `visibleWidth(str)` - Get display width (ANSI-safe, Unicode-width aware)
- `truncateToWidth(str, width, ellipsis?)` - Truncate with optional ellipsis
- `wrapTextWithAnsi(str, width)` - Word wrap preserving ANSI codes

## Creating Custom Components

Example: Interactive selector

```typescript
import { matchesKey, truncateToWidth } from "@oh-my-pi/pi-tui";
import type { Component } from "@oh-my-pi/pi-tui";

class MySelector implements Component {
	private items: string[];
	private selected = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	public onSelect?: (item: string) => void;
	public onCancel?: () => void;

	constructor(items: string[]) {
		this.items = items;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "up") && this.selected > 0) {
			this.selected--;
			this.invalidate();
		} else if (matchesKey(data, "down") && this.selected < this.items.length - 1) {
			this.selected++;
			this.invalidate();
		} else if (matchesKey(data, "enter")) {
			this.onSelect?.(this.items[this.selected]);
		} else if (matchesKey(data, "escape")) {
			this.onCancel?.();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		this.cachedLines = this.items.map((item, i) => {
			const prefix = i === this.selected ? "> " : "  ";
			return truncateToWidth(prefix + item, width);
		});
		this.cachedWidth = width;
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
```

Usage in a hook:

```typescript
pi.registerCommand("pick", {
	description: "Pick an item",
	handler: async (args, ctx) => {
		const items = ["Option A", "Option B", "Option C"];

		const selected = await ctx.ui.custom((tui, theme, done) => {
			const selector = new MySelector(items);
			selector.onSelect = (item) => done(item);
			selector.onCancel = () => done(null);
			return selector;
		});

		if (selected) {
			ctx.ui.notify(`Selected: ${selected}`, "info");
		}
	},
});
```

## Theming

Components accept theme objects for styling.

**In `renderCall`/`renderResult`**, use the `theme` parameter:

```typescript
renderResult(result, options, theme) {
	// Use theme.fg() for foreground colors
	return new Text(theme.fg("success", "Done!"), 0, 0);

	// Use theme.bg() for background colors
	const styled = theme.bg("toolPendingBg", theme.fg("accent", "text"));
}
```

**Foreground colors** (`theme.fg(color, text)`):

| Category   | Colors                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General    | `text`, `accent`, `muted`, `dim`                                                                                                                          |
| Status     | `success`, `error`, `warning`                                                                                                                             |
| Borders    | `border`, `borderAccent`, `borderMuted`                                                                                                                   |
| Messages   | `userMessageText`, `thinkingText`, `customMessageText`, `customMessageLabel`                                                                              |
| Tools      | `toolTitle`, `toolOutput`                                                                                                                                 |
| Diffs      | `toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`                                                                                                     |
| Markdown   | `mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`                      |
| Syntax     | `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation` |
| Thinking   | `thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`                                                        |
| Modes      | `bashMode`, `pythonMode`                                                                                                                                  |
| Status bar | `statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, etc.            |

**Background colors** (`theme.bg(color, text)`):

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

**For Markdown**, use `getMarkdownTheme()`:

```typescript
import { getMarkdownTheme } from "@oh-my-pi/pi-coding-agent";
import { Markdown } from "@oh-my-pi/pi-tui";

renderResult(result, options, theme) {
	const mdTheme = getMarkdownTheme();
	return new Markdown(result.details.markdown, 0, 0, mdTheme);
}
```

**For custom components**, define your own theme interface:

```typescript
interface MyTheme {
	selected: (s: string) => string;
	normal: (s: string) => string;
}
```

## Performance

Cache rendered output when possible:

```typescript
class CachedComponent implements Component {
	private cachedWidth?: number;
	private cachedLines?: string[];

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}
		// ... compute lines ...
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
```

Call `invalidate()` when state changes. The TUI will re-render automatically when keyboard input is received.

## Examples

- **Snake game**: [examples/hooks/snake.ts](../examples/hooks/snake.ts) - Full game with keyboard input, game loop, state persistence
- **Custom tool rendering**: [examples/custom-tools/todo/](../examples/custom-tools/todo/) - Custom `renderCall` and `renderResult`
