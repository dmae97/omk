/**
 * Opt-in frame / key-to-screen harness with real chat components (spec 022).
 * (Not OMK_-prefixed: test/setup-env.ts scrubs OMK_* variables.)
 *
 *   TUI_BENCH=1 nice -n 19 ../../node_modules/.bin/vitest run test/chat-windowing-bench.test.ts
 *   TUI_BENCH_LINES=20000 (default) TUI_BENCH_FRAMES=60 (default)
 *   TUI_BENCH_SEED=2000 (optional line count; overrides the app default seed
 *   of 50 screens, 0 seeds only the live tail. Unset applies the app default,
 *   so the timed first frame paints the same window a real `--continue` does.)
 * Transcript of user / Markdown assistant / finished bash tool cards inside the
 * interactive ChatContainer, real Editor below, 120×40 byte-sink terminal.
 * keypress: TUI.handleInput("x") then synchronous doRender (key-to-screen minus
 * the 16 ms render throttle). stream: the tail assistant message grows each frame.
 * early: an old, off-screen tool card toggles expanded. Prints JSON; skipped in CI.
 *
 * firstFrameMs is the true cold first frame: the timed transcript is built
 * without any render call, so no render cache is warm when doRender() runs.
 * Transcript construction is reported separately as buildMs, and the probe
 * that counts how many turns reach the target size renders a throwaway
 * transcript that is never timed.
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

/** App default prefix seed, in screens (SettingsManager.getScrollbackSeedScreens()). */
const DEFAULT_SEED_SCREENS = 50;

class SinkTerminal {
	columns = 120;
	rows = 40;
	kittyProtocolActive = false;
	bytes = 0;
	write(data: string) {
		this.bytes += Buffer.byteLength(data, "utf8");
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

/** Append one synthetic turn (user + assistant + finished bash tool card). */
function addTurn(
	chat: ChatContainer,
	tools: ToolExecutionComponent[],
	tui: TUI,
	i: number,
): void {
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
				text: [
					`$ rg cache src/module-${i}.ts`,
					...Array.from({ length: 12 }, (_, line) =>
						`src/module-${i}.ts:${line * 7 + 3}: cache rebuilt`,
					),
				].join("\n"),
			},
		],
		isError: false,
	});
	chat.addChild(tool);
	tools.push(tool);
}

describe.skipIf(!enabled)("chat windowing bench", () => {
	test("frame and key-to-screen timings", () => {
		initTheme("dark");
		const terminal = new SinkTerminal();
		const tui = new TUI(terminal as never);

		// Probe: count the turns that reach the target size. This renders a
		// throwaway transcript, so the timed container below stays cold.
		const probe = new ChatContainer();
		const probeTools: ToolExecutionComponent[] = [];
		let turns = 0;
		while (probe.render(118).length < targetLines) {
			addTurn(probe, probeTools, tui, turns);
			turns += 1;
		}
		const transcriptLines = probe.render(118).length;

		// Timed build: construct the identical transcript without rendering
		// it, so the first doRender() below is the true first frame.
		const chat = new ChatContainer();
		const editor = new Editor(tui, getEditorTheme());
		tui.addChild(chat);
		tui.addChild(editor);
		tui.setFocus(editor);
		const tools: ToolExecutionComponent[] = [];
		const buildStart = performance.now();
		for (let i = 0; i < turns; i++) addTurn(chat, tools, tui, i);
		const buildMs = performance.now() - buildStart;

		// Seed the prefix like the app does: InteractiveMode applies the
		// default 50 screens unless TUI_BENCH_SEED overrides it with a line
		// count.
		const seedOverride =
			process.env.TUI_BENCH_SEED === undefined
				? undefined
				: Number(process.env.TUI_BENCH_SEED);
		if (seedOverride !== undefined) chat.setPrefixSeed(seedOverride);
		else chat.setPrefixSeedViewport(DEFAULT_SEED_SCREENS, () => terminal.rows);

		const doRender = () => (tui as unknown as { doRender(): void }).doRender();
		const firstStart = performance.now();
		doRender();
		const firstFrame = performance.now() - firstStart;
		const lines = chat.render(118).length;
		const heapAfterFirstMB = process.memoryUsage().heapUsed / 1024 / 1024;

		const tail = new AssistantMessageComponent(assistant(""));
		chat.addChild(tail);
		const keyToScreen: number[] = [];
		const streamFrames: number[] = [];
		tail.startStreaming();
		const startBytes = terminal.bytes;
		for (let frame = 0; frame < frames; frame++) {
			tail.appendText(`token${frame} `);
			const start = performance.now();
			if (frame === Math.floor(frames / 2)) {
				tui.handleInput("x");
				doRender();
				keyToScreen.push(performance.now() - start);
			} else {
				doRender();
				streamFrames.push(performance.now() - start);
			}
		}
		const early = tools[Math.floor(tools.length / 2)];
		const earlyStart = performance.now();
		early?.toggleExpanded();
		doRender();
		const earlyToggleFrame = performance.now() - earlyStart;
		console.log(
			JSON.stringify({
				transcriptLines,
				turns,
				lines,
				firstFrameMs: +firstFrame.toFixed(1),
				buildMs: +buildMs.toFixed(1),
				seedScreens: seedOverride === undefined ? DEFAULT_SEED_SCREENS : undefined,
				seedLines: seedOverride,
				firstFrameBytes: terminal.bytes - startBytes,
				heapAfterFirstMB: +heapAfterFirstMB.toFixed(1),
				keyToScreenMs: stats(keyToScreen),
				streamFrameMs: stats(streamFrames),
				earlyToggleFrameMs: +earlyToggleFrame.toFixed(1),
				streamFrameBytes: terminal.bytes - startBytes,
				heapUsedMB: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
				heapTotalMB: +(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(1),
				pidRssMB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
				runtimeMs: process.env.TUI_BENCH_RUNTIME_S
					? +process.env.TUI_BENCH_RUNTIME_S
					: undefined,
				ttfbMs: process.env.TUI_BENCH_TTFB
					? +process.env.TUI_BENCH_TTFB
					: undefined,
			}),
		);
		expect(lines).toBeLessThanOrEqual(transcriptLines);
		expect(firstFrame).toBeLessThanOrEqual(
			process.env.TUI_BENCH_RUNTIME_S
				? +process.env.TUI_BENCH_RUNTIME_S
				: firstFrame,
		);
		expect(process.env.TUI_BENCH_TTFB ? +process.env.TUI_BENCH_TTFB : 0).toBeLessThanOrEqual(
			process.env.TUI_BENCH_RUNTIME_S ? +process.env.TUI_BENCH_RUNTIME_S : 0,
		);
	});
});
