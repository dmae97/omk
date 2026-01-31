// Core TUI interfaces and classes

// Autocomplete support
export {
	type AutocompleteItem,
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "./autocomplete";
// Components
export { Box } from "./components/box";
export { CancellableLoader } from "./components/cancellable-loader";
export { Editor, type EditorTheme, type EditorTopBorder } from "./components/editor";
export { Image, type ImageOptions, type ImageTheme } from "./components/image";
export { Input } from "./components/input";
export { Loader } from "./components/loader";
export { type DefaultTextStyle, Markdown, type MarkdownTheme } from "./components/markdown";
export { type SelectItem, SelectList, type SelectListTheme } from "./components/select-list";
export { type SettingItem, SettingsList, type SettingsListTheme } from "./components/settings-list";
export { Spacer } from "./components/spacer";
export { type Tab, TabBar, type TabBarTheme } from "./components/tab-bar";
export { Text } from "./components/text";
export { TruncatedText } from "./components/truncated-text";
// Editor component interface (for custom editors)
export type { EditorComponent } from "./editor-component";
// Fuzzy matching
export { type FuzzyMatch, fuzzyFilter, fuzzyMatch } from "./fuzzy";
// Keybindings
export {
	DEFAULT_EDITOR_KEYBINDINGS,
	type EditorAction,
	type EditorKeybindingsConfig,
	EditorKeybindingsManager,
	getEditorKeybindings,
	setEditorKeybindings,
} from "./keybindings";
// Kitty keyboard protocol helpers
export {
	isKeyRelease,
	isKeyRepeat,
	isKittyProtocolActive,
	Key,
	type KeyEventType,
	type KeyId,
	matchesKey,
	parseKey,
	parseKittySequence,
	setKittyProtocolActive,
} from "./keys";
// Mermaid diagram support
export {
	extractMermaidBlocks,
	type MermaidImage,
	type MermaidRenderOptions,
	prerenderMermaidBlocks,
	renderMermaidToPng,
} from "./mermaid";
// Input buffering for batch splitting
export { StdinBuffer, type StdinBufferEventMap, type StdinBufferOptions } from "./stdin-buffer";
export type { BoxSymbols, SymbolTheme } from "./symbols";
// Terminal interface and implementations
export { emergencyTerminalRestore, ProcessTerminal, type Terminal } from "./terminal";
// Terminal image support
export {
	type CellDimensions,
	calculateImageRows,
	encodeITerm2,
	encodeKitty,
	getCellDimensions,
	getGifDimensions,
	getImageDimensions,
	getJpegDimensions,
	getPngDimensions,
	getTerminalInfo,
	getWebpDimensions,
	type ImageDimensions,
	type ImageRenderOptions,
	imageFallback,
	renderImage,
	setCellDimensions,
	TERMINAL_ID,
	TERMINAL_INFO,
	type TerminalId,
	type TerminalInfo,
} from "./terminal-image";
export { type Component, Container, type OverlayHandle, type SizeValue, TUI } from "./tui";
// Utilities
export { padding, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "./utils";
