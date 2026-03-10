import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { ProcessTerminal } from "@oh-my-pi/pi-tui/terminal";

const stdinIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinSetRawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");

function restoreProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) {
		Object.defineProperty(target, key, descriptor);
		return;
	}
	delete (target as Record<string, unknown>)[key];
}

describe("ProcessTerminal OSC 11 appearance detection", () => {
	beforeEach(() => {
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdin, "setRawMode", { value: vi.fn(), configurable: true });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		restoreProperty(process.stdin, "isTTY", stdinIsTtyDescriptor);
		restoreProperty(process.stdout, "isTTY", stdoutIsTtyDescriptor);
		restoreProperty(process.stdin, "setRawMode", stdinSetRawModeDescriptor);
	});

	it("swallows the DA1 sentinel even when the OSC 11 reply arrives first", () => {
		const writes: string[] = [];
		vi.spyOn(process, "kill").mockReturnValue(true);
		vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
			writes.push(typeof chunk === "string" ? chunk : chunk.toString());
			return true;
		});

		const terminal = new ProcessTerminal();
		const received: string[] = [];
		terminal.start(
			data => received.push(data),
			() => {},
		);

		process.stdin.emit("data", "\x1b]11;rgb:ffff/ffff/ffff\x07");
		process.stdin.emit("data", "\x1b[?1;2c");

		expect(received).toEqual([]);
		expect(writes).toContain("\x1b]11;?\x07");
		expect(writes).toContain("\x1b[c");

		terminal.stop();
	});

	it("queues overlapping OSC 11 queries until the in-flight DA1 sentinel is consumed", () => {
		vi.useFakeTimers();
		const writes: string[] = [];
		vi.spyOn(process, "kill").mockReturnValue(true);
		vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
		vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
			writes.push(typeof chunk === "string" ? chunk : chunk.toString());
			return true;
		});

		const terminal = new ProcessTerminal();
		terminal.start(
			() => {},
			() => {},
		);

		const queryCount = () => writes.filter(write => write === "\x1b]11;?\x07").length;
		const sentinelCount = () => writes.filter(write => write === "\x1b[c").length;

		expect(queryCount()).toBe(1);
		expect(sentinelCount()).toBe(1);

		process.stdin.emit("data", "\x1b[?997;1n");
		vi.advanceTimersByTime(100);

		expect(queryCount()).toBe(1);
		expect(sentinelCount()).toBe(1);

		process.stdin.emit("data", "\x1b[?1;2c");

		expect(queryCount()).toBe(2);
		expect(sentinelCount()).toBe(2);

		terminal.stop();
	});
});
