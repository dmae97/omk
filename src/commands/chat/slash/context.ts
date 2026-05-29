import type { NativeRootLoopInput, NativeRootSessionState } from "../native-root-loop.js";
import type { SlashCommandContext } from "./types.js";

export function createSlashCommandContext(input: NativeRootLoopInput, state: NativeRootSessionState): SlashCommandContext {
  return {
    input,
    state,
    renderer: input.renderer,
    env: input.env,
  };
}
