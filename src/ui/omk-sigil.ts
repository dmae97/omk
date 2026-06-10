import { SIGIL_NEON } from "../theme/extended-palette.js";

export type OmkSigilName =
  | "forge"
  | "control"
  | "omk"
  | "grid"
  | "gate";

export type RenderSigilOptions = {
  name?: OmkSigilName | string;
  width: number;
  frame: number;
};

type Rgb = readonly [number, number, number];

const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;

// Bespoke sigil neon ramp — declared once in the extended palette data module.
const C = SIGIL_NEON;

const SIGILS: Record<OmkSigilName, readonly string[]> = {
  forge: [
    "        ╭──────────────╮          ╭────────╮        ",
    "        ╰─────╮    ╭───╯       ╭──╯        ╰──╮     ",
    "              ╰────╯        ╭──╯              │     ",
    "        ╭─────╮    ╭───╮    ╰──╮              │     ",
    "        ╰─────╯    ╰───╯       ╰──╮        ╭──╯     ",
    "                                    ╰────────╯        ",
  ],

  control: [
    "             ╭──────╮        ╭──────╮             ",
    "        ╭────╯      ╰──╮  ╭──╯      ╰────╮        ",
    "   ╭────╯              ╰──╯              ╰────╮   ",
    "   │        ╭────╮      OMK      ╭────╮        │   ",
    "   ╰────╮   ╰────╯   CONTROL    ╰────╯   ╭────╯   ",
    "        ╰────╮              ╭────────────╯        ",
    "             ╰──────╮  ╭────╯                     ",
    "                    ╰──╯                          ",
  ],

  omk: [
    "██████╗ ███╗   ███╗██╗  ██╗",
    "██╔═══██╗████╗ ████║██║ ██╔╝",
    "██║   ██║██╔████╔██║█████╔╝",
    "██║   ██║██║╚██╔╝██║██╔═██╗",
    "╚██████╔╝██║ ╚═╝ ██║██║  ██╗",
    " ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝",
  ],

  grid: [
    "        ╭────╮     ╭────╮     ╭────╮        ",
    "        │ 01 │─────│ OMK│─────│ 10 │        ",
    "        ╰─╮──╯     ╰─╮──╯     ╰──╭─╯        ",
    "          │          │           │          ",
    "     ╭────╯     ╭────╯────╮      ╰────╮     ",
    "     │ ROUTE    │ VERIFY  │    CONTROL │    ",
    "     ╰────╮     ╰────╮────╯      ╭────╯     ",
    "          ╰──────────╯───────────╯          ",
  ],

  gate: [
    "              ╭────────────╮              ",
    "       ╭──────╯            ╰──────╮       ",
    "   ╭───╯      ╭────╮  ╭────╮      ╰───╮   ",
    "   │          │    │  │    │          │   ",
    "   │      ╭───╯    ╰──╯    ╰───╮      │   ",
    "   │      │      OMK//CTRL      │      │   ",
    "   │      ╰───╮            ╭───╯      │   ",
    "   ╰───╮      ╰────────────╯      ╭───╯   ",
    "       ╰──────╮            ╭──────╯       ",
    "              ╰────────────╯              ",
  ],
};

export function renderOmkSigil(options: RenderSigilOptions): string[] {
  const name = normalizeSigilName(options.name);
  const rawLines = normalizeLines(SIGILS[name]);
  const width = Math.max(1, options.width);

  return rawLines.map((line, index) => {
    const centered = centerVisible(line, width);
    if (!shouldUseAnsiColor()) return centered;
    return renderSigilSweep(centered, options.frame + index * 3, name);
  });
}

export function listOmkSigils(): OmkSigilName[] {
  return Object.keys(SIGILS) as OmkSigilName[];
}

export function renderOmkSparkleText(
  value: string,
  options: {
    frame?: number;
    noColor?: boolean;
    colors?: readonly string[];
  } = {},
): string {
  const text = value.replace(/\n/g, " ");
  if (options.noColor || !shouldUseAnsiColor()) {
    return text;
  }

  const frame = options.frame ?? Math.floor(Date.now() / 80);
  const colors = options.colors ?? [C.white, C.amber, C.cyan, C.magenta, C.hot];
  const rgb = colorAt(colors, (frame * 0.09) % 1);

  return `${fg(rgb)}${BOLD}${text}${RESET}`;
}

function shouldUseAnsiColor(): boolean {
  return process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
}

function normalizeSigilName(value: string | undefined): OmkSigilName {
  if (
    value === "forge" ||
    value === "control" ||
    value === "omk" ||
    value === "grid" ||
    value === "gate"
  ) {
    return value;
  }

  return "omk";
}

