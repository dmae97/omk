import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface TerminalKitBridgeCapabilities {
  readonly available: boolean;
  readonly rawInput: boolean;
  readonly ctrlVPasteKey: boolean;
  readonly textClipboard: boolean;
  readonly imageClipboard: false;
  readonly windowsImageCapture: false;
  readonly reason?: string;
}

interface TerminalKitTerminal {
  grabInput?: (enabled?: boolean | Record<string, unknown>) => unknown;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  getClipboard?: (source?: string) => Promise<string>;
  setClipboard?: (value: string, source?: string) => Promise<unknown>;
}

interface TerminalKitModule {
  terminal?: TerminalKitTerminal;
}

function loadTerminalKit(): TerminalKitModule | undefined {
  try {
    return require("terminal-kit") as TerminalKitModule;
  } catch {
    return undefined;
  }
}

export function getTerminalKitBridgeCapabilities(): TerminalKitBridgeCapabilities {
  const terminal = loadTerminalKit()?.terminal;
  if (!terminal) {
    return {
      available: false,
      rawInput: false,
      ctrlVPasteKey: false,
      textClipboard: false,
      imageClipboard: false,
      windowsImageCapture: false,
      reason: "terminal-kit is not available",
    };
  }

  return {
    available: true,
    rawInput: typeof terminal.grabInput === "function" && typeof terminal.on === "function",
    ctrlVPasteKey: typeof terminal.grabInput === "function" && typeof terminal.on === "function",
    textClipboard: typeof terminal.getClipboard === "function" && typeof terminal.setClipboard === "function",
    imageClipboard: false,
    windowsImageCapture: false,
    reason: "terminal-kit supports raw key and text clipboard bridges; image/window capture remains OMK platform-specific",
  };
}

export function isTerminalKitPasteKey(key: string | undefined): boolean {
  return key === "CTRL_V" || key === "META_P" || key === "CTRL_P";
}

export async function readTerminalKitClipboardText(source = "c"): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const terminal = loadTerminalKit()?.terminal;
  if (!terminal?.getClipboard) return { ok: false, error: "terminal-kit clipboard is unavailable" };
  try {
    const text = await terminal.getClipboard(source);
    return { ok: true, text };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function writeTerminalKitClipboardText(
  text: string,
  source = "c",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const terminal = loadTerminalKit()?.terminal;
  if (!terminal?.setClipboard) return { ok: false, error: "terminal-kit clipboard is unavailable" };
  try {
    await terminal.setClipboard(text, source);
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
