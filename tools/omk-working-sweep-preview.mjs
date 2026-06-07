#!/usr/bin/env node

const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;

const P = {
  red: "#ff1b1b",
  hot: "#ff315d",
  orange: "#ff7a18",
  amber: "#ffd166",
  cyan: "#00ffd1",
  green: "#00ff88",
  magenta: "#ff2bd6",
  white: "#f4ffff",
  dim: "#2b6f6a",
  dim2: "#13403d",
  darkRed: "#6d1717",
};

const tasks = [
  ["ROUTE", "routing", "planner: route/verify/loop control surface"],
  ["TOOL", "tool: filesystem", "reading src/providers/model-table.ts"],
  ["EDIT", "editing", "src/ui/omk-working-sweep.ts"],
  ["SHELL", "shell", "npm run build"],
  ["TEST", "testing", "targeted node --test provider model routing"],
  ["STREAM", "streaming", "deepseek/deepseek-v4-pro:max"],
  ["VERIFY", "verifying", "evidence gate and unsupported thinking reject"],
];

function fg(rgb) {
  return `${CSI}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return [
    Number.parseInt(v.slice(0, 2), 16),
    Number.parseInt(v.slice(2, 4), 16),
    Number.parseInt(v.slice(4, 6), 16),
  ];
}

function mix(a, b, t) {
  const x = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * x),
    Math.round(a[1] + (b[1] - a[1]) * x),
    Math.round(a[2] + (b[2] - a[2]) * x),
  ];
}

function colorAt(colors, t) {
  const safeT = ((t % 1) + 1) % 1;
  const scaled = safeT * (colors.length - 1);
  const i = Math.floor(scaled);
  const j = Math.min(colors.length - 1, i + 1);
  return mix(hexToRgb(colors[i]), hexToRgb(colors[j]), scaled - i);
}

function sweep(text, frame, opts = {}) {
  const chars = Array.from(text);
  const total = Math.max(1, chars.length);
  const band = opts.bandWidth ?? 10;
  const speed = opts.speed ?? 1;
  const baseColors = opts.baseColors ?? [P.dim, P.cyan];
  const sweepColors = opts.sweepColors ?? [P.white, P.cyan, P.magenta, P.orange];

  const cycle = total + band * 2;
  const head = ((frame * speed) % cycle) - band;

  let out = "";

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (ch === " ") {
      out += " ";
      continue;
    }

    const distance = Math.abs(i - head);
    const raw = Math.max(0, Math.min(1, 1 - distance / band));
    const power = raw * raw * (3 - 2 * raw);

    const base = colorAt(baseColors, i / Math.max(1, total - 1));
    const hot = colorAt(sweepColors, (i / Math.max(1, total - 1) + frame * 0.018) % 1);
    const rgb = mix(base, hot, power);

    out += `${fg(rgb)}${power > 0.72 || opts.bold ? BOLD : ""}${ch}${RESET}`;
  }

  return out;
}

function move(x, y) {
  return `${CSI}${y};${x}H`;
}

function clear() {
  return `${CSI}2J${CSI}H`;
}

function pad(text, width) {
  const plain = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
  return text + " ".repeat(Math.max(0, width - Array.from(plain).length));
}

function render(frame) {
  const cols = process.stdout.columns || 140;
  const rows = process.stdout.rows || 34;

  const task = tasks[Math.floor(frame / 34) % tasks.length];
  const kind = task[0];
  const label = task[1];
  const detail = task[2];

  const lineWidth = Math.max(50, cols - 4);
  const bodyRaw = `${label} · ${detail}`;
  const body = bodyRaw.length > lineWidth - 34 ? `${bodyRaw.slice(0, lineWidth - 35)}…` : bodyRaw;

  const top = sweep("╭" + "─".repeat(lineWidth - 2) + "╮", frame, {
    baseColors: [P.darkRed, P.red],
    sweepColors: [P.orange, P.amber, P.white, P.hot],
    bandWidth: 18,
    speed: 1.5,
    bold: true,
  });

  const bottom = sweep("╰" + "─".repeat(lineWidth - 2) + "╯", frame + 10, {
    baseColors: [P.darkRed, P.red],
    sweepColors: [P.orange, P.amber, P.white, P.hot],
    bandWidth: 18,
    speed: 1.5,
    bold: true,
  });

  const prefix = sweep(`WORKING ${kind}`, frame, {
    baseColors: [P.red, P.orange],
    sweepColors: [P.white, P.amber, P.hot],
    bandWidth: 9,
    speed: 1.1,
    bold: true,
  });

  const value = sweep(body, frame + 12, {
    baseColors: [P.dim, P.green, P.cyan],
    sweepColors: [P.white, P.cyan, P.magenta, P.orange],
    bandWidth: 16,
    speed: 1.25,
  });

  const inner = `│ ${prefix} :: ${value}`;
  const innerPadded = pad(inner, lineWidth - 1) + sweep("│", frame + 19, {
    baseColors: [P.red],
    sweepColors: [P.orange, P.white],
    bandWidth: 4,
    speed: 1,
    bold: true,
  });

  let out = clear();
  out += move(2, 2) + sweep("OMK://CONTROL · NEON GRID ONLINE", frame, {
    baseColors: [P.cyan, P.green],
    sweepColors: [P.white, P.cyan, P.magenta],
    bandWidth: 12,
    speed: 1.2,
    bold: true,
  });

  out += move(2, 5) + top;
  out += move(2, 6) + innerPadded;
  out += move(2, 7) + bottom;

  out += move(2, 10) + sweep("싸악 지나가는 gradient sweep, current task bound to WORKING HUD", frame, {
    baseColors: [P.dim, P.cyan],
    sweepColors: [P.white, P.magenta, P.orange],
    bandWidth: 20,
    speed: 1.4,
  });

  out += move(2, rows - 2) + sweep("q / ctrl+c exit", frame, {
    baseColors: [P.darkRed, P.orange],
    sweepColors: [P.white, P.amber],
    bandWidth: 8,
    speed: 1,
    bold: true,
  });

  process.stdout.write(out);
}

let frame = 0;
let timer;

function cleanup() {
  if (timer) clearInterval(timer);
  process.stdout.write(`${RESET}${CSI}?25h${CSI}?1049l`);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  process.exit(0);
}

process.stdout.write(`${CSI}?1049h${CSI}?25l`);

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (chunk) => {
    if (chunk.toString("utf8") === "q" || chunk[0] === 3) cleanup();
  });
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

timer = setInterval(() => {
  render(frame++);
}, 80);

render(frame++);
