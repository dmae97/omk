import { type Component, Container, isFocusable, isRenderSettled, type TUI, WindowedContainer } from "omk-tui";
import {
	type ChatScrollSlice,
	type ChatScrollState,
	reduceChatScrollState,
	renderChatScrollOverlayRows,
	resolveChatScrollSlice,
} from "./chat-scroll-model.ts";
import {
	hasSgrFastScrollModifier,
	isSgrLeftPress,
	isSgrWheelDown,
	isSgrWheelUp,
	parseSgrMouse,
} from "./files-sidebar-mouse.ts";

export { type ChatScrollSlice, type ChatScrollState, reduceChatScrollState, resolveChatScrollSlice };

export interface ChatWheelScrollOptions {
	readonly ui: TUI;
	readonly getLeftGutter: (termWidth: number, termHeight: number) => number;
	readonly getEditor: () => Component;
	readonly isSidebarFocused: () => boolean;
}

export interface ChatWheelScrollController {
	attachInputListener(): void;
	reset(): void;
	isScrolled(): boolean;
}

interface LayoutSnapshot {
	readonly transcriptLines: readonly string[];
	readonly viewportRows: number;
}

export function setupChatWheelScroll(options: ChatWheelScrollOptions): ChatWheelScrollController {
	const { ui, getLeftGutter, getEditor, isSidebarFocused } = options;
	let state: ChatScrollState = { kind: "tail" };
	let cachedVirtualKey = "";
	let cachedVirtualFirst: Component | undefined;
	let cachedVirtualLines: string[] = [];
	let cachedTranscriptKey = "";
	let cachedTranscriptLines: readonly string[] = [];
	let lastChatFirstChild: Component | undefined;

	const findSplitIndex = (): { splitIdx: number; chat: WindowedContainer | undefined } => {
		const editor = getEditor();
		const editorIdx = ui.children.findIndex(
			(child) => child === editor || (child instanceof Container && child.children.includes(editor)),
		);
		const chatIdx = ui.children.findIndex((child) => child instanceof WindowedContainer);
		const chat = chatIdx >= 0 ? (ui.children[chatIdx] as WindowedContainer) : undefined;
		if (editorIdx < 0) return { splitIdx: ui.children.length, chat };
		return { splitIdx: chatIdx >= 0 ? Math.min(editorIdx, chatIdx + 3) : editorIdx, chat };
	};

	const readVirtualPrefixLines = (chat: WindowedContainer, width: number): readonly string[] => {
		const virtualCount = chat.getVirtualChildCount();
		if (virtualCount <= 0) return [];
		const first = chat.children[0];
		const key = `${width}:${virtualCount}`;
		if (key === cachedVirtualKey && first === cachedVirtualFirst) return cachedVirtualLines;
		const out: string[] = [];
		for (let i = 0; i < virtualCount && i < chat.children.length; i++) {
			for (const line of chat.children[i]!.render(width)) out.push(line);
		}
		cachedVirtualKey = key;
		cachedVirtualFirst = first;
		cachedVirtualLines = out;
		return out;
	};

	const readLayout = (contentWidth: number, termHeight: number): LayoutSnapshot => {
		const safeWidth = Math.max(1, contentWidth);
		const { splitIdx, chat } = findSplitIndex();
		if (chat) {
			const currentFirst = chat.children[0];
			if (chat.children.length === 0 || (lastChatFirstChild !== undefined && currentFirst !== lastChatFirstChild)) {
				state = { kind: "tail" };
				cachedVirtualKey = "";
				cachedTranscriptKey = "";
			}
			lastChatFirstChild = currentFirst;
		}

		let bottomRows = 0;
		for (let i = splitIdx; i < ui.children.length; i++) bottomRows += ui.children[i]!.render(safeWidth).length;
		const viewportRows = Math.max(0, termHeight - bottomRows);

		const genParts: string[] = [`w=${safeWidth}`, `s=${splitIdx}`];
		let canUseCache = true;
		for (let i = 0; i < splitIdx; i++) {
			const c = ui.children[i]!;
			const gen = c.getRenderGeneration?.();
			const settled =
				isRenderSettled(c) && (!(c instanceof Container) || c.children.every((n) => isRenderSettled(n)));
			if (gen === undefined || !settled) canUseCache = false;
			else genParts.push(String(gen));
		}
		const transcriptKey = canUseCache ? genParts.join("|") : "";

		let transcriptLines: readonly string[];
		if (canUseCache && transcriptKey === cachedTranscriptKey) {
			transcriptLines = cachedTranscriptLines;
		} else {
			const parts: (readonly string[])[] = [];
			for (let i = 0; i < splitIdx; i++) {
				const child = ui.children[i]!;
				if (child === chat) {
					const tailLines = chat.render(safeWidth);
					const prefixLines = readVirtualPrefixLines(chat, safeWidth);
					if (prefixLines.length > 0) parts.push(prefixLines);
					parts.push(tailLines);
				} else {
					parts.push(child.render(safeWidth));
				}
			}
			transcriptLines = ([] as string[]).concat(...parts);
			if (canUseCache) {
				cachedTranscriptKey = transcriptKey;
				cachedTranscriptLines = transcriptLines;
			}
		}

		if (
			state.kind === "scrolled" &&
			(viewportRows < 2 || transcriptLines.length <= viewportRows || state.anchorEndLine >= transcriptLines.length)
		) {
			state = { kind: "tail" };
		}
		return { transcriptLines, viewportRows };
	};

	const overlay: Component = {
		invalidate() {
			cachedVirtualKey = "";
			cachedTranscriptKey = "";
		},
		render(overlayWidth: number): string[] {
			if (state.kind === "tail") return [];
			const leftGutter = getLeftGutter(ui.terminal.columns, ui.terminal.rows);
			const contentWidth = Math.max(1, overlayWidth - leftGutter);
			const layout = readLayout(contentWidth, ui.terminal.rows);
			const slice = resolveChatScrollSlice(state, layout.transcriptLines, layout.viewportRows);
			return slice ? renderChatScrollOverlayRows(slice, leftGutter, contentWidth) : [];
		},
	};

	ui.showOverlay(overlay, {
		anchor: "top-left",
		width: (termWidth, termHeight) => getLeftGutter(termWidth, termHeight) + ui.contentWidth,
		nonCapturing: true,
		visible: () => state.kind === "scrolled",
	});

	return {
		attachInputListener() {
			ui.addInputListener((data) => {
				const mouse = parseSgrMouse(data);
				if (!mouse) {
					if (state.kind === "scrolled" && (data === "\r" || data === "\n" || data === "\x1b[13u")) {
						const ed = getEditor() as Component & { getText?: () => string };
						if ((ed.getText?.() ?? "").trim().length > 0) {
							process.nextTick(() => {
								if ((ed.getText?.() ?? "") === "") {
									state = { kind: "tail" };
									ui.requestRender();
								}
							});
						}
					}
					return undefined;
				}
				const editor = getEditor();
				if (!(isFocusable(editor) ? editor.focused : true) && !isSidebarFocused()) {
					if (isSgrWheelUp(mouse)) return { data: "\x1b[A" };
					if (isSgrWheelDown(mouse)) return { data: "\x1b[B" };
					return undefined;
				}
				if (isSgrWheelUp(mouse) || isSgrWheelDown(mouse)) {
					const layout = readLayout(ui.contentWidth, ui.terminal.rows);
					const step = hasSgrFastScrollModifier(mouse) ? Math.max(6, Math.floor(layout.viewportRows * 0.5)) : 3;
					state = reduceChatScrollState(
						state,
						isSgrWheelUp(mouse) ? -step : step,
						layout.transcriptLines.length,
						layout.viewportRows,
					);
					ui.requestRender();
					return { consume: true };
				}
				if (state.kind === "scrolled" && isSgrLeftPress(mouse)) {
					const leftGutter = getLeftGutter(ui.terminal.columns, ui.terminal.rows);
					const contentWidth = ui.contentWidth;
					const layout = readLayout(contentWidth, ui.terminal.rows);
					if (
						mouse.row === layout.viewportRows &&
						mouse.col > leftGutter &&
						mouse.col <= leftGutter + contentWidth
					) {
						state = { kind: "tail" };
						ui.requestRender();
						return { consume: true };
					}
				}
				return undefined;
			});
		},
		reset() {
			if (state.kind !== "tail") {
				state = { kind: "tail" };
				ui.requestRender();
			}
		},
		isScrolled: () => state.kind === "scrolled",
	};
}
