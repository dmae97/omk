/**
 * Opt-in frame / key-to-screen harness with real chat components (spec 022).
 * (Not OMK_-prefixed: test/setup-env.ts scrubs OMK_* variables.)
 *
 *   TUI_BENCH=1 nice -n 19 ../../node_modules/.bin/vitest run test/chat-windowing-bench.test.ts
 *   TUI_BENCH_LINES=20000 (default) TUI_BENCH_FRAMES=60 (default)
 *
 * Transcript of user / Markdown assistant / finished bash tool cards inside the
 * interactive ChatContainer, real Editor below, 120×40 byte-sink terminal.
 * keypress: TUI.handleInput("x") then synchronous doRender (key-to-screen minus
 * the 16 ms render throttle). stream: the tail assistant message grows each frame.
 * early: an old, off-screen tool card toggles expanded. Prints JSON; skipped in CI.
 */
import type { AssistantMessage } from "omk-ai";
import { Editor, TUI } from "omk-tui";
import { describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { ChatContainer } from "../src/modes/interactive/components/chat-container.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

const enabled = process.env.TUI_BENCH === "1";
const targetLines = Number(process.env.TUI_BENCH_LINES ?? 20000);
const frames = Number(process.env.TUI_BENCH_FRAMES ?? 60);

class SinkTerminal {
	columns = 120;
	rows = 40;
	kittyProtocolActive = false;
	bytes = 0;
	write(data: string) {
		this.bytes += data.length;
	}
	start() {}
	stop() {}
	drainInput() {
		return Promise.resolve();
	}
	moveBy() {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle() {}
	setProgress() {}
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

function reply(i: number): string {
	return [
		`## Step ${i}`,
		"",
		`Looking at \`src/module-${i}.ts\`, the **cache** is rebuilt on every call. ${"The fix keeps the parsed tokens. ".repeat(4)}`,
		"",
		"- first, measure the hot path",
		"- then, keep the prefix",
		"",
		"```ts",
		`export function f${i}(x: number): number {`,
		"\treturn x * 2;",
		"}",
		"```",
	].join("\n");
}

function stats(times: number[]) {
	const sorted = [...times].sort((a, b) => a - b);
	const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
	return {
		mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2),
		p50: +pick(0.5).toFixed(2),
		p95: +pick(0.95).toFixed(2),
	};
}

describe.skipIf(!enabled)("chat windowing bench", () => {
	test("frame and key-to-screen timings", () => {
		initTheme("dark");
		const terminal = new SinkTerminal();
		const tui = new TUI(terminal as never);
		const chat = new ChatContainer();
		const editor = new Editor(tui, getEditorTheme());
		tui.addChild(chat);
		tui.addChild(editor);
		tui.setFocus(editor);
		const tools: ToolExecutionComponent[] = [];
		let i = 0;
		while (chat.render(118).length < targetLines) {
			chat.addChild(new UserMessageComponent(`Please look at module ${i} and fix the cache.`));
			chat.addChild(new AssistantMessageComponent(assistant(reply(i))));
			const tool = new ToolExecutionComponent(
				"bash",
				`call-${i}`,
				{ command: `rg cache src/module-${i}.ts` },
				{},
				undefined,
				tui,
				process.cwd(),
			);
			tool.updateResult({
				content: [
					{
						type: "text",
						text: Array.from({ length: 12 }, (_, l) => `src/module-${i}.ts:${l}: cache`).join("\n"),
					},
				],
				isError: false,
			});
			chat.addChild(tool);
			tools.push(tool);
			i++;
		}
		const tail = new AssistantMessageComponent(undefined);
		chat.addChild(tail);
		const doRender = () => (tui as unknown as { doRender(): void }).doRender();
		const firstStart = performance.now();
		doRender();
		const firstFrame = performance.now() - firstStart;
		const heapAfterFirst = process.memoryUsage().heapUsed;
		const lines = chat.render(118).length;
		const input = (tui as unknown as { handleInput(data: string): void }).handleInput.bind(tui);
		const run = (mutate: (f: number) => void) => {
			for (let f = 0; f < 5; f++) {
				mutate(f + 10_000);
				doRender();
			}
			const times: number[] = [];
			for (let f = 0; f < frames; f++) {
				const t0 = performance.now();
				mutate(f);
				doRender();
				times.push(performance.now() - t0);
			}
			return stats(times);
		};
		let streamed = "";
		const result = {
			impl: "getFrozenChildCount" in chat ? "windowed" : "full",
			lines,
			children: chat.children.length,
			firstFrameMs: +firstFrame.toFixed(1),
			heapAfterFirstMB: +(heapAfterFirst / 1048576).toFixed(1),
			keypress: run((f) => input(f % 10 === 9 ? "\x7f" : "x")),
			stream: run((f) => {
				streamed += `word${f} `;
				tail.updateContent(assistant(streamed));
			}),
			early: run((f) => tools[3].setExpanded(f % 2 === 0)),
		};
		console.log(`BENCH ${JSON.stringify(result)}`);
		expect(result.lines).toBeGreaterThanOrEqual(targetLines);
	});
});
