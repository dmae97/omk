> omp can create themes. Ask it to build one for your use case.

# OMP Coding Agent Themes

Themes allow you to customize the colors used throughout the coding agent TUI.

## Color Tokens

Every theme must define all color tokens. There are no optional colors.

### Core UI (11 colors)

| Token          | Purpose               | Examples                             |
| -------------- | --------------------- | ------------------------------------ |
| `accent`       | Primary accent color  | Logo, selected items, cursor (›)     |
| `border`       | Normal borders        | Selector borders, horizontal lines   |
| `borderAccent` | Highlighted borders   | Changelog borders, special panels    |
| `borderMuted`  | Subtle borders        | Editor borders, secondary separators |
| `success`      | Success states        | Success messages, diff additions     |
| `error`        | Error states          | Error messages, diff deletions       |
| `warning`      | Warning states        | Warning messages                     |
| `muted`        | Secondary/dimmed text | Metadata, descriptions, output       |
| `dim`          | Very dimmed text      | Less important info, placeholders    |
| `text`         | Default text color    | Main content (usually `""`)          |
| `thinkingText` | Thinking block text   | Assistant reasoning traces           |

### Backgrounds & Content Text (11 colors)

| Token                | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `selectedBg`         | Selected/active line background (e.g., tree selector)             |
| `userMessageBg`      | User message background                                           |
| `userMessageText`    | User message text color                                           |
| `customMessageBg`    | Hook custom message background                                    |
| `customMessageText`  | Hook custom message text color                                    |
| `customMessageLabel` | Hook custom message label/type text                               |
| `toolPendingBg`      | Tool execution box (pending state)                                |
| `toolSuccessBg`      | Tool execution box (success state)                                |
| `toolErrorBg`        | Tool execution box (error state)                                  |
| `toolTitle`          | Tool execution title/heading (e.g., `$ command`, `read file.txt`) |
| `toolOutput`         | Tool execution output text                                        |

### Markdown (10 colors)

