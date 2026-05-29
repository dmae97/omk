import type { CliUiEvent } from "../../../cli/ui/event.js";
import type { NativeRootLoopInput, NativeRootSessionState } from "../native-root-loop.js";
import type { ParsedSlashArgs } from "./parser.js";

export type SlashCommandGroup =
  | "session"
  | "routing"
  | "tool-plane"
  | "harness"
  | "diagnostics"
  | "ui";

export interface SlashCommandContext {
  input: NativeRootLoopInput;
  state: NativeRootSessionState;
  renderer?: NativeRootLoopInput["renderer"];
  env: Record<string, string>;
}

export interface SlashCommandResult {
  ok: boolean;
  exit?: boolean;
  text?: string;
  json?: unknown;
  events?: CliUiEvent[];
  statePatch?: Partial<NativeRootSessionState>;
}

export type SlashCommandHandler = (
  ctx: SlashCommandContext,
  args: ParsedSlashArgs
) => void | SlashCommandResult | Promise<void | SlashCommandResult>;

export interface SlashCommandSpec {
  name: string;
  aliases: readonly string[];
  group: SlashCommandGroup;
  summary: string;
  usage: string;
  examples: readonly string[];
  handler: SlashCommandHandler;
}

export interface LegacySlashCommandSpec {
  name: string;
  aliases: readonly string[];
  help: string;
  group?: SlashCommandGroup;
  summary?: string;
  usage?: string;
  examples?: readonly string[];
  handler: (args: string) => void | Promise<void>;
}

export type RegisteredSlashCommandSpec = SlashCommandSpec | LegacySlashCommandSpec;
