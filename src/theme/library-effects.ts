import gradientString from "gradient-string";
import { style } from "./colors.js";
import { shouldUseAnsiColor } from "../brand/theme.js";
import { getTerminalKitBridgeCapabilities } from "../util/terminal-kit-bridge.js";

export type GradientPreset =
  | "atlas"
  | "cristal"
  | "teen"
  | "mind"
  | "morning"
  | "vice"
  | "passion"
  | "fruit"
  | "instagram"
  | "retro"
  | "summer"
  | "rainbow"
  | "pastel";

export type ChalkKeyframeEffect = "rainbow" | "pulse" | "glitch" | "radar" | "neon" | "karaoke";

function gradientPresetFn(name: GradientPreset): (text: string) => string {
  const fn = gradientString[name] as unknown;
  return typeof fn === "function" ? fn as (text: string) => string : gradientString.rainbow;
}

export function renderGradientPreset(
  text: string,
  preset: GradientPreset,
  options: { noColor?: boolean } = {},
): string {
  if (options.noColor || !shouldUseAnsiColor()) return text;
  return gradientPresetFn(preset)(text);
}

export function renderInkGradientFallback(
  text: string,
  preset: GradientPreset = "pastel",
  options: { noColor?: boolean } = {},
): string {
  // ink-gradient renders the same gradient-string presets inside Ink/React.
  // Non-Ink OMK surfaces use this static fallback while the React component is
  // exposed through external-theme-adapters for future Ink render hosts.
  return renderGradientPreset(text, preset, options);
}

export function renderChalkAnimationKeyframe(
  text: string,
  effect: ChalkKeyframeEffect = "rainbow",
  frame = 0,
  options: { noColor?: boolean } = {},
): string {
  if (options.noColor || !shouldUseAnsiColor()) return text;
  switch (effect) {
    case "pulse":
      return frame % 2 === 0 ? style.redBold(text) : style.whiteBold(text);
    case "glitch":
      return frame % 3 === 0 ? style.cyanBold(text.replace(/[A-Z]/g, (ch) => `${ch}·`)) : style.hotPink(text);
    case "radar":
      return renderGradientPreset(text, "cristal", options);
    case "neon":
      return frame % 2 === 0 ? style.hotPink(text) : style.purpleBold(text);
    case "karaoke":
      return renderGradientPreset(text, "summer", options);
    case "rainbow":
    default:
      return renderGradientPreset(text, "rainbow", options);
  }
}

export function renderTerminalKitCapabilityBadge(text: string): string {
  const caps = getTerminalKitBridgeCapabilities();
  const badge = caps.available
    ? caps.ctrlVPasteKey && caps.textClipboard
      ? "tk:keys+clip"
      : "tk:loaded"
    : "tk:off";
  return `${style.cyanBold(`[${badge}]`)} ${text}`;
}
