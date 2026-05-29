import type { CliRenderer } from "../../../cli/ui/renderer.js";
import type { SlashCommandResult } from "./types.js";

export function okSlashResult(partial: Omit<SlashCommandResult, "ok"> = {}): SlashCommandResult {
  return { ok: true, ...partial };
}

export function exitSlashResult(): SlashCommandResult {
  return { ok: true, exit: true };
}

export function errorSlashResult(text: string): SlashCommandResult {
  return { ok: false, text };
}

export function emitSlashResult(result: SlashCommandResult, renderer?: CliRenderer): void {
  for (const event of result.events ?? []) renderer?.emit(event);
  if (!result.text || !renderer) return;
  if (result.ok) renderer.emit({ type: "control:output", text: result.text });
  else renderer.emit({ type: "turn:error", message: result.text });
}
