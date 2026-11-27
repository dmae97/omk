/** One styled run of footer text. Colors are `#rrggbb`; `undefined` means the terminal default. */
export type FooterSpan = { text: string; color?: string; bold?: boolean };
/** A footer row: `left` is pinned to the left edge, `right` to the right edge. */
export type FooterLine = { left: FooterSpan[]; right: FooterSpan[] };
/** `text` paints spans that use the terminal default color, since OpenTUI always emits an explicit color. */
export type FooterPanelModel = { lines: FooterLine[]; text: string };

const BASIC = [
	"#000000",
	"#cd0000",
	"#00cd00",
	"#cdcd00",
	"#0000ee",
	"#cd00cd",
	"#00cdcd",
	"#e5e5e5",
	"#7f7f7f",
	"#ff0000",
	"#00ff00",
	"#ffff00",
	"#5c5cff",
	"#ff00ff",
	"#00ffff",
	"#ffffff",
];

const hex = (r: number, g: number, b: number) =>
	`#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;

/** xterm 256-color palette index to hex. */
export function xterm256(index: number): string {
	if (index < 16) return BASIC[index]!;
	if (index >= 232) {
		const level = 8 + (index - 232) * 10;
		return hex(level, level, level);
	}
	const cube = index - 16;
	const step = (value: number) => (value === 0 ? 0 : 55 + value * 40);
	return hex(step(Math.floor(cube / 36)), step(Math.floor(cube / 6) % 6), step(cube % 6));
}

const SGR_RE = /\x1b\[([0-9;]*)m/g;
// Non-SGR CSI and OSC sequences (hyperlinks, cursor moves) carry no footer text.
const OTHER_ESCAPE_RE = /\x1b\[[0-9;?]*[ -/]*[@-ln-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Split a rendered ANSI line into styled spans; only foreground color and bold survive. */
export function ansiToSpans(line: string): FooterSpan[] {
	const spans: FooterSpan[] = [];
	let color: string | undefined;
	let bold = false;
	let last = 0;
	const source = line.replace(OTHER_ESCAPE_RE, "");
	const push = (text: string) => {
		if (!text) return;
		const previous = spans.at(-1);
		if (previous && previous.color === color && (previous.bold ?? false) === bold) previous.text += text;
		else spans.push(bold ? { text, color, bold } : { text, color });
	};
	for (const match of source.matchAll(SGR_RE)) {
		push(source.slice(last, match.index));
		last = match.index + match[0].length;
		const codes = (match[1] || "0").split(";").map(Number);
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i]!;
			if (code === 0) {
				color = undefined;
				bold = false;
			} else if (code === 1) bold = true;
			else if (code === 22) bold = false;
			else if (code === 39) color = undefined;
			else if (code >= 30 && code <= 37) color = BASIC[code - 30];
			else if (code >= 90 && code <= 97) color = BASIC[code - 90 + 8];
			else if (code === 38 && codes[i + 1] === 5) {
				color = xterm256(codes[i + 2] ?? 0);
				i += 2;
			} else if (code === 38 && codes[i + 1] === 2) {
				color = hex(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0);
				i += 4;
			}
		}
	}
	push(source.slice(last));
	return spans;
}

/** The native footer rows plus its stats row split at the padding. */
export type RenderedFooter = {
	lines: string[];
	statsLeft: string;
	statsRight: string;
	pwdLeft?: string;
	pwdRight?: string;
};

/** OpenTUI rows for a rendered footer; row 0 keeps the optional Todos toggle on the right, row 1 keeps model/provider. */
export function footerPanelModel(
	{ lines, statsLeft, statsRight, pwdLeft, pwdRight }: RenderedFooter,
	text: string,
): FooterPanelModel {
	return {
		text,
		lines: lines.map((line, index) =>
			index === 0 && pwdLeft !== undefined
				? { left: ansiToSpans(pwdLeft), right: ansiToSpans(pwdRight ?? "") }
				: index === 1
					? { left: ansiToSpans(statsLeft), right: ansiToSpans(statsRight) }
					: { left: ansiToSpans(line), right: [] },
		),
	};
}
