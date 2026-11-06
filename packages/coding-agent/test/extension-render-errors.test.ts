import { type Component, Container, Text, type TUI, visibleWidth } from "omk-tui";
import { Type } from "typebox";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { CustomMessageComponent } from "../src/modes/interactive/components/custom-message.ts";
import { guardExtensionRender } from "../src/modes/interactive/components/extension-render-guard.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function broken(phase: "render" | "invalidate" = "render"): Component {
	return {
		render: vi.fn(() => {
			if (phase === "render") throw new Error("private-secret");
			return ["custom"];
		}),
		invalidate: vi.fn(() => {
			if (phase === "invalidate") throw new Error("private-secret");
		}),
	};
}

function fakeMode() {
	return Object.assign(Object.create(InteractiveMode.prototype), {
		ui: { requestRender: vi.fn(), setFocus: vi.fn(), showOverlay: vi.fn(() => ({ hide: vi.fn() })) },
		extensionWidgetsAbove: new Map(),
		extensionWidgetsBelow: new Map(),
		widgetContainerAbove: new Container(),
		widgetContainerBelow: new Container(),
		builtInHeader: new Text("built-in header", 0, 0),
		headerContainer: new Container(),
		editor: { getText: () => "draft", setText: vi.fn() },
		editorContainer: new Container(),
		defaultEditor: Object.assign(new Text("default editor", 0, 0), {
			getText: () => "draft",
			setText: vi.fn(),
			onSubmit: vi.fn(),
			onChange: vi.fn(),
			actionHandlers: new Map(),
			getPaddingX: () => 0,
		}),
	});
}

beforeAll(() => initTheme("dark"));

