import { SIGIL_NEON } from "../theme/extended-palette.js";

export type Rgb = readonly [number, number, number];

export type WorkingKind =
  | "idle"
  | "route"
  | "verify"
  | "loop"
  | "control"
  | "tool"
  | "shell"
  | "edit"
  | "test"
  | "model"
  | "stream"
  | "error";

export type WorkingState = {
  kind: WorkingKind;
  label: string;
  detail: string;
  startedAtMs: number;
};

export type WorkSignal = {
  activeToolCall?: {
    name: string;
    inputPreview?: string;
  } | null;
  activeShellCommand?: string | null;
  activeFileEdit?: string | null;
  activeTestCommand?: string | null;
  activeAgent?: {
    role?: string;
    task?: string;
  } | null;
  activeSlashCommand?: string | null;
  userIntent?: string | null;
  provider?: string | null;
  model?: string | null;
  route?: string | null;
  isStreaming?: boolean;
  error?: string | null;
};

const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;

// Bespoke working-sweep neon ramp — declared once in the extended palette module.
const P = SIGIL_NEON;

export class WorkingTracker {
  private current: WorkingState = {
    kind: "idle",
    label: "idle",
    detail: "waiting for instruction",
    startedAtMs: Date.now(),
  };

  snapshot(): WorkingState {
    return this.current;
  }

  set(kind: WorkingKind, label: string, detail = ""): WorkingState {
    const nextLabel = clean(label) || "idle";
    const nextDetail = clean(detail);

    const same =
      this.current.kind === kind &&
      this.current.label === nextLabel &&
      this.current.detail === nextDetail;

    if (!same) {
      this.current = {
        kind,
        label: nextLabel,
        detail: nextDetail,
        startedAtMs: Date.now(),
      };
    }

    return this.current;
  }

  idle(detail = "waiting for instruction"): WorkingState {
    return this.set("idle", "idle", detail);
  }

  route(detail: string): WorkingState {
    return this.set("route", "routing", detail);
  }

  verify(detail: string): WorkingState {
    return this.set("verify", "verifying", detail);
  }

  loop(detail: string): WorkingState {
    return this.set("loop", "looping", detail);
  }

  control(detail: string): WorkingState {
    return this.set("control", "control", detail);
  }

  tool(name: string, detail = ""): WorkingState {
    return this.set("tool", `tool: ${name}`, detail);
  }

  shell(command: string): WorkingState {
    return this.set("shell", "shell", command);
  }

  edit(filePath: string): WorkingState {
    return this.set("edit", "editing", filePath);
  }

  test(command: string): WorkingState {
    return this.set("test", "testing", command);
  }

  model(provider: string, model: string): WorkingState {
    return this.set("model", "model", `${provider}/${model}`);
  }

  stream(provider: string, model: string): WorkingState {
    return this.set("stream", "streaming", `${provider}/${model}`);
  }

  error(message: string): WorkingState {
    return this.set("error", "blocked", message);
  }
}

export function deriveWorkingState(signal: WorkSignal, previous?: WorkingState): WorkingState {
  const now = Date.now();
  const startedAtMs = previous?.startedAtMs ?? now;

  if (signal.error) {
    return preserveStart(previous, {
      kind: "error",
      label: "blocked",
      detail: signal.error,
      startedAtMs,
    });
  }

  if (signal.activeShellCommand) {
    return preserveStart(previous, {
      kind: "shell",
      label: "shell",
      detail: signal.activeShellCommand,
      startedAtMs,
    });
  }

  if (signal.activeTestCommand) {
    return preserveStart(previous, {
      kind: "test",
      label: "testing",
      detail: signal.activeTestCommand,
      startedAtMs,
    });
  }

  if (signal.activeFileEdit) {
    return preserveStart(previous, {
      kind: "edit",
      label: "editing",
      detail: signal.activeFileEdit,
      startedAtMs,
    });
  }

  if (signal.activeToolCall) {
    return preserveStart(previous, {
      kind: "tool",
      label: `tool: ${signal.activeToolCall.name}`,
      detail: signal.activeToolCall.inputPreview ?? "",
      startedAtMs,
    });
  }

  if (signal.activeSlashCommand) {
    return preserveStart(previous, {
      kind: "control",
      label: "slash command",
      detail: signal.activeSlashCommand,
      startedAtMs,
    });
  }

  if (signal.activeAgent?.task) {
    const role = signal.activeAgent.role ? `${signal.activeAgent.role}: ` : "";
    return preserveStart(previous, {
      kind: "loop",
      label: `${role}working`,
      detail: signal.activeAgent.task,
      startedAtMs,
    });
  }

  if (signal.isStreaming && signal.provider && signal.model) {
    return preserveStart(previous, {
      kind: "stream",
      label: "streaming",
      detail: `${signal.provider}/${signal.model}`,
      startedAtMs,
    });
  }

  if (signal.userIntent) {
    return preserveStart(previous, {
      kind: "route",
      label: "intent",
      detail: signal.userIntent,
      startedAtMs,
    });
  }

  if (signal.route) {
    return preserveStart(previous, {
      kind: "route",
      label: "route",
      detail: signal.route,
      startedAtMs,
    });
  }

  return preserveStart(previous, {
    kind: "idle",
    label: "idle",
    detail: "waiting for instruction",
    startedAtMs,
  });
}