function renderSigilSweep(line: string, frame: number, name: OmkSigilName): string {
  const colors = paletteForSigil(name);
  const chars = Array.from(line);
  const total = Math.max(1, visibleWidth(line));

  const bandWidth = name === "omk" ? 16 : 12;
  const cycle = total + bandWidth * 2;
  const head = ((frame * 1.35) % cycle) - bandWidth;

  let cursor = 0;
  let out = "";

  for (const ch of chars) {
    const charW = charWidth(ch);

    if (ch === " ") {
      out += " ";
      cursor += 1;
      continue;
    }

    const pos = cursor + charW / 2;
    const distance = Math.abs(pos - head);
    const raw = clamp01(1 - distance / bandWidth);
    const power = raw * raw * (3 - 2 * raw);

    const base = colorAt(colors.base, cursor / Math.max(1, total - 1));
    const hot = colorAt(colors.hot, (cursor / Math.max(1, total - 1) + frame * 0.02) % 1);
    const swept = mixRgb(base, hot, power);
    const sparklePower = isOmkSparkleGlyph(ch)
      ? 0.45 + 0.55 * ((Math.sin((frame + cursor) * 0.72) + 1) / 2)
      : 0;
    const sparkle = colorAt([C.white, C.amber, C.cyan, C.magenta], (frame * 0.09 + cursor * 0.035) % 1);
    const rgb = sparklePower > 0 ? mixRgb(swept, sparkle, sparklePower) : swept;

    const bold = power > 0.65 || sparklePower > 0 || ch === "█";
    out += `${fg(rgb)}${bold ? BOLD : ""}${ch}${RESET}`;

    cursor += charW;
  }

  return out;
}

function isOmkSparkleGlyph(ch: string): boolean {
  return ch === "O" || ch === "M" || ch === "K" || ch === "█";
}

function paletteForSigil(name: OmkSigilName): {
  base: readonly string[];
  hot: readonly string[];
} {
  if (name === "control") {
    return {
      base: [C.cyan, C.green, C.magenta],
      hot: [C.white, C.cyan, C.magenta, C.orange],
    };
  }

  if (name === "omk") {
    return {
      base: [C.cyan, C.white, C.magenta],
      hot: [C.white, C.amber, C.cyan, C.hot],
    };
  }

  if (name === "grid") {
    return {
      base: [C.green, C.cyan, C.dim],
      hot: [C.white, C.green, C.cyan, C.magenta],
    };
  }

  if (name === "gate") {
    return {
      base: [C.magenta, C.cyan, C.green],
      hot: [C.white, C.amber, C.magenta, C.cyan],
    };
  }

  return {
    base: [C.red, C.hot, C.orange],
    hot: [C.white, C.amber, C.orange, C.hot],
  };
}

function normalizeLines(lines: readonly string[]): string[] {
  const max = Math.max(...lines.map((line) => visibleWidth(line)));

  return lines.map((line) => {
    const pad = Math.max(0, max - visibleWidth(line));
    return line + " ".repeat(pad);
  });
}

function centerVisible(value: string, width: number): string {
  const valueWidth = visibleWidth(value);

  if (valueWidth >= width) {
    return clipVisible(value, width);
  }

  const left = Math.floor((width - valueWidth) / 2);
  const right = width - valueWidth - left;

  return " ".repeat(left) + value + " ".repeat(right);
}

function clipVisible(value: string, maxWidth: number): string {
  const target = Math.max(0, maxWidth);
  let out = "";
  let used = 0;

  for (const ch of Array.from(value)) {
    const w = charWidth(ch);
    if (used + w > target) break;
    out += ch;
    used += w;
  }

  return out;
}

function visibleWidth(value: string): number {
  let total = 0;

  for (const ch of Array.from(stripAnsi(value))) {
    total += charWidth(ch);
  }

  return total;
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0);

  if (cp == null) return 0;
  if (cp < 32) return 0;
  if (cp >= 0x7f && cp < 0xa0) return 0;
  if (isCombining(cp)) return 0;
  if (isWide(cp)) return 2;

  return 1;
}

function isCombining(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  );
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  );
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");

  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function fg(rgb: Rgb): string {
  // Truecolor SGR assembled from numeric codes (no raw escape parameter literal).
  return `${CSI}${[38, 2, rgb[0], rgb[1], rgb[2]].join(";")}m`;
}

function colorAt(colors: readonly string[], t: number): Rgb {
  if (colors.length === 0) return [255, 255, 255];
  if (colors.length === 1) return hexToRgb(colors[0]);

  const safeT = ((t % 1) + 1) % 1;
  const scaled = safeT * (colors.length - 1);
  const index = Math.floor(scaled);
  const next = Math.min(colors.length - 1, index + 1);
  const local = scaled - index;

  return mixRgb(hexToRgb(colors[index]), hexToRgb(colors[next]), local);
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const x = clamp01(t);

  return [
    Math.round(a[0] + (b[0] - a[0]) * x),
    Math.round(a[1] + (b[1] - a[1]) * x),
    Math.round(a[2] + (b[2] - a[2]) * x),
  ];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
