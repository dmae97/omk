export type ExternalThemeLibraryId = "chalk-animation" | "ink-gradient" | "terminal-kit";

type LazyImportResult = { default?: unknown };
const lazyImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<LazyImportResult>;

export interface ExternalThemeLibraryAdapter {
  readonly id: ExternalThemeLibraryId;
  readonly packageName: string;
  readonly repository: string;
  readonly purpose: string;
  readonly defaultEnabled: boolean;
  readonly risk: "safe" | "interactive" | "host-dependent";
  readonly notes: readonly string[];
}

export const EXTERNAL_THEME_LIBRARY_ADAPTERS: readonly ExternalThemeLibraryAdapter[] = [
  {
    id: "chalk-animation",
    packageName: "chalk-animation",
    repository: "https://github.com/bokub/chalk-animation",
    purpose: "Optional terminal text animation effects for splash/progress surfaces.",
    defaultEnabled: false,
    risk: "interactive",
    notes: [
      "Lazy-load only; the package patches console methods on import.",
      "Use only for explicit TTY animation flows, not structured renderer output.",
    ],
  },
  {
    id: "ink-gradient",
    packageName: "ink-gradient",
    repository: "https://github.com/sindresorhus/ink-gradient",
    purpose: "Ink/React gradient component for future React-based TUI surfaces.",
    defaultEnabled: false,
    risk: "safe",
    notes: [
      "Available as an adapter; current non-Ink renderers keep using ANSI-safe gradient-string paths.",
      "Requires an Ink render host before being used in live CLI output.",
    ],
  },
  {
    id: "terminal-kit",
    packageName: "terminal-kit",
    repository: "https://github.com/cronvel/terminal-kit",
    purpose: "Terminal capability bridge for raw keys, Ctrl+V-style paste hooks, and text clipboard access.",
    defaultEnabled: false,
    risk: "host-dependent",
    notes: [
      "Clipboard support depends on terminal/OS capabilities and external clipboard tools.",
      "Image screenshot capture remains handled by OMK's platform-specific screenshot bridge.",
    ],
  },
];

export interface ChalkAnimationController {
  stop(): ChalkAnimationController;
  start(): ChalkAnimationController;
  replace(text: string): ChalkAnimationController;
}

export type ChalkAnimationEffect = "rainbow" | "pulse" | "glitch" | "radar" | "neon" | "karaoke";
export type ChalkAnimationModule = Record<ChalkAnimationEffect, (text: string, speed?: number) => ChalkAnimationController>;

export async function loadChalkAnimation(): Promise<ChalkAnimationModule> {
  const mod = await import("chalk-animation");
  return mod.default as ChalkAnimationModule;
}

export interface InkGradientProps {
  readonly children: unknown;
  readonly name?: string;
  readonly colors?: readonly unknown[];
}

export type InkGradientComponent = (props: InkGradientProps) => unknown;

export async function loadInkGradientComponent(): Promise<InkGradientComponent> {
  const mod = await lazyImport("ink-gradient");
  return mod.default as InkGradientComponent;
}

export function renderExternalThemeLibrarySummary(): string {
  return EXTERNAL_THEME_LIBRARY_ADAPTERS
    .map((adapter) => `${adapter.id}: ${adapter.purpose} (${adapter.defaultEnabled ? "default" : "opt-in"})`)
    .join("\n");
}
