import { afterEach, describe, expect, it } from "bun:test";
import type { RenderResultOptions } from "@oh-my-pi/pi-agent-core";
import { getThemeByName } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { bashToolRenderer } from "@oh-my-pi/pi-coding-agent/tools/bash";
import { ImageProtocol, TERMINAL } from "@oh-my-pi/pi-tui";

type MutableTerminalInfo = {
	imageProtocol: ImageProtocol | null;
};

const terminal = TERMINAL as unknown as MutableTerminalInfo;

describe("bashToolRenderer", () => {
	const originalProtocol = TERMINAL.imageProtocol;

	afterEach(() => {
		terminal.imageProtocol = originalProtocol;
	});

	it("bypasses truncation/styling for SIXEL lines", async () => {
		terminal.imageProtocol = ImageProtocol.Sixel;
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;
		const sixel = "\x1bPqabc\x1b\\";
		const renderOptions: RenderResultOptions & {
			renderContext: {
				output: string;
				expanded: boolean;
				previewLines: number;
			};
		} = {
			expanded: false,
			isPartial: false,
			renderContext: {
				output: `line one\n${sixel}\nline two`,
				expanded: false,
				previewLines: 1,
			},
		};

		const component = bashToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details: {}, isError: false },
			renderOptions,
			uiTheme,
			{ command: "echo sixel" },
		);
		const lines = component.render(80);

		expect(lines.filter(line => line === sixel)).toHaveLength(1);
		expect(lines.some(line => line.includes("ctrl+o to expand"))).toBe(false);
	});
});
