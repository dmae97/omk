import { Container, Spacer, Text } from "omk-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { DynamicBorder } from "../src/modes/interactive/components/dynamic-border.ts";
import { createResourceReloadBox } from "../src/modes/interactive/components/resource-reload-box.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => initTheme("dark"));

describe("resource reload display", () => {
	it.each([40, 80, 120])("preserves the existing rendered output at %d columns", (width) => {
		const previous = new Container();
		const borderColor = (text: string) => theme.fg("border", text);
		previous.addChild(new DynamicBorder(borderColor));
		previous.addChild(new Spacer(1));
		previous.addChild(
			new Text(theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes..."), 1, 0),
		);
		previous.addChild(new Spacer(1));
		previous.addChild(new DynamicBorder(borderColor));
		expect(createResourceReloadBox().render(width)).toEqual(previous.render(width));
	});
});
