/**
 * Headless frame-time harness for spec 022 (AC1 + early mutation).
 *
 *   nice -n 19 node --experimental-strip-types packages/tui/test/windowing-bench.ts
 *   OMK_ROOT=/path/to/other/checkout ... (compare against another tree, e.g. main)
 *   SIZES=5000,25000,100000 FRAMES=30
 *
 * FakeTerminal 120×40 byte sink, transcript of alternating Box(Text) / Text
 * with Spacer(1) between, a live editor Text below, synchronous doRender().
 * Scenarios per size (5 warm-up frames, then FRAMES measured):
 *   keypress     editor.setText each frame (AC1)
 *   early-same   an early, off-screen message changes text, same line count
 *   early-grow   an early, off-screen message alternates 1 ↔ 2 extra lines
 *   tail-stream  the last message grows each frame (streaming)
 * Reports mean / p50 / p95 doRender ms. Not a CI test: timings are machine-bound.
 */
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const root = process.env.OMK_ROOT ?? new URL("../../..", import.meta.url).pathname;
const src = (file: string) => pathToFileURL(`${root}/packages/tui/src/${file}`).href;
const { Container, TUI } = await import(src("tui.ts"));
const { Text } = await import(src("components/text.ts"));
const { Box } = await import(src("components/box.ts"));
const { Spacer } = await import(src("components/spacer.ts"));
let Windowed: (new () => any) | undefined;
try {
	({ WindowedContainer: Windowed } = await import(src("windowed-container.ts")));
} catch {
	Windowed = undefined;
}

const sizes = (process.env.SIZES ?? "5000,25000,100000").split(",").map(Number);
const frames = Number(process.env.FRAMES ?? 30);
const body = "The quick brown fox jumps over the lazy dog. ".repeat(3);

class SinkTerminal {
	columns = 120;
	rows = 40;
	kittyProtocolActive = false;
	write(_data: string) {}
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

function stats(times: number[]) {
	const sorted = [...times].sort((a, b) => a - b);
	const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
	const mean = times.reduce((a, b) => a + b, 0) / times.length;
	return { mean: +mean.toFixed(2), p50: +pick(0.5).toFixed(2), p95: +pick(0.95).toFixed(2) };
}

function build(minLines: number) {
	const chat = Windowed ? new Windowed() : new Container();
	let lines = 0;
	let i = 0;
	const texts: any[] = [];
	while (lines < minLines) {
		const text = new Text(`${i}:${body}`, i % 2 === 0 ? 0 : 1, 0);
		if (i % 2 === 0) {
			const box = new Box(1, 1, (s: string) => s);
			box.addChild(text);
			chat.addChild(box);
			lines += 4; // 2 wrapped rows + 2 padding rows at width 120
		} else {
			chat.addChild(text);
			lines += 2;
		}
		texts.push(text);
		chat.addChild(new Spacer(1));
		lines += 1;
		i++;
	}
	return { chat, texts };
}

for (const size of sizes) {
	const { chat, texts } = build(size);
	const tui = new TUI(new SinkTerminal());
	tui.addChild(chat);
	const editor = new Text("editor", 0, 0);
	tui.addChild(editor);
	const doRender = () => (tui as any).doRender();
	doRender();
	const total = chat.render(120).length;
	const early = texts[10];
	const tail = texts[texts.length - 1];
	const scenarios: Record<string, (frame: number) => void> = {
		keypress: (f) => editor.setText(`typed ${"x".repeat(f % 50)}`),
		"early-same": (f) => early.setText(`10:${f % 2 === 0 ? "A" : "B"}${body.slice(1)}`),
		"early-grow": (f) => early.setText(`10:${body}${f % 2 === 0 ? "\nextra" : "\nextra\nextra"}`),
		"tail-stream": (f) => tail.setText(`${body} ${"stream ".repeat(f)}`),
	};
	const row: Record<string, unknown> = { impl: Windowed ? "windowed" : "full", lines: total };
	for (const [name, mutate] of Object.entries(scenarios)) {
		for (let f = 0; f < 5; f++) {
			mutate(f + 1000);
			doRender();
		}
		const times: number[] = [];
		for (let f = 0; f < frames; f++) {
			mutate(f);
			const t0 = performance.now();
			doRender();
			times.push(performance.now() - t0);
		}
		row[name] = stats(times);
	}
	console.log(JSON.stringify(row));
}
