/**
 * CLI Theme — Terminal Capability Detection
 * Detects color support, unicode, TTY status, and terminal dimensions.
 */

export type ColorDepth = 0 | 1 | 4 | 8 | 24;

/** Degradation tier used by the render-table compiler. */
export type ColorTier = "truecolor" | "256" | "16" | "no-color";

export interface TerminalCapability {
  readonly isTty: boolean;
  readonly isCi: boolean;
  readonly colorDisabled: boolean;
  readonly colorDepth: ColorDepth;
  readonly colorTier: ColorTier;
  readonly unicode: boolean;
  readonly width: number;
}

function detectCi(): boolean {
  return !!(
    process.env.CI
    || process.env.CONTINUOUS_INTEGRATION
    || process.env.BUILD_ID
    || process.env.BUILD_NUMBER
    || process.env.GITHUB_ACTIONS
    || process.env.GITLAB_CI
    || process.env.TRAVIS
    || process.env.CIRCLECI
    || process.env.APPVEYOR
    || process.env.JENKINS_URL
  );
}

function detectColorDepth(argv: readonly string[] = process.argv): ColorDepth {
  // Explicit opt-out: --no-color CLI flag or NO_COLOR env
  if (argv.includes("--no-color")) {
    return 0;
  }
  if (process.env.NO_COLOR !== undefined || process.env.TERM === "dumb") {
    return 0;
  }

  const force = process.env.FORCE_COLOR;
  if (force === "0" || force === "false") return 0;
  if (force === "1") return 1;
  if (force === "2") return 4;
  if (force === "3") return 8;

  // 24-bit truecolor
  if (process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit") {
    return 24;
  }

  // Terminfo-based detection
  const term = process.env.TERM || "";
  if (term.includes("256color") || term.includes("256")) {
    return 8;
  }

  if (term.includes("color") || term.includes("xterm") || term.includes("screen") || term.includes("tmux")) {
    return 4;
  }

  // TTY without explicit color support → assume basic ANSI
  if (process.stdout.isTTY) {
    return 1;
  }

  return 0;
}

function detectUnicode(): boolean {
  if (process.env.OMK_UNICODE === "0" || process.env.OMK_UNICODE === "false") {
    return false;
  }
  if (process.env.OMK_UNICODE === "1" || process.env.OMK_UNICODE === "true") {
    return true;
  }
  if (process.platform === "win32") {
    // Windows Terminal and modern consoles support unicode
    return !!process.env.WT_SESSION || !!process.env.TERMINAL_EMULATOR;
  }
  return process.stdout.isTTY ?? false;
}

function getTerminalWidth(): number {
  if (typeof process.stdout.columns === "number" && process.stdout.columns > 0) {
    return process.stdout.columns;
  }
  return 80;
}

export function colorTierForDepth(depth: ColorDepth): ColorTier {
  if (depth === 24) return "truecolor";
  if (depth === 8) return "256";
  if (depth === 4 || depth === 1) return "16";
  return "no-color";
}

export function detectColorTier(argv: readonly string[] = process.argv): ColorTier {
  return colorTierForDepth(detectColorDepth(argv));
}

export function getTerminalCapability(argv: readonly string[] = process.argv): TerminalCapability {
  const isCi = detectCi();
  const colorDepth = detectColorDepth(argv);

  return {
    isTty: process.stdout.isTTY ?? false,
    isCi,
    colorDisabled: colorDepth === 0,
    colorDepth,
    colorTier: colorTierForDepth(colorDepth),
    unicode: detectUnicode(),
    width: getTerminalWidth(),
  };
}

export function defaultThemeForCapability(cap: TerminalCapability): { name: string; mode: "dark" | "light" | "auto" | "mono" } {
  if (cap.colorDisabled || cap.colorDepth === 0) {
    return { name: "mono", mode: "mono" };
  }
  if (cap.isCi) {
    return { name: "minimal", mode: "auto" };
  }
  return { name: "omk-control-grid-dark", mode: "dark" };
}
