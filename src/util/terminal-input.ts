/**
 * Helpers for temporarily taking ownership of TTY input.
 *
 * Interactive wrappers, dashboards, and mode pickers often need raw stdin.
 * They must restore only the terminal state they changed; otherwise nested
 * tmux/WSL sessions can lose visible input or stay in raw mode after exit.
 */

export interface TerminalInputLike {
  isTTY?: boolean;
  isRaw?: boolean;
  readableFlowing: boolean | null;
  setRawMode?: (mode: boolean) => unknown;
  resume(): unknown;
  pause(): unknown;
  listenerCount(eventName: string | symbol): number;
}

export interface TerminalInputState {
  readonly wasTTY: boolean;
  readonly rawMode?: boolean;
  readonly readableFlowing: boolean | null;
  readonly dataListenerCount: number;
}

export function captureTerminalInputState(input: TerminalInputLike = process.stdin): TerminalInputState {
  return {
    wasTTY: Boolean(input.isTTY),
    rawMode: input.isTTY ? Boolean(input.isRaw) : undefined,
    readableFlowing: input.readableFlowing,
    dataListenerCount: input.listenerCount("data"),
  };
}

export function enableRawTerminalInput(input: TerminalInputLike = process.stdin): TerminalInputState {
  const state = captureTerminalInputState(input);
  if (input.isTTY && typeof input.setRawMode === "function") {
    input.setRawMode(true);
  }
  input.resume();
  return state;
}

/**
 * Defensive re-validation of interactive stdin before a fresh readline takes
 * ownership of the TTY.
 *
 * The first-run GitHub-star prompt (maybeAskForGitHubStarAtChatStart) and the
 * update prompt (maybePromptForOmkUpdate) use @inquirer/prompts, which take
 * over raw mode and run their own readline on process.stdin. On completion they
 * can leave the shared interactive stdin explicitly paused
 * (readableFlowing === false). A freshly created readline then observes an
 * immediate EOF/'close' and the native chat loop exits with "Session ended".
 *
 * This helper only resumes a real TTY that was explicitly paused. Non-TTY
 * stdin (pipes/EOF, CI, non-interactive callers) is intentionally left
 * untouched so existing exit/EOF behavior is preserved. A fresh, never-started
 * stream (readableFlowing === null) is also left alone so readline can manage
 * its own initial resume without racing for the first byte.
 *
 * Returns true only when it actually resumed a paused interactive stream.
 */
export function resumeInteractiveInput(input: TerminalInputLike = process.stdin): boolean {
  if (!input.isTTY) return false;
  if (input.readableFlowing !== false) return false;
  try {
    input.resume();
  } catch {
    return false;
  }
  return true;
}

export function restoreTerminalInputState(
  input: TerminalInputLike = process.stdin,
  state: TerminalInputState
): void {
  const externalDataOwnerAttached = input.listenerCount("data") > state.dataListenerCount;
  if (!externalDataOwnerAttached && state.wasTTY && typeof input.setRawMode === "function") {
    input.setRawMode(state.rawMode ?? false);
  }

  // Only pause stdin when this owner started it and no other data consumer is
  // still attached. Pausing shared stdin after readline/PTY cleanup is a common
  // cause of apparently "disappearing" keyboard input in nested WSL terminals.
  if (state.readableFlowing !== true && !externalDataOwnerAttached && input.listenerCount("data") === 0) {
    input.pause();
  }
}