export function renderWorkingHud(args: {
  state: WorkingState;
  frame: number;
  width: number;
  nowMs?: number;
  compact?: boolean;
}): string {
  const width = Math.max(24, args.width);
  const nowMs = args.nowMs ?? Date.now();
  const age = formatElapsed(nowMs - args.state.startedAtMs);

  const kind = args.state.kind.toUpperCase();
  const label = args.state.label;
  const detail = args.state.detail;

  const prefixRaw = args.compact ? "WORKING" : `WORKING ${kind}`;
  const ageRaw = `${age}`;
  const sepRaw = " :: ";

  const reserved = visibleWidth(prefixRaw) + visibleWidth(ageRaw) + visibleWidth(sepRaw) + 6;
  const bodyWidth = Math.max(8, width - reserved);

  const bodyRaw = detail ? `${label} · ${detail}` : label;
  const body = clipVisible(bodyRaw, bodyWidth);

  const prefix = renderSweepText(prefixRaw, args.frame, {
    baseColors: [P.red, P.orange],
    sweepColors: [P.white, P.amber, P.hot],
    bandWidth: 8,
    speed: 1.05,
    bold: true,
  });

  const value = renderSweepText(body, args.frame + 11, {
    baseColors: [P.dim, P.green, P.cyan],
    sweepColors: [P.white, P.cyan, P.magenta, P.orange],
    bandWidth: 14,
    speed: 1.25,
    bold: false,
  });

  const ageText = renderSweepText(ageRaw, args.frame + 23, {
    baseColors: [P.darkRed, P.orange],
    sweepColors: [P.white, P.amber],
    bandWidth: 6,
    speed: 0.85,
    bold: true,
  });

  const left = renderSweepText("▌", args.frame, {
    baseColors: [P.red],
    sweepColors: [P.orange, P.white],
    bandWidth: 3,
    speed: 1,
    bold: true,
  });

  const sep = renderSweepText(sepRaw, args.frame + 5, {
    baseColors: [P.dim2],
    sweepColors: [P.cyan, P.magenta],
    bandWidth: 5,
    speed: 1,
    bold: false,
  });

  const right = renderSweepText("▐", args.frame + 17, {
    baseColors: [P.red],
    sweepColors: [P.orange, P.white],
    bandWidth: 3,
    speed: 1,
    bold: true,
  });

  const raw = `${left} ${prefix}${sep}${value} ${ageText} ${right}`;
  return padAnsi(raw, width);
}

export function renderSweepRule(width: number, frame: number): string {
  const raw = "─".repeat(Math.max(1, width));
  return renderSweepText(raw, frame, {
    baseColors: [P.darkRed, P.red],
    sweepColors: [P.orange, P.amber, P.white, P.hot],
    bandWidth: 18,
    speed: 1.4,
    bold: true,
  });
}

