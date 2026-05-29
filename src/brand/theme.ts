const ESC = "\x1b[";

function rgb(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`;
}

export type OmkBrandThemeName = "system24" | "green-rain" | "plain" | "high-contrast";
export type OmkTuiMotion = "off" | "low" | "auto" | "full";

export interface OmkBrandTheme {
  name: OmkBrandThemeName;
  label: string;
  tagline: string;
  motto: string;
  symbols: {
    prompt: string;
    active: string;
    done: string;
    failed: string;
    pending: string;
    signal: string;
  };
  colors: {
    border: string;
    borderHot: string;
    text: string;
    muted: string;
    primary: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
  motion: {
    rain: boolean;
    spinner: "braille" | "scanline" | "none";
  };
}

export const SYSTEM24_THEME: OmkBrandTheme = {
  name: "system24",
  label: "OMK System24",
  tagline: "Provider-neutral agent console.",
  motto: "Route the work. Verify the evidence.",
  symbols: {
    prompt: "›",
    active: "▶",
    done: "✓",
    failed: "✕",
    pending: "□",
    signal: "◆",
  },
  colors: {
    border: rgb(85, 85, 85),
    borderHot: rgb(140, 140, 140),
    text: rgb(242, 242, 242),
    muted: rgb(153, 153, 153),
    primary: rgb(167, 139, 250),
    success: rgb(102, 204, 153),
    warning: rgb(245, 191, 102),
    danger: rgb(242, 143, 143),
    info: rgb(102, 204, 217),
  },
  motion: {
    rain: false,
    spinner: "braille",
  },
};

export const GREEN_RAIN_THEME: OmkBrandTheme = {
  name: "green-rain",
  label: "OMK Green Rain",
  tagline: "Provider-neutral agent control plane.",
  motto: "Follow the signal. Verify the evidence.",
  symbols: {
    prompt: "›",
    active: "▶",
    done: "✓",
    failed: "✕",
    pending: "□",
    signal: "◆",
  },
  colors: {
    border: rgb(0, 95, 45),
    borderHot: rgb(80, 255, 130),
    text: rgb(210, 255, 220),
    muted: rgb(90, 140, 105),
    primary: rgb(90, 255, 120),
    success: rgb(120, 255, 150),
    warning: rgb(230, 210, 110),
    danger: rgb(255, 110, 110),
    info: rgb(110, 220, 180),
  },
  motion: {
    rain: true,
    spinner: "scanline",
  },
};

export function resolveOmkBrandTheme(name: string | undefined): OmkBrandTheme {
  const normalized = name?.trim().toLowerCase();
  if (normalized === "green-rain" || normalized === "green" || normalized === "rain") return GREEN_RAIN_THEME;
  return SYSTEM24_THEME;
}

export function shouldUseAnsiColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined || env.TERM === "dumb") return false;
  return true;
}

export function resolveTuiMotion(env: NodeJS.ProcessEnv = process.env): OmkTuiMotion {
  if (env.NO_COLOR !== undefined || env.CI === "true" || env.CI === "1" || env.TERM === "dumb") return "off";
  const normalized = env.OMK_ANIMATION?.trim().toLowerCase();
  if (normalized === "off" || normalized === "low" || normalized === "auto" || normalized === "full") return normalized;
  return "auto";
}
