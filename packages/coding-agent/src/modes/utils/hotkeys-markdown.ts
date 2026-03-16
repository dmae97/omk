export interface HotkeysMarkdownBindings {
	expandToolsKey: string;
	planModeKey: string;
	sttKey: string;
	copyLineKey: string;
	copyPromptKey: string;
}

export function buildHotkeysMarkdown(bindings: HotkeysMarkdownBindings): string {
	const { expandToolsKey, planModeKey, sttKey, copyLineKey, copyPromptKey } = bindings;
	return [
		"**Navigation**",
		"| Key | Action |",
		"|-----|--------|",
		"| `Arrow keys` | Move cursor / browse history (Up when empty) |",
		"| `Option+Left/Right` | Move by word |",
		"| `Ctrl+A` / `Home` / `Cmd+Left` | Start of line |",
		"| `Ctrl+E` / `End` / `Cmd+Right` | End of line |",
		"",
		"**Editing**",
		"| Key | Action |",
		"|-----|--------|",
		"| `Enter` | Send message |",
		"| `Shift+Enter` / `Alt+Enter` | New line |",
		"| `Ctrl+W` / `Option+Backspace` | Delete word backwards |",
		"| `Ctrl+U` | Delete to start of line |",
		"| `Ctrl+K` | Delete to end of line |",
		`| \`${copyLineKey}\` | Copy current line |`,
		`| \`${copyPromptKey}\` | Copy whole prompt |`,
		"",
		"**Other**",
		"| Key | Action |",
		"|-----|--------|",
		"| `Tab` | Path completion / accept autocomplete |",
		"| `Escape` | Cancel autocomplete / abort streaming |",
		"| `Ctrl+C` | Clear editor (first) / exit (second) |",
		"| `Ctrl+D` | Exit (when editor is empty) |",
		"| `Ctrl+Z` | Suspend to background |",
		"| `Shift+Tab` | Cycle thinking level |",
		"| `Ctrl+P` | Cycle role models (slow/default/smol) |",
		"| `Shift+Ctrl+P` | Cycle role models (temporary) |",
		"| `Alt+P` | Select model (temporary) |",
		"| `Ctrl+L` | Select model (set roles) |",
		`| \`${planModeKey}\` | Toggle plan mode |`,
		"| `Ctrl+R` | Search prompt history |",
		`| \`${expandToolsKey}\` | Toggle tool output expansion |`,
		"| `Ctrl+T` | Toggle todo list expansion |",
		"| `Ctrl+G` | Edit message in external editor |",
		`| \`${sttKey}\` | Toggle speech-to-text recording |`,
		"| `#` | Open prompt actions |",
		"| `/` | Slash commands |",
		"| `!` | Run bash command |",
		"| `!!` | Run bash command (excluded from context) |",
		"| `$` | Run Python in shared kernel |",
		"| `$$` | Run Python (excluded from context) |",
	].join("\n");
}
