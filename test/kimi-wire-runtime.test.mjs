import test from "node:test";
import assert from "node:assert/strict";

import { createKimiWireRuntime } from "../dist/runtime/kimi-wire-runtime.js";

test("kimi-wire runtime is opt-in until isolated HOME and .kimi parity are implemented", () => {
  const disabled = createKimiWireRuntime({ env: { OMK_ENABLE_KIMI_WIRE: "" } });
  assert.equal(disabled.supports({}), false);

  const enabled = createKimiWireRuntime({ env: { OMK_ENABLE_KIMI_WIRE: "1" } });
  assert.equal(enabled.supports({}), true);
});
