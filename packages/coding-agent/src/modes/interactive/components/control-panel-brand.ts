import { truncateToWidth, visibleWidth } from "omk-tui";
import { theme } from "../theme/theme.ts";
import { type ControlRailDescriptors, heroModelLabel, terminalSetupTokens, themeToken } from "./control-plane-rail.ts";

/**
 * The OMK opening, drawn in the paper/ink/vermillion design language that the README hero
 * (readmeasset/omk-hero.svg) shares with its sister product: a figure plate, OMK's own
 * control-loop mark, a serif wordmark and the hero's public copy. OMK borrows the drafting
 * language only; the separate product's name and marks never appear here.
 *
 * Colour comes from theme tokens alone: `text` is ink, `muted`/`dim` are secondary and
 * tertiary ink, and `accent` is reserved for the Verify stage.
 */

/** Release marker: scripts/check-release-consistency.mjs requires this plate in this file. */
export const OMK_BRAND_PLATE = "FIG. 01 · THE CONTROL LOOP";
const PLATE_RIGHT = "MIT · PROVIDER-NEUTRAL";
const SUBTITLE = "OPEN MULTI-AGENT KIT";
const LEDE = "Scope the work. Route the right agents.";
const FLOW = ["SCOPE", "ROUTE", "VERIFY", "REPLAY"] as const;
const RULE_WIDTH = 22;
const MARK_INDENT = 2;
const MARK_GAP = 4;

/**
 * Serif OMK in half blocks: twelve square pixel rows on six terminal rows, heavy stems with
 * hairline curves and slab serifs, after the Georgia Bold wordmark of the README hero.
 */
export const OMK_WORDMARK: readonly string[] = [
	"  ▄▄██▀▀██▄▄    ▀████         ████▀  ▀███▀    ▀▀███▀",
	"▄███      ███▄   █████       █████    ███     ▄██▀  ",
	"████      ████   ███ ██▄   ▄██ ███    ███  ▄▄██▀    ",
	"████      ████   ███  ██▄ ▄██  ███    ████▀▀███▄    ",
	"▀███      ███▀   ███   █████   ███    ███    ▀███▄  ",
	"  ▀▀██▄▄██▀▀    ▄███▄   ▀█▀   ▄███▄  ▄███▄    ▄████▄",
];
export const OMK_WORDMARK_WIDTH = visibleWidth(OMK_WORDMARK[0] ?? "");

/**
 * OMK's mark (readmeasset/omk-mark.svg): the control plane routes to three ink nodes and the
 * Verify node, which alone carries the accent. `i` ink, `d` ring dot, `a` accent.
 */
const MARK_GLYPHS = ["    ●    ", " ·  │  · ", "●───◉───●", " ·  ┃  · ", "    ●    "];
const MARK_ROLES = ["    i    ", " d  i  d ", "iiiiiiiii", " d  a  d ", "    a    "];
const MARK_WIDTH = visibleWidth(MARK_GLYPHS[0] ?? "");

/** Everything the hero shows besides the fixed brand: the configured model and the terminal setup. */
export interface HeroMeta extends ControlRailDescriptors {
	readonly ansiColorState?: string;
}

/** Ink-in progress: rows below the pencil line are drawn in ink; the accent stamps on at 1. */
interface Reveal {
	readonly inkedRows: number;
	readonly stamped: boolean;
}

function revealState(reveal: number): Reveal {
	const progress = Number.isFinite(reveal) ? Math.min(1, Math.max(0, reveal)) : 1;
	return { inkedRows: Math.floor(progress * OMK_WORDMARK.length), stamped: progress >= 1 };
}

/** Pencil is the faint underdrawing a row shows until the reveal inks it. */
function pencil(text: string): string {
	return theme.fg("borderMuted", text);
}

function accentOrPencil(text: string, stamped: boolean): string {
	return stamped ? theme.fg("accent", text) : pencil(text);
}

function markRow(row: number, inked: boolean, stamped: boolean): string {
	const glyphs = Array.from(MARK_GLYPHS[row] ?? " ".repeat(MARK_WIDTH));
	const roles = Array.from(MARK_ROLES[row] ?? " ".repeat(MARK_WIDTH));
	let out = "";
	for (let i = 0; i < glyphs.length; i++) {
		const glyph = glyphs[i] ?? " ";
		const role = roles[i];
		if (glyph === " ") out += " ";
		else if (role === "a") out += accentOrPencil(glyph, stamped);
		else if (!inked) out += pencil(glyph);
		else out += theme.fg(role === "d" ? "dim" : "text", glyph);
	}
	return out;
}

