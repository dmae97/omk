// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.

import { Box, type Component, Markdown, Text, visibleWidth } from "omk-tui";
import { getMarkdownTheme, type Theme } from "open-multi-agent-kit";

const CARD_PADDING = 1;
const CARD_HEADING = "🤌 Speak like you eat";
const MIN_LABEL_GAP = 2;
export type SlyeTab = "rewrite" | "simple";

export function buildLegacyCard(
	theme: Theme,
	display: string,
	background: (text: string) => string,
	modelName?: string,
): Box {
	const box = new Box(CARD_PADDING, CARD_PADDING, background);
	box.addChild(buildHeadingLine(theme, theme.bold(`${CARD_HEADING}:`), modelName));
	box.addChild(new Markdown(display, 0, 1, getMarkdownTheme()));
	return box;
}
export function buildTabbedCard(
	theme: Theme,
	simple: string,
	rewrite: string,
	getActiveTab: () => SlyeTab,
	modelName?: string,
): Component {
	const rewriteBox = buildTabbedBox(theme, "rewrite", rewrite, modelName);
	const simpleBox = buildTabbedBox(theme, "simple", simple, modelName);
	return {
		render(width) {
			return (getActiveTab() === "rewrite" ? rewriteBox : simpleBox).render(width);
		},
		invalidate() {
			rewriteBox.invalidate();
			simpleBox.invalidate();
		},
	};
}
export function cardBackground(theme: Theme): (text: string) => string {
	return (text) => theme.bg("customMessageBg", text);
}
export function buildLabelledHeadingLine(heading: string, label: string): Component {
	const fallback = new Text(heading, 0, 0);
	return {
		render(width) {
			const remainingWidth = width - visibleWidth(heading) - visibleWidth(label);
			if (remainingWidth < MIN_LABEL_GAP) return fallback.render(width);
			return [`${heading}${" ".repeat(remainingWidth)}${label}`];
		},
		invalidate() {
			fallback.invalidate();
		},
	};
}
function buildTabbedBox(theme: Theme, activeTab: SlyeTab, display: string, modelName?: string): Box {
	const heading = headingParts(theme, activeTab)
		.map((part) => part.text)
		.join("");
	const box = new Box(CARD_PADDING, CARD_PADDING, cardBackground(theme));
	box.addChild(buildHeadingLine(theme, heading, modelName));
	box.addChild(new Markdown(display, 0, 1, getMarkdownTheme()));
	return box;
}
function buildHeadingLine(theme: Theme, heading: string, modelName: string | undefined): Component {
	return modelName === undefined
		? new Text(heading, 0, 0)
		: buildLabelledHeadingLine(heading, theme.fg("muted", modelName));
}
function headingParts(theme: Theme, activeTab: SlyeTab): Array<{ text: string; tab?: SlyeTab }> {
	return [
		{ text: CARD_HEADING },
		{ text: "   " },
		{ text: tabLabel(theme, "rewrite", activeTab), tab: "rewrite" },
		{ text: "  " },
		{ text: tabLabel(theme, "simple", activeTab), tab: "simple" },
	];
}
function tabLabel(theme: Theme, tab: SlyeTab, activeTab: SlyeTab): string {
	const label = tab === "rewrite" ? "ELI5" : "Light";
	return tab === activeTab ? theme.bold(theme.fg("accent", `[ ${label} ]`)) : theme.fg("muted", label);
}
