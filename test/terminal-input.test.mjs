import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  captureTerminalInputState,
  enableRawTerminalInput,
  restoreTerminalInputState,
} from "../dist/util/terminal-input.js";

class FakeInput extends EventEmitter {
  constructor({ isTTY = true, isRaw = false, readableFlowing = null } = {}) {
    super();
    this.isTTY = isTTY;
    this.isRaw = isRaw;
    this.readableFlowing = readableFlowing;
    this.rawCalls = [];
    this.resumeCalls = 0;
    this.pauseCalls = 0;
  }

  setRawMode(mode) {
    this.rawCalls.push(mode);
    this.isRaw = mode;
    return this;
  }

  resume() {
    this.resumeCalls += 1;
    this.readableFlowing = true;
    return this;
  }

  pause() {
    this.pauseCalls += 1;
    this.readableFlowing = false;
    return this;
  }
}

test("enableRawTerminalInput captures and restores raw mode ownership", () => {
  const input = new FakeInput({ isTTY: true, isRaw: false, readableFlowing: null });
  const state = enableRawTerminalInput(input);

  assert.deepEqual(state, { wasTTY: true, rawMode: false, readableFlowing: null, dataListenerCount: 0 });
  assert.deepEqual(input.rawCalls, [true]);
  assert.equal(input.resumeCalls, 1);

  restoreTerminalInputState(input, state);

  assert.deepEqual(input.rawCalls, [true, false]);
  assert.equal(input.pauseCalls, 1);
});

test("restoreTerminalInputState does not pause or reset raw mode owned by another listener", () => {
  const input = new FakeInput({ isTTY: true, isRaw: false, readableFlowing: null });
  const state = enableRawTerminalInput(input);
  input.on("data", () => undefined);

  restoreTerminalInputState(input, state);

  assert.deepEqual(input.rawCalls, [true]);
  assert.equal(input.pauseCalls, 0);
});

test("restoreTerminalInputState preserves originally flowing input", () => {
  const input = new FakeInput({ isTTY: true, isRaw: true, readableFlowing: true });
  const state = captureTerminalInputState(input);

  restoreTerminalInputState(input, state);

  assert.deepEqual(input.rawCalls, [true]);
  assert.equal(input.pauseCalls, 0);
});

test("enableRawTerminalInput skips raw mode for non-TTY input", () => {
  const input = new FakeInput({ isTTY: false, isRaw: false, readableFlowing: null });
  const state = enableRawTerminalInput(input);

  assert.deepEqual(state, { wasTTY: false, rawMode: undefined, readableFlowing: null, dataListenerCount: 0 });
  assert.deepEqual(input.rawCalls, []);
  assert.equal(input.resumeCalls, 1);
});