function wordmarkRow(row: number, state: Reveal): string {
	const line = OMK_WORDMARK[row] ?? "";
	return row < state.inkedRows ? theme.fg("text", line) : pencil(line);
}

/** Tracked capitals, the terminal version of the SVG's letter-spaced mono subtitle. */
function letterSpaced(text: string): string {
	return Array.from(text).join(" ");
}

function plateRow(innerWidth: number): string {
	const room = innerWidth - visibleWidth(OMK_BRAND_PLATE) - visibleWidth(PLATE_RIGHT);
	if (room < 2) return theme.fg("dim", OMK_BRAND_PLATE);
	return `${theme.fg("dim", OMK_BRAND_PLATE)}${" ".repeat(room)}${theme.fg("dim", PLATE_RIGHT)}`;
}

function flowLine(stamped: boolean): string {
	return FLOW.map((stage) => (stage === "VERIFY" ? accentOrPencil(stage, stamped) : theme.fg("muted", stage))).join(
		theme.fg("dim", " → "),
	);
}

function metaRow(meta: HeroMeta): string {
	const model = `${theme.fg("muted", "MODEL")} ${theme.fg("text", heroModelLabel(meta))}`;
	return [model, ...terminalSetupTokens(meta.ansiColorState, "muted")].join(theme.fg("dim", "  ·  "));
}

function fitWidth(line: string, width: number): string {
	return visibleWidth(line) <= width ? line : truncateToWidth(line, width, "…");
}

/**
 * The deck hero body (unframed), left-aligned like the README hero: plate, mark beside the
 * wordmark, subtitle, rule, lede, flow and the meta row. The line count and every line's width
 * are the same for every `reveal`, so the ink-in never moves the layout.
 */
export function heroBodyLines(meta: HeroMeta, innerWidth: number, reveal = 1): string[] {
	const state = revealState(reveal);
	const withMark = innerWidth >= MARK_INDENT + MARK_WIDTH + MARK_GAP + OMK_WORDMARK_WIDTH;
	const indent = " ".repeat(withMark ? MARK_INDENT + MARK_WIDTH + MARK_GAP : 0);
	const subtitleRoom = innerWidth - indent.length;
	const subtitle = visibleWidth(letterSpaced(SUBTITLE)) <= subtitleRoom ? letterSpaced(SUBTITLE) : SUBTITLE;
	const lines = [plateRow(innerWidth), ""];
	for (let row = 0; row < OMK_WORDMARK.length; row++) {
		const mark = withMark
			? `${" ".repeat(MARK_INDENT)}${markRow(row, row < state.inkedRows, state.stamped)}${" ".repeat(MARK_GAP)}`
			: "";
		lines.push(`${mark}${wordmarkRow(row, state)}`);
	}
	lines.push(
		`${indent}${theme.fg("muted", subtitle)}`,
		`${indent}${accentOrPencil("─".repeat(RULE_WIDTH), state.stamped)}`,
		`${indent}${theme.fg("text", LEDE)}`,
		`${indent}${accentOrPencil("Verify", state.stamped)}${theme.fg("text", " every release.")}`,
		"",
		`${indent}${flowLine(state.stamped)}`,
		`${indent}${metaRow(meta)}`,
	);
	return lines.map((line) => fitWidth(line, innerWidth));
}

/** One-line lede for the compact opening: the hero's copy, quiet ink with the Verify stage stamped. */
export function compactLede(): string {
	return `${theme.fg("muted", LEDE)} ${theme.fg("accent", "Verify")}${theme.fg("muted", " every release.")}`;
}

/**
 * Brand block for layouts narrower than the deck: the wordmark and subtitle when the wordmark
 * fits, otherwise one line of text, followed by the theme name. Same reveal rules as the deck.
 */
export function narrowBrandLines(innerWidth: number, reveal = 1): string[] {
	const state = revealState(reveal);
	const lines =
		innerWidth >= OMK_WORDMARK_WIDTH
			? [
					...OMK_WORDMARK.map((_, row) => wordmarkRow(row, state)),
					theme.fg(
						"muted",
						visibleWidth(letterSpaced(SUBTITLE)) <= innerWidth ? letterSpaced(SUBTITLE) : SUBTITLE,
					),
				]
			: [`${theme.bold(theme.fg("text", "OMK"))} ${theme.fg("muted", SUBTITLE)}`];
	return [...lines, themeToken("muted")].map((line) => fitWidth(line, innerWidth));
}
