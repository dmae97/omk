import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TmuxStatusRail } from "../src/modes/interactive/tmux-status-rail.ts";

const rails: TmuxStatusRail[] = [];
afterEach(() => {
	for (const rail of rails.splice(0)) rail.dispose();
	vi.useRealTimers();
});

describe("tmux status rail ownership", () => {
	it("restores width after a resize and falls back when the viewer heartbeat stops", () => {
		vi.useFakeTimers();
		const runTmux = vi.fn(() => "%8");
		const closed = vi.fn();
		const rail = new TmuxStatusRail(() => ["Session"], { pane: "%7", runTmux, onClose: closed });
		rails.push(rail);
		rail.start();
		const framePath = rail.framePath!;
		writeFileSync(join(dirname(framePath), "size.json"), JSON.stringify({ columns: 20, rows: 24, at: Date.now() }));
		vi.advanceTimersByTime(1000);
		expect(runTmux).toHaveBeenCalledWith(["resize-pane", "-t", "%8", "-x", "40"]);
		vi.advanceTimersByTime(6000);
		expect(rail.active).toBe(false);
		expect(existsSync(framePath)).toBe(false);
		expect(closed).toHaveBeenCalledOnce();
	});

	it("drains an owned pane if its first frame cannot render", () => {
		const runTmux = vi.fn(() => "%8");
		const rail = new TmuxStatusRail(
			() => {
				throw new Error("render failed");
			},
			{ pane: "%7", runTmux },
		);
		rails.push(rail);
		expect(rail.start()).toBe(false);
		expect(rail.active).toBe(false);
		expect(runTmux).toHaveBeenLastCalledWith(["kill-pane", "-t", "%8"]);
	});

	it("uses a separate unfocused pane and removes only its own pane and private frame", () => {
		const commands: string[][] = [];
		const rail = new TmuxStatusRail(() => ["Session", "model  test"], {
			pane: "%7",
			runTmux: (args) => {
				commands.push(args);
				return "%8\n";
			},
		});
		rails.push(rail);
		expect(rail.start()).toBe(true);
		expect(rail.active).toBe(true);
		const split = commands.find((args) => args[0] === "split-window")!;
		expect(split).toContain("-d");
		expect(split.slice(split.indexOf("-t"), split.indexOf("-t") + 2)).toEqual(["-t", "%7"]);
		const framePath = rail.framePath!;
		expect(JSON.parse(readFileSync(framePath, "utf8")).lines).toEqual(["Session", "model  test"]);
		expect(statSync(framePath).mode & 0o777).toBe(0o600);
		expect(statSync(dirname(framePath)).mode & 0o777).toBe(0o700);
		rail.dispose();
		expect(commands.at(-1)).toEqual(["kill-pane", "-t", "%8"]);
		expect(existsSync(framePath)).toBe(false);
		expect(rail.active).toBe(false);
	});

	it("leaves the native rail available when tmux cannot split", () => {
		const rail = new TmuxStatusRail(() => [], {
			pane: "%7",
			runTmux: () => {
				throw new Error("too small");
			},
		});
		rails.push(rail);
		expect(rail.start()).toBe(false);
		expect(rail.active).toBe(false);
		expect(rail.framePath).toBeUndefined();
	});

	it("does not split twice, restart after disposal, or accept a foreign pane target", () => {
		const runTmux = vi.fn(() => "%8");
		const rail = new TmuxStatusRail(() => [], { pane: "%7", runTmux });
		rails.push(rail);
		rail.start();
		rail.start();
		expect(runTmux).toHaveBeenCalledTimes(1);
		rail.dispose();
		expect(rail.start()).toBe(false);
		const invalid = new TmuxStatusRail(() => [], { pane: "other:0", runTmux });
		rails.push(invalid);
		expect(invalid.start()).toBe(false);
	});
});
