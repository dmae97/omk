import test from "node:test";
import assert from "node:assert/strict";

const { renderOmkSigil, renderOmkSparkleText } = await import("../dist/ui/omk-sigil.js");

function stripAnsi(value) {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

test("renderOmkSparkleText preserves visible text while changing ANSI by frame", () => {
  const previousNoColor = process.env.NO_COLOR;
  const previousTerm = process.env.TERM;
  try {
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm-256color";
    const title = "◢█ OMK//CONTROL █◣";
    const a = renderOmkSparkleText(title, { frame: 0 });
    const b = renderOmkSparkleText(title, { frame: 3 });

    assert.equal(stripAnsi(a), title);
    assert.equal(stripAnsi(b), title);
    assert.notEqual(a, b);
    assert.match(a, /OMK\/\/CONTROL/);
  } finally {
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
  }
});

test("renderOmkSparkleText honors noColor", () => {
  const title = "◢█ OMK GREEN RAIN █◣";
  assert.equal(renderOmkSparkleText(title, { frame: 1, noColor: true }), title);
});

test("renderOmkSigil defaults to animated OMK wordmark", () => {
  const previousNoColor = process.env.NO_COLOR;
  const previousTerm = process.env.TERM;
  try {
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm-256color";
    const a = renderOmkSigil({ width: 64, frame: 0 });
    const b = renderOmkSigil({ width: 64, frame: 6 });
    const plain = a.map(stripAnsi);

    assert.equal(a.length, 6);
    assert.ok(plain.some((line) => line.includes("██████╗")));
    assert.ok(plain.some((line) => line.includes("╚═════╝")));
    assert.ok(plain.every((line) => line.length <= 64));
    assert.deepEqual(plain, b.map(stripAnsi));
    assert.notDeepEqual(a, b);
  } finally {
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
  }
});

test("renderOmkSigil keeps visible OMK sigil shape stable", () => {
  const lines = renderOmkSigil({ name: "gate", width: 64, frame: 0 });
  const plain = lines.map(stripAnsi);

  assert.equal(lines.length, 10);
  assert.ok(plain.some((line) => line.includes("OMK//CTRL")));
  assert.ok(plain.every((line) => line.length <= 64));
});

test("renderOmkSigil honors NO_COLOR", () => {
  const previousNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const lines = renderOmkSigil({ name: "grid", width: 64, frame: 9 });
    assert.ok(lines.some((line) => line.includes("OMK")));
    assert.ok(lines.every((line) => !/\x1b\[/.test(line)));
  } finally {
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
  }
});
