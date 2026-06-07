#!/usr/bin/env node

const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;

const C = {
  red: "#ff1b1b",
  hot: "#ff315d",
  orange: "#ff7a18",
  amber: "#ffd166",
  cyan: "#00ffd1",
  green: "#00ff88",
  magenta: "#ff2bd6",
  white: "#f4ffff",
  dim: "#2b6f6a",
  darkRed: "#6d1717",
};

const SIGILS = {
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
    "              ╭───────────────╮              ",
    "          ╭───╯               ╰───╮          ",
    "       ╭──╯     ███╗   ███╗       ╰──╮       ",
    "       │        ████╗ ████║          │       ",
    "       │   ███  ██╔████╔██║  ██╗     │       ",
    "       │   ╚═╝  ██║╚██╔╝██║  ╚═╝     │       ",
    "       ╰──╮     ██║ ╚═╝ ██║       ╭──╯       ",
    "          ╰───╮ ╚═╝     ╚═╝ ╭───╯          ",
    "              ╰───────────────╯              ",
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

const PALETTES = {
  forge: { base: [C.red, C.hot, C.orange], hot: [C.white, C.amber, C.orange, C.hot] },
  control: { base: [C.cyan, C.green, C.magenta], hot: [C.white, C.cyan, C.magenta, C.orange] },
  omk: { base: [C.cyan, C.white, C.magenta], hot: [C.white, C.amber, C.cyan, C.hot] },
  grid: { base: [C.green, C.cyan, C.dim], hot: [C.white, C.green, C.cyan, C.magenta] },
  gate: { base: [C.magenta, C.cyan, C.green], hot: [C.white, C.amber, C.magenta, C.cyan] },
};

function fg(rgb) {
  return `${CSI}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function mix(a, b, t) {
  const x = Math.max(0, Math.min(1, t));
  return [Math.round(a[0] + (b[0] - a[0]) * x), Math.round(a[1] + (b[1] - a[1]) * x), Math.round(a[2] + (b[2] - a[2]) * x)];
}

function colorAt(colors, t) {
  const safe = ((t % 1) + 1) % 1;
  const scaled = safe * (colors.length - 1);
  const i = Math.floor(scaled);
  const j = Math.min(colors.length - 1, i + 1);
  return mix(hexToRgb(colors[i]), hexToRgb(colors[j]), scaled - i);
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp == null || cp < 32) return 0;
  if (cp >= 0x7f && cp < 0xa0) return 0;
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xac00 && cp <= 0xd7a3)) return 2;
  if (cp >= 0x2e80 && cp <= 0xa4cf) return 2;
  if ((cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)) return 2;
  return 1;
}

function visibleWidth(s) {
  let w = 0;
  for (const ch of Array.from(s.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, ""))) w += charWidth(ch);
  return w;
}

function normalizeLines(lines) {
  const max = Math.max(...lines.map((l) => visibleWidth(l)));
  return lines.map((l) => l + " ".repeat(Math.max(0, max - visibleWidth(l))));
}

function centerVisible(v, w) {
  const vw = visibleWidth(v);
  if (vw >= w) return v.slice(0, Math.max(0, w));
  const left = Math.floor((w - vw) / 2);
  return " ".repeat(left) + v + " ".repeat(w - vw - left);
}

function renderSigilSweep(line, frame, name) {
  const colors = PALETTES[name] || PALETTES.forge;
  const chars = Array.from(line);
  const total = Math.max(1, visibleWidth(line));
  const band = name === "omk" ? 16 : 12;
  const cycle = total + band * 2;
  const head = ((frame * 1.35) % cycle) - band;

  let cursor = 0, out = "";
  for (const ch of chars) {
    const w = charWidth(ch);
    if (ch === " ") { out += " "; cursor += 1; continue; }
    const pos = cursor + w / 2;
    const dist = Math.abs(pos - head);
    const raw = clamp01(1 - dist / band);
    const power = raw * raw * (3 - 2 * raw);
    const base = colorAt(colors.base, cursor / Math.max(1, total - 1));
    const hot = colorAt(colors.hot, (cursor / Math.max(1, total - 1) + frame * 0.02) % 1);
    const rgb = mix(base, hot, power);
    const bold = power > 0.65 || ch === "█" || ch === "O" || ch === "M" || ch === "K";
    out += `${fg(rgb)}${bold ? BOLD : ""}${ch}${RESET}`;
    cursor += w;
  }
  return out;
}

function renderSigil(name, width, frame) {
  const raw = normalizeLines(SIGILS[name] || SIGILS.forge);
  return raw.map((line, i) => {
    const c = centerVisible(line, width);
    return renderSigilSweep(c, frame + i * 3, name);
  });
}

function move(x, y) { return `${CSI}${y};${x}H`; }
function clear() { return `${CSI}2J${CSI}H`; }

const names = ["forge", "control", "omk", "grid", "gate"];
let frame = 0;
let idx = 0;
let timer;

function cleanup() {
  if (timer) clearInterval(timer);
  process.stdout.write(`${RESET}${CSI}?25h${CSI}?1049l`);
  if (process.stdin.isTTY) { process.stdin.setRawMode(false); process.stdin.pause(); }
  process.exit(0);
}

process.stdout.write(`${CSI}?1049h${CSI}?25l`);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (ch) => { if (ch.toString() === "q" || ch[0] === 3) cleanup(); });
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

function render(f) {
  const cols = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;
  const name = names[idx % names.length];
  const sigilWidth = Math.min(64, cols - 4);
  const sigilLines = renderSigil(name, sigilWidth, f);

  let out = clear();
  out += move(2, 2) + `${BOLD}${fg([0,255,209])}OMK SIGIL PREVIEW — ${name.toUpperCase()}${RESET}  (press q to exit, sigils rotate)`;
  out += move(2, 3) + `${fg([43,111,106])}OMK_SIGIL=${name}  Width: ${sigilWidth}  Frame: ${f}  Lines: ${sigilLines.length}${RESET}`;

  for (let i = 0; i < sigilLines.length; i++) {
    out += move(2, 5 + i) + sigilLines[i];
  }

  // Show info below
  out += move(2, 5 + sigilLines.length + 1) + `${fg([255,125,24])}${BOLD}OMK//CONTROL${RESET}  route · verify · loop · control`;
  out += move(2, rows - 1) + `${fg([109,23,23])}q / ctrl+c exit${RESET}`;
  process.stdout.write(out);
}

// Rotate sigil every 6 seconds
setInterval(() => {
  idx++;
}, 6000);

timer = setInterval(() => {
  render(frame++);
}, 80);

render(frame++);
