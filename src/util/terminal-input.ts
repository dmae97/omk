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
