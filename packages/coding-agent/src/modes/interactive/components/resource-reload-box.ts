import { Container, Spacer, Text } from "omk-tui";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

export function createResourceReloadBox(): Container {
	const box = new Container();
	const borderColor = (text: string) => theme.fg("border", text);
	box.addChild(new DynamicBorder(borderColor));
	box.addChild(new Spacer(1));
	box.addChild(new Text(theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes..."), 1, 0));
	box.addChild(new Spacer(1));
	box.addChild(new DynamicBorder(borderColor));
	return box;
}
