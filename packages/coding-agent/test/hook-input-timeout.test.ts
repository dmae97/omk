import { afterEach, beforeAll, describe, expect, it, mock, vi } from "bun:test";

import type { TUI } from "@oh-my-pi/pi-tui";
mock.module("@oh-my-pi/pi-tui", () => {
	class Container {
		addChild(_child: unknown): void {}
	}

	class Input {
		#value = "";

		handleInput(keyData: string): void {
			if (keyData === "\x7f") {
				this.#value = this.#value.slice(0, -1);
				return;
			}
			if (keyData.length === 1) {
				this.#value += keyData;
			}
		}

		getValue(): string {
			return this.#value;
		}
	}

	class Spacer {
		constructor(_height: number) {}
	}

	class Text {
		constructor(_text: string, _x: number, _y: number) {}
		setText(_text: string): void {}
	}

	const matchesKey = (keyData: string, key: string): boolean => {
		if (key === "enter" || key === "return") return keyData === "\n";
		if (key === "escape" || key === "esc") return keyData === "\u001b";
		return false;
	};

	return { Container, Input, Spacer, Text, matchesKey };
});

mock.module("@oh-my-pi/pi-coding-agent/modes/theme/theme", () => ({
	theme: {
		fg: (_token: string, text: string) => text,
		nav: { cursor: ">" },
	},
}));

let HookInputComponent: typeof import("@oh-my-pi/pi-coding-agent/modes/components/hook-input").HookInputComponent;

beforeAll(async () => {
	({ HookInputComponent } = await import("@oh-my-pi/pi-coding-agent/modes/components/hook-input"));
});

describe("HookInputComponent timeout", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resets timeout on user activity and still expires when idle", () => {
		vi.useFakeTimers();

		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const onTimeout = vi.fn();
		const tui = { requestRender: vi.fn() } as unknown as TUI;

		const component = new HookInputComponent(
			"Prompt",
			undefined,
			onSubmit,
			onCancel,
			{ timeout: 1_000, tui, onTimeout },
		);

		vi.advanceTimersByTime(900);
		component.handleInput("a");

		vi.advanceTimersByTime(900);
		component.handleInput("\x7f");

		vi.advanceTimersByTime(900);
		expect(onTimeout).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();

		vi.advanceTimersByTime(200);
		expect(onTimeout).toHaveBeenCalledTimes(1);
		expect(onCancel).toHaveBeenCalledTimes(1);

		component.dispose();
	});

	it("preserves submit behavior", () => {
		vi.useFakeTimers();

		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const onTimeout = vi.fn();
		const tui = { requestRender: vi.fn() } as unknown as TUI;

		const component = new HookInputComponent(
			"Prompt",
			undefined,
			onSubmit,
			onCancel,
			{ timeout: 1_000, tui, onTimeout },
		);

		component.handleInput("h");
		component.handleInput("i");
		component.handleInput("\n");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("hi");
		expect(onCancel).not.toHaveBeenCalled();
		expect(onTimeout).not.toHaveBeenCalled();

		component.dispose();
	});
});