export function renderSweepText(
  input: string,
  frame: number,
  options?: {
    baseColors?: readonly string[];
    sweepColors?: readonly string[];
    bandWidth?: number;
    speed?: number;
    bold?: boolean;
  },
): string {
  const text = input.replace(/\n/g, " ");
  if (!shouldUseAnsiColor()) return text;
  const segments = graphemes(text);
  const totalWidth = Math.max(1, visibleWidth(text));
  const bandWidth = Math.max(2, options?.bandWidth ?? 10);
  const speed = options?.speed ?? 1;
  const baseColors = options?.baseColors ?? [P.dim, P.cyan];
  const sweepColors = options?.sweepColors ?? [P.white, P.cyan, P.magenta, P.orange];

  const cycle = totalWidth + bandWidth * 2;
  const head = ((frame * speed) % cycle) - bandWidth;

  let cursor = 0;
  let out = "";

  for (const segment of segments) {
    const w = Math.max(0, visibleWidth(segment));

    if (w === 0) {
      out += segment;
      continue;
    }

    const pos = cursor + w / 2;
    const distance = Math.abs(pos - head);
    const rawPower = clamp01(1 - distance / bandWidth);
    const power = rawPower * rawPower * (3 - 2 * rawPower);

    const base = colorAt(baseColors, cursor / Math.max(1, totalWidth - 1));
    const sweep = colorAt(
      sweepColors,
      (cursor / Math.max(1, totalWidth - 1) + frame * 0.018) % 1,
    );

    const rgb = mixRgb(base, sweep, power);
    const bold = options?.bold || power > 0.72;

    out += `${fg(rgb)}${bold ? BOLD : ""}${segment}${RESET}`;
    cursor += w;
  }

  return out;
}

function shouldUseAnsiColor(): boolean {
  return process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
}

function preserveStart(previous: WorkingState | undefined, next: WorkingState): WorkingState {
  if (
    previous &&
    previous.kind === next.kind &&
    previous.label === next.label &&
    previous.detail === next.detail
  ) {
    return {
      ...next,
      startedAtMs: previous.startedAtMs,
    };
  }

  return {
    ...next,
    startedAtMs: Date.now(),
  };
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function fg(rgb: Rgb): string {
  // Truecolor SGR assembled from numeric codes (no raw escape parameter literal).
  return `${CSI}${[38, 2, rgb[0], rgb[1], rgb[2]].join(";")}m`;
}

function hexToRgb(hex: string): Rgb {
  const cleanHex = hex.replace("#", "");

  return [
    Number.parseInt(cleanHex.slice(0, 2), 16),
    Number.parseInt(cleanHex.slice(2, 4), 16),
    Number.parseInt(cleanHex.slice(4, 6), 16),
  ];
}

function colorAt(colors: readonly string[], t: number): Rgb {
  if (colors.length <= 0) {
    return [255, 255, 255];
  }

  if (colors.length === 1) {
    return hexToRgb(colors[0]);
  }

  const safeT = ((t % 1) + 1) % 1;
  const scaled = safeT * (colors.length - 1);
  const index = Math.floor(scaled);
  const next = Math.min(colors.length - 1, index + 1);
  const localT = scaled - index;

  return mixRgb(hexToRgb(colors[index]), hexToRgb(colors[next]), localT);
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

function graphemes(input: string): string[] {
  const intlWithSegmenter = Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: "grapheme" },
    ) => {
      segment(value: string): Iterable<{ segment: string }>;
    };
  };

  if (intlWithSegmenter.Segmenter) {
    const segmenter = new intlWithSegmenter.Segmenter(undefined, {
      granularity: "grapheme",
    });

    return Array.from(segmenter.segment(input), (part) => part.segment);
  }

  return Array.from(input);
}

function visibleWidth(input: string): number {
  let total = 0;

  for (const part of graphemes(stripAnsi(input))) {
    total += charWidth(part);
  }

  return total;
}

function charWidth(input: string): number {
  const cp = input.codePointAt(0);

  if (cp == null) return 0;
  if (cp === 0) return 0;
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

function stripAnsi(input: string): string {
  return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function clipVisible(input: string, maxWidth: number): string {
  const cleanInput = input.replace(/\n/g, " ");
  const target = Math.max(0, maxWidth);

  if (visibleWidth(cleanInput) <= target) {
    return cleanInput;
  }

  let out = "";
  let used = 0;

  for (const part of graphemes(cleanInput)) {
    const w = charWidth(part);
    if (used + w > Math.max(0, target - 1)) break;

    out += part;
    used += w;
  }

  return `${out}…`;
}

function padAnsi(input: string, targetWidth: number): string {
  const pad = Math.max(0, targetWidth - visibleWidth(input));
  return input + " ".repeat(pad);
}