describe("extension component render isolation", () => {
	for (const renderShell of ["default", "self"] as const) {
		for (const slot of ["renderCall", "renderResult"] as const) {
			for (const phase of ["render", "invalidate"] as const) {
				it(`${renderShell} ${slot} contains deferred ${phase} errors and retains results`, () => {
					const child = broken(phase);
					const definition: ToolDefinition = {
						name: "custom_tool",
						label: "Custom",
						description: "test",
						parameters: Type.Any(),
						renderShell,
						execute: async () => ({ content: [], details: {} }),
						[slot]: () => child,
					};
					const row = new ToolExecutionComponent(
						"custom_tool",
						"call-1",
						{},
						{},
						definition,
						{ requestRender() {} } as TUI,
						process.cwd(),
					);
					const result = { content: [{ type: "text", text: "actual result" }], isError: true };
					row.updateResult(result, true);
					if (phase === "invalidate") expect(() => row.invalidate()).not.toThrow();
					const output = stripAnsi(row.render(40).join("\n"));
					expect(output).toContain("Extension render failed");
					expect(output).toContain("actual result");
					expect(output).not.toContain("private-secret");
					expect(row.isRenderSettled()).toBe(false);
					expect(result.isError).toBe(true);
					expect(() => row.invalidate()).not.toThrow();
					expect(() => row.render(10)).not.toThrow();
					row.dispose();
				});
			}
		}
	}

	it("custom message child errors keep the message visible", () => {
		const message = {
			role: "custom" as const,
			customType: "probe",
			content: "original message",
			display: true,
			timestamp: Date.now(),
		};
		const row = new CustomMessageComponent(message, () => broken());
		const output = stripAnsi(row.render(40).join("\n"));
		expect(output).toContain("Extension render failed");
		expect(output).toContain("original message");
		expect(() => row.invalidate()).not.toThrow();
	});

	for (const method of [
		"setExtensionWidget",
		"setExtensionFooter",
		"setExtensionHeader",
		"setCustomEditorComponent",
	] as const) {
		it(`${method} isolates custom render and preserves object identity`, () => {
			const mode = fakeMode();
			const child = Object.assign(broken(), { getText: () => "saved draft", setText: vi.fn() });
			if (method === "setExtensionWidget") mode[method]("probe", () => child);
			else mode[method](() => child);
			const installed =
				method === "setExtensionWidget"
					? mode.extensionWidgetsAbove.get("probe")
					: method === "setExtensionFooter"
						? mode.customFooter
						: method === "setExtensionHeader"
							? mode.customHeader
							: mode.editor;
			expect(installed).toBe(child);
			const lines = installed.render(10);
			expect(stripAnsi(lines.join("\n"))).toContain("Extension");
			expect(lines.every((line: string) => visibleWidth(line) <= 10)).toBe(true);
			expect(() => installed.invalidate()).not.toThrow();
			if (method === "setCustomEditorComponent") {
				expect(mode.editor).toBe(mode.defaultEditor);
				expect(mode.defaultEditor.setText).toHaveBeenCalledWith("saved draft");
			}
		});
	}

	it.each([false, true])("custom UI overlay=%s isolates render without changing focus or close", async (overlay) => {
		const mode = fakeMode();
		const child = new Text("custom UI", 0, 0);
		let close: ((value: string) => void) | undefined;
		const result = mode.showExtensionCustom(
			(_ui: TUI, _theme: unknown, _keys: unknown, done: (value: string) => void) => {
				close = done;
				return child;
			},
			{ overlay },
		);
		await Promise.resolve();
		const installed = overlay ? mode.ui.showOverlay.mock.calls[0][0] : mode.editorContainer.children[0];
		expect(installed).toBe(child);
		expect(() => installed.render(30)).not.toThrow();
		close!("cancelled");
		await expect(result).resolves.toBe("cancelled");
		if (overlay) expect(mode.ui.showOverlay.mock.results[0].value.hide).toHaveBeenCalledOnce();
	});
	it("guards reused components once, preserves this, and retries only new instances", () => {
		const child = broken();
		const render = child.render;
		guardExtensionRender(child);
		const guardedRender = child.render;
		guardExtensionRender(child);
		expect(child.render).toBe(guardedRender);
		child.render(30);
		child.render(30);
		child.invalidate();
		expect(render).toHaveBeenCalledOnce();
		const healthy = {
			label: "new component",
			render(_width: number) {
				return [this.label];
			},
			invalidate() {},
		};
		expect(guardExtensionRender(healthy).render(30)).toEqual(["new component"]);
	});

	it.each(["renderCall", "renderResult"] as const)("keeps existing %s factory fallback", (slot) => {
		const definition: ToolDefinition = {
			name: "custom_tool",
			label: "Custom",
			description: "test",
			parameters: Type.Any(),
			execute: async () => ({ content: [], details: {} }),
			[slot]: () => {
				throw new Error("factory error");
			},
		};
		const row = new ToolExecutionComponent(
			"custom_tool",
			"call-1",
			{},
			{},
			definition,
			{ requestRender() {} } as TUI,
			process.cwd(),
		);
		row.updateResult({ content: [{ type: "text", text: "actual result" }], isError: false });
		const output = stripAnsi(row.render(40).join("\n"));
		expect(output).toContain("custom_tool");
		expect(output).toContain("actual result");
		expect(row.isRenderSettled()).toBe(true);
		row.dispose();
	});

	it("retains raw results when call and result return the same failed instance", () => {
		const child = broken();
		const definition: ToolDefinition = {
			name: "custom_tool",
			label: "Custom",
			description: "test",
			parameters: Type.Any(),
			execute: async () => ({ content: [], details: {} }),
			renderCall: () => child,
			renderResult: () => child,
		};
		const row = new ToolExecutionComponent(
			"custom_tool",
			"shared",
			{},
			{},
			definition,
			{ requestRender() {} } as TUI,
			process.cwd(),
		);
		row.updateResult({ content: [{ type: "text", text: "original result" }], isError: false });
		expect(stripAnsi(row.render(40).join("\n"))).toContain("original result");
		row.updateResult({ content: [{ type: "text", text: "new result" }], isError: false });
		expect(stripAnsi(row.render(40).join("\n"))).toContain("new result");
		row.dispose();
	});

	it.each([false, true])(
		"failed custom UI overlay=%s rejects rather than leaving the tool pending",
		async (overlay) => {
			const mode = fakeMode();
			const dispose = vi.fn();
			const child = Object.assign(broken(), { dispose });
			const result = mode.showExtensionCustom(() => child, { overlay });
			const rejection = expect(result).rejects.toThrow("Extension render failed");
			await Promise.resolve();
			child.render(30);
			await rejection;
			expect(dispose).toHaveBeenCalledOnce();
			if (overlay) expect(mode.ui.showOverlay.mock.results[0].value.hide).toHaveBeenCalledOnce();
			else expect(mode.editor.setText).toHaveBeenCalledWith("draft");
		},
	);
});