| Token               | Purpose                       |
| ------------------- | ----------------------------- |
| `mdHeading`         | Heading text (`#`, `##`, etc) |
| `mdLink`            | Link text                     |
| `mdLinkUrl`         | Link URL (in parentheses)     |
| `mdCode`            | Inline code (backticks)       |
| `mdCodeBlock`       | Code block content            |
| `mdCodeBlockBorder` | Code block fences (```)       |
| `mdQuote`           | Blockquote text               |
| `mdQuoteBorder`     | Blockquote border (`│`)       |
| `mdHr`              | Horizontal rule (`---`)       |
| `mdListBullet`      | List bullets/numbers          |

### Tool Diffs (3 colors)

| Token             | Purpose                     |
| ----------------- | --------------------------- |
| `toolDiffAdded`   | Added lines in tool diffs   |
| `toolDiffRemoved` | Removed lines in tool diffs |
| `toolDiffContext` | Context lines in tool diffs |

Note: Diff colors are specific to tool execution boxes and must work with tool background colors.

### Syntax Highlighting (9 colors)

Used for native syntax highlighting in tool output and editors:

| Token               | Purpose                          |
| ------------------- | -------------------------------- |
| `syntaxComment`     | Comments                         |
| `syntaxKeyword`     | Keywords (`if`, `function`, etc) |
| `syntaxFunction`    | Function names                   |
| `syntaxVariable`    | Variable names                   |
| `syntaxString`      | String literals                  |
| `syntaxNumber`      | Number literals                  |
| `syntaxType`        | Type names                       |
| `syntaxOperator`    | Operators (`+`, `-`, etc)        |
| `syntaxPunctuation` | Punctuation (`;`, `,`, etc)      |

### Thinking Level Borders (6 colors)

Editor border colors that indicate the current thinking/reasoning level:

| Token             | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `thinkingOff`     | Border when thinking is off (most subtle)                         |
| `thinkingMinimal` | Border for minimal thinking                                       |
| `thinkingLow`     | Border for low thinking                                           |
| `thinkingMedium`  | Border for medium thinking                                        |
| `thinkingHigh`    | Border for high thinking                                          |
| `thinkingXhigh`   | Border for xhigh thinking (most prominent)                       |

These create a visual hierarchy: off → minimal → low → medium → high → xhigh

### Mode Borders (2 colors)

| Token        | Purpose                                          |
| ------------ | ------------------------------------------------ |
| `bashMode`   | Editor border color when in bash mode (! prefix) |
| `pythonMode` | Editor border color when in python mode (>>>)   |

### Status Line (14 colors)

| Token               | Purpose                                 |
| ------------------- | --------------------------------------- |
| `statusLineBg`      | Status line background                  |
| `statusLineSep`     | Separators between status line segments |
| `statusLineModel`   | Model segment text                      |
| `statusLinePath`    | Working directory segment               |
| `statusLineGitClean` | Git segment (clean)                    |
| `statusLineGitDirty` | Git segment (dirty)                    |
| `statusLineContext` | Context window usage segment            |
| `statusLineSpend`   | Token input/total segment               |
| `statusLineStaged`  | Git staged count                        |
| `statusLineDirty`   | Git unstaged count                      |
| `statusLineUntracked` | Git untracked count                   |
| `statusLineOutput`  | Token output/cache output segment       |
| `statusLineCost`    | Cost segment                            |
| `statusLineSubagents` | Subagent count segment                |

**Total: 66 color tokens** (all required)

### HTML Export Colors (optional)

The `export` section is optional and controls colors used when exporting sessions to HTML via `/export`. If not specified, these colors are automatically derived from `userMessageBg` based on luminance detection.

| Token    | Purpose                                                       |
| -------- | ------------------------------------------------------------- |
| `pageBg` | Page background color                                         |
| `cardBg` | Card/container background (headers, stats boxes)              |
| `infoBg` | Info sections background (system prompt, notices, compaction) |

Example:

```json
{
	"export": {
		"pageBg": "#18181e",
		"cardBg": "#1e1e24",
		"infoBg": "#3c3728"
	}
}
```

## Theme Format

Themes are defined in JSON files with the following structure:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/modes/theme/theme-schema.json",
  "name": "my-theme",
  "vars": {
    "blue": "#0066cc",
    "gray": 242,
    "brightCyan": 51
  },
  "colors": {
    "accent": "blue",
    "muted": "gray",
    "thinkingText": "gray",
    "text": "",
    ...
  }
}
```

## Symbols

Themes can also customize specific UI symbols (icons, separators, bullets, etc.). Use `symbols.preset` (`unicode`, `nerd`, `ascii`) to set a theme default (overridden by the `symbolPreset` setting), and `symbols.overrides` to override individual keys.

Example:

```json
{
	"symbols": {
		"preset": "ascii",
		"overrides": {
			"icon.model": "[M]",
			"sep.powerlineLeft": ">",
			"sep.powerlineRight": "<"
		}
	}
}
```

Symbol keys by category:

- Status: `status.success`, `status.error`, `status.warning`, `status.info`, `status.pending`, `status.disabled`, `status.enabled`, `status.running`, `status.shadowed`, `status.aborted`
- Navigation: `nav.cursor`, `nav.selected`, `nav.expand`, `nav.collapse`, `nav.back`
- Tree: `tree.branch`, `tree.last`, `tree.vertical`, `tree.horizontal`, `tree.hook`
- Boxes (rounded): `boxRound.topLeft`, `boxRound.topRight`, `boxRound.bottomLeft`, `boxRound.bottomRight`, `boxRound.horizontal`, `boxRound.vertical`
- Boxes (sharp): `boxSharp.topLeft`, `boxSharp.topRight`, `boxSharp.bottomLeft`, `boxSharp.bottomRight`, `boxSharp.horizontal`, `boxSharp.vertical`, `boxSharp.cross`, `boxSharp.teeDown`, `boxSharp.teeUp`, `boxSharp.teeRight`, `boxSharp.teeLeft`
- Separators: `sep.powerline`, `sep.powerlineThin`, `sep.powerlineLeft`, `sep.powerlineRight`, `sep.powerlineThinLeft`, `sep.powerlineThinRight`, `sep.block`, `sep.space`, `sep.asciiLeft`, `sep.asciiRight`, `sep.dot`, `sep.slash`, `sep.pipe`
- Icons: `icon.model`, `icon.plan`, `icon.folder`, `icon.file`, `icon.git`, `icon.branch`, `icon.tokens`, `icon.context`, `icon.cost`, `icon.time`, `icon.pi`, `icon.agents`, `icon.cache`, `icon.input`, `icon.output`, `icon.host`, `icon.session`, `icon.package`, `icon.warning`, `icon.rewind`, `icon.auto`, `icon.extensionSkill`, `icon.extensionTool`, `icon.extensionSlashCommand`, `icon.extensionMcp`, `icon.extensionRule`, `icon.extensionHook`, `icon.extensionPrompt`, `icon.extensionContextFile`, `icon.extensionInstruction`
- Thinking: `thinking.minimal`, `thinking.low`, `thinking.medium`, `thinking.high`, `thinking.xhigh`
- Checkboxes: `checkbox.checked`, `checkbox.unchecked`
- Formatting: `format.bullet`, `format.dash`, `format.bracketLeft`, `format.bracketRight`
- Markdown: `md.quoteBorder`, `md.hrChar`, `md.bullet`
- Language icons: `lang.default`, `lang.typescript`, `lang.javascript`, `lang.python`, `lang.rust`, `lang.go`, `lang.java`, `lang.c`, `lang.cpp`, `lang.csharp`, `lang.ruby`, `lang.php`, `lang.swift`, `lang.kotlin`, `lang.shell`, `lang.html`, `lang.css`, `lang.json`, `lang.yaml`, `lang.markdown`, `lang.sql`, `lang.docker`, `lang.lua`, `lang.text`, `lang.env`, `lang.toml`, `lang.xml`, `lang.ini`, `lang.conf`, `lang.log`, `lang.csv`, `lang.tsv`, `lang.image`, `lang.pdf`, `lang.archive`, `lang.binary`
- Settings tabs: `tab.display`, `tab.agent`, `tab.input`, `tab.tools`, `tab.config`, `tab.services`, `tab.bash`, `tab.lsp`, `tab.ttsr`, `tab.status`

### Color Values

Four formats are supported:

1. **Hex colors**: `"#ff0000"` (6-digit hex RGB)
2. **256-color palette**: `39` (number 0-255, xterm 256-color palette)
3. **Color references**: `"blue"` (must be defined in `vars`)
4. **Terminal default**: `""` (empty string, uses terminal's default color)

### The `vars` Section

The optional `vars` section allows you to define reusable colors:

```json
{
	"vars": {
		"nord0": "#2E3440",
		"nord1": "#3B4252",
		"nord8": "#88C0D0",
		"brightBlue": 39
	},
	"colors": {
		"accent": "nord8",
		"muted": "nord1",
		"mdLink": "brightBlue"
	}
}
```

Benefits:

- Reuse colors across multiple tokens
- Easier to maintain theme consistency
- Can reference standard color palettes

Variables can be hex colors (`"#ff0000"`), 256-color indices (`42`), or references to other variables.

### Terminal Default (empty string)

Use `""` (empty string) to inherit the terminal's default foreground/background color:

```json
{
	"colors": {
		"text": "" // Uses terminal's default text color
	}
}
```

This is useful for:

- Main text color (adapts to user's terminal theme)
- Creating themes that blend with terminal appearance

## Built-in Themes

OMP ships with `dark` (default), `light`, and 90+ curated themes under `src/modes/theme/defaults/`. Examples include:

- **Dark themes**: `dark-aurora`, `dark-gruvbox`, `dark-nord`, `dark-tokyo-night`, `dark-catppuccin`, `dark-dracula`, `dark-solarized`, `dark-github`, `dark-monokai`, `dark-synthwave`
- **Light themes**: `light-solarized`, `light-gruvbox`, `light-github`, `light-catppuccin`, `light-paper`, `light-dawn`, `light-frost`
- **Neutral/material**: `graphite`, `obsidian`, `onyx`, `titanium`, `marble`, `pearl`, `alabaster`, `anthracite`

## Selecting a Theme

Themes are configured in the Settings UI (Display → Theme) or via the config CLI:

```bash
omp config set theme dark
```

On first run, OMP uses the terminal background reported by `COLORFGBG` and falls back to `dark` if unavailable.

## Custom Themes

### Theme Locations

Custom themes are loaded from `~/.omp/agent/themes/*.json` by default, or from `$OMP_CODING_AGENT_DIR/themes` if that environment variable is set.

### Creating a Custom Theme

1. **Create theme directory:**

   ```bash
   mkdir -p "${OMP_CODING_AGENT_DIR:-~/.omp/agent}/themes"
   ```

2. **Create theme file:**

   ```bash
   vim "${OMP_CODING_AGENT_DIR:-~/.omp/agent}/themes/my-theme.json"
   ```

3. **Define all colors (see the schema for the full list; snippet below shows structure):**

   ```json
   {
   	"$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/modes/theme/theme-schema.json",
   	"name": "my-theme",
   	"vars": {
   		"primary": "#00aaff",
   		"secondary": 242,
   		"brightGreen": 46
   	},
   	"colors": {
   		"accent": "primary",
   		"border": "primary",
   		"borderAccent": "#00ffff",
   		"borderMuted": "secondary",
   		"success": "brightGreen",
   		"error": "#ff0000",
   		"warning": "#ffff00",
   		"muted": "secondary",
   		"text": "",

   		"userMessageBg": "#2d2d30",
   		"userMessageText": "",
   		"toolPendingBg": "#1e1e2e",
   		"toolSuccessBg": "#1e2e1e",
   		"toolErrorBg": "#2e1e1e",
   		"toolTitle": "",
   		"toolOutput": "",
   		// ...

   		"mdHeading": "#ffaa00",
   		"mdLink": "primary",
   		"mdCode": "#00ffff",
   		"mdCodeBlock": "#00ff00",
   		"mdCodeBlockBorder": "secondary",
   		"mdQuote": "secondary",
   		"mdQuoteBorder": "secondary",
   		"mdHr": "secondary",
   		"mdListBullet": "#00ffff",

   		"toolDiffAdded": "#00ff00",
   		"toolDiffRemoved": "#ff0000",
   		"toolDiffContext": "secondary",

   		"syntaxComment": "secondary",
   		"syntaxKeyword": "primary",
   		"syntaxFunction": "#00aaff",
   		"syntaxVariable": "#ffaa00",
   		"syntaxString": "#00ff00",
   		"syntaxNumber": "#ff00ff",
   		"syntaxType": "#00aaff",
   		"syntaxOperator": "primary",
   		"syntaxPunctuation": "secondary",

   		"thinkingOff": "secondary",
   		"thinkingMinimal": "primary",
   		"thinkingLow": "#00aaff",
   		"thinkingMedium": "#00ffff",
   		"thinkingHigh": "#ff00ff",
   		"thinkingXhigh": "#ff88ff"
   		// ... plus bashMode, pythonMode, statusLine* colors
   	}
   }
   ```

4. **Select your theme:**
   - Use the Settings UI (Display → Theme)
   - Or run `omp config set theme my-theme`

## Tips

### Light vs Dark Themes

**For dark terminals:**

- Use bright, saturated colors
- Higher contrast
- Example: `#00ffff` (bright cyan)

**For light terminals:**

- Use darker, muted colors
- Lower contrast to avoid eye strain
- Example: `#008888` (dark cyan)

### Color Harmony

- Start with a base palette (e.g., Nord, Gruvbox, Tokyo Night)
- Define your palette in `vars`
- Reference colors consistently

### Testing

Test your theme with:

- Different message types (user, assistant, errors)
- Tool executions (success and error states)
- Markdown content (headings, code, lists, etc)
- Long text that wraps

## Color Format Reference

### Hex Colors

Standard 6-digit hex format:

- `"#ff0000"` - Red
- `"#00ff00"` - Green
- `"#0000ff"` - Blue
- `"#808080"` - Gray
- `"#ffffff"` - White
- `"#000000"` - Black

RGB values: `#RRGGBB` where each component is `00-ff` (0-255)

### 256-Color Palette

Use numeric indices (0-255) to reference the xterm 256-color palette:

**Colors 0-15:** Basic ANSI colors (terminal-dependent, may be themed)

- `0` - Black
- `1` - Red
- `2` - Green
- `3` - Yellow
- `4` - Blue
- `5` - Magenta
- `6` - Cyan
- `7` - White
- `8-15` - Bright variants

**Colors 16-231:** 6×6×6 RGB cube (standardized)

- Formula: `16 + 36×R + 6×G + B` where R, G, B are 0-5
- Example: `39` = bright cyan, `196` = bright red

**Colors 232-255:** Grayscale ramp (standardized)

- `232` - Darkest gray
- `255` - Near white

Example usage:

```json
{
	"vars": {
		"gray": 242,
		"brightCyan": 51,
		"darkBlue": 18
	},
	"colors": {
		"muted": "gray",
		"accent": "brightCyan"
	}
}
```

**Benefits:**

- Works everywhere (`TERM=xterm-256color`)
- No truecolor detection needed
- Standardized RGB cube (16-231) looks the same on all terminals

### Terminal Compatibility

OMP prefers 24-bit RGB colors (`\x1b[38;2;R;G;Bm`) and assumes truecolor on modern terminals.

Color mode detection:

- `COLORTERM=truecolor|24bit` or `WT_SESSION` → truecolor
- `TERM=dumb`, `TERM=linux`, or empty `TERM` → 256-color fallback
- Otherwise → truecolor

If you need to confirm terminal hints:

```bash
echo $COLORTERM
```

## Example Themes

See the built-in themes for complete examples:

- [Dark theme](../src/modes/theme/dark.json)
- [Light theme](../src/modes/theme/light.json)
- [Defaults library](../src/modes/theme/defaults)

## Schema Validation

Themes are validated on load using [TypeBox](https://github.com/sinclairzx81/typebox) and the TypeBox compiler.

Invalid themes will show an error with details about what's wrong:

```
Invalid theme "my-theme":

Missing required color tokens:
  - mdHeading
  - mdLink

Other errors:
  - /colors/accent: Expected union value
```

For editor support, the JSON schema is available at:

```
https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/modes/theme/theme-schema.json
```

Add to your theme file for auto-completion and validation:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/modes/theme/theme-schema.json",
  ...
}
```

## Implementation

### Theme Class

Themes are loaded and converted to a `Theme` class that provides type-safe color methods:

```typescript
class Theme {
	// Apply foreground color
	fg(color: ThemeColor, text: string): string;

	// Apply background color
	bg(color: ThemeBg, text: string): string;

	// Text attributes (preserve current colors)
	bold(text: string): string;
	italic(text: string): string;
	underline(text: string): string;
	strikethrough(text: string): string;
	inverse(text: string): string;

	// Raw ANSI codes (for composing with other formatters)
	getFgAnsi(color: ThemeColor): string;
	getBgAnsi(color: ThemeBg): string;

	// Symbol access
	symbol(key: SymbolKey): string;
	styledSymbol(key: SymbolKey, color: ThemeColor): string;
	getSymbolPreset(): SymbolPreset;

	// Category accessors (return grouped symbol objects)
	get status(): { success, error, warning, ... };
	get nav(): { cursor, selected, expand, collapse, back };
	get icon(): { model, folder, file, git, ... };
	get boxRound(): { topLeft, topRight, ... };
	get boxSharp(): { topLeft, topRight, ... };
	get sep(): { powerline, dot, slash, pipe, ... };
	get thinking(): { minimal, low, medium, high, xhigh };
	get spinnerFrames(): string[];

	// Language icon lookup
	getLangIcon(lang: string | undefined): string;
}
```

### Global Theme Instance

The active theme is available as a global singleton in `coding-agent`:

```typescript
// theme.ts
export let theme: Theme;

export async function initTheme(
	themeName?: string,
	enableWatcher?: boolean,
	symbolPreset?: SymbolPreset,
	colorBlindMode?: boolean,
): Promise<void>;
export async function setTheme(
	name: string,
	enableWatcher?: boolean,
): Promise<{ success: boolean; error?: string }>;

// Usage throughout coding-agent
import { theme } from "./theme.js";

theme.fg("accent", "Selected");
theme.bg("userMessageBg", content);
```

### TUI Component Theming

TUI components (like `Markdown`, `SelectList`, `Editor`) are in the `@oh-my-pi/pi-tui` package and don't have direct access to the theme. Instead, they define interfaces for the colors they need:

```typescript
// In @oh-my-pi/pi-tui
export interface MarkdownTheme {
	heading: (text: string) => string;
	link: (text: string) => string;
	linkUrl: (text: string) => string;
	code: (text: string) => string;
	codeBlock: (text: string) => string;
	codeBlockBorder: (text: string) => string;
	quote: (text: string) => string;
	quoteBorder: (text: string) => string;
	hr: (text: string) => string;
	listBullet: (text: string) => string;
	bold: (text: string) => string;
	italic: (text: string) => string;
	strikethrough: (text: string) => string;
	underline: (text: string) => string;
	highlightCode?: (code: string, lang?: string) => string[];
	getMermaidImage?: (sourceHash: string) => MermaidImage | null;
	symbols: SymbolTheme;
}
```

The `coding-agent` bridges the theme to TUI components via exported helpers:

```typescript
// Exported helper in theme.ts
export function getMarkdownTheme(): MarkdownTheme {
	return {
		heading: (text) => theme.fg("mdHeading", text),
		link: (text) => theme.fg("mdLink", text),
		// ... all color mappings ...
		bold: (text) => theme.bold(text),
		italic: (text) => theme.italic(text),
		underline: (text) => theme.underline(text),
		strikethrough: (text) => chalk.strikethrough(text),
		symbols: getSymbolTheme(),
		getMermaidImage,
		highlightCode: (code, lang) => { /* uses native syntax highlighter */ },
	};
}
```

This approach:

- Keeps TUI components theme-agnostic (reusable in other projects)
- Maintains type safety via interfaces
- Centralizes theme access in `coding-agent`

Similar helpers exist for other TUI components: `getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`, `getSymbolTheme()`.

**Example usage:**

```typescript
await initTheme("dark");

// Apply foreground colors
theme.fg("accent", "Selected");
theme.fg("success", "✓ Done");
theme.fg("error", "Failed");

// Apply background colors
theme.bg("userMessageBg", content);
theme.bg("toolSuccessBg", output);

// Combine styles
theme.bold(theme.fg("accent", "Title"));
theme.italic(theme.fg("muted", "metadata"));

// Nested foreground + background
const userMsg = theme.bg("userMessageBg", theme.fg("userMessageText", "Hello"));
```

**Color resolution:**

1. **Detect terminal capabilities:**
   - `COLORTERM=truecolor|24bit` or `WT_SESSION` → truecolor
   - `TERM=dumb`, `TERM=linux`, or empty `TERM` → 256-color
   - Otherwise → truecolor

2. **Load JSON theme file**

3. **Resolve `vars` references recursively:**

   ```json
   {
   	"vars": {
   		"primary": "#0066cc",
   		"accent": "primary"
   	},
   	"colors": {
   		"accent": "accent" // → "primary" → "#0066cc"
   	}
   }
   ```

4. **Convert colors to ANSI codes based on terminal capability:**

   - Empty string (`""`) → terminal default (foreground/background reset)
   - 256-color (`42`) → `\x1b[38;5;42m` / `\x1b[48;5;42m`
   - Hex or resolved vars → `Bun.color(value, "ansi-16m" | "ansi-256")`

5. **Cache as `Theme` instance**

This ensures themes work correctly regardless of terminal capabilities, with graceful degradation from truecolor to 256-color.
