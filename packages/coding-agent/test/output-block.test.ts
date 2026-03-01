import { afterEach, describe, expect, it } from "bun:test";
import { getThemeByName } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { renderOutputBlock } from "@oh-my-pi/pi-coding-agent/tui/output-block";
import { ImageProtocol, TERMINAL } from "@oh-my-pi/pi-tui";

type MutableTerminalInfo = {
	imageProtocol: ImageProtocol | null;
};

const terminal = TERMINAL as unknown as MutableTerminalInfo;

describe("renderOutputBlock", () => {
	const originalProtocol = TERMINAL.imageProtocol;

	afterEach(() => {
		terminal.imageProtocol = originalProtocol;
	});

	it("passes SIXEL lines through without trimming or padding", async () => {
		terminal.imageProtocol = ImageProtocol.Sixel;
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;
		const sixel = "\x1bPqabc\x1b\\";
		const lines = renderOutputBlock(
			{
				width: 40,
				sections: [{ label: "Output", lines: ["regular line", sixel] }],
			},
			uiTheme,
		);

		expect(lines.filter(line => line === sixel)).toHaveLength(1);
		const regularLine = lines.find(line => line.includes("regular line"));
		expect(regularLine).toBeDefined();
		expect(regularLine).not.toBe("regular line");
	});
});
