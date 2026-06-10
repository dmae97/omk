import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const { isPathWritable, assertWritable, SandboxWriteDeniedError } = await import(
  "../dist/runtime/sandbox-profile.js"
);

test("(a) unset/empty roots => allow (safe default, unrestricted)", () => {
  assert.equal(isPathWritable("/any/where/file.txt", undefined), true);
  assert.equal(isPathWritable("/any/where/file.txt", []), true);
  assert.doesNotThrow(() => assertWritable("/any/where/file.txt", []));
});

test("(b) path inside a writable root => allow", () => {
  assert.equal(isPathWritable("/a/b/c.txt", ["/a/b"]), true);
  assert.equal(isPathWritable("/a/b", ["/a/b"]), true); // root itself
  assert.doesNotThrow(() => assertWritable("/a/b/nested/deep.ts", ["/a/b"]));
});

test("(c) sibling-prefix /a/bc vs root /a/b => deny", () => {
  assert.equal(isPathWritable("/a/bc", ["/a/b"]), false);
  assert.equal(isPathWritable("/a/bc/x.txt", ["/a/b"]), false);
  assert.throws(() => assertWritable("/a/bc/x.txt", ["/a/b"]), SandboxWriteDeniedError);
});

test("(d) .. escape outside root => deny", () => {
  assert.equal(isPathWritable("/a/b/../../etc/passwd", ["/a/b"]), false);
  assert.equal(isPathWritable("/a/b/../secret", ["/a/b"]), false);
  assert.throws(() => assertWritable("/a/b/../../etc/passwd", ["/a/b"]), SandboxWriteDeniedError);
});

test(".. that stays inside root => allow", () => {
  assert.equal(isPathWritable("/a/b/sub/../ok.txt", ["/a/b"]), true);
});

test("multiple roots: matches any", () => {
  assert.equal(isPathWritable("/y/z/f", ["/a/b", "/y/z"]), true);
  assert.equal(isPathWritable("/q/r/f", ["/a/b", "/y/z"]), false);
});

// --- Lane C2 realpath/symlink hardening (Wave-4 C2) -------------------------

test("(e) symlink inside root whose real target escapes all roots => deny", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omk-sbx-")));
  try {
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    // root/escape -> outside (a symlink whose real target is outside the root)
    fs.symlinkSync(outside, path.join(root, "escape"));
    const target = path.join(root, "escape", "evil.txt"); // not created
    assert.equal(isPathWritable(target, [root]), false);
    assert.throws(() => assertWritable(target, [root]), SandboxWriteDeniedError);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("(f) legit nested non-existent target under a root => allow", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omk-sbx-")));
  try {
    const target = path.join(base, "a", "b", "c", "new-file.txt"); // none exist
    assert.equal(isPathWritable(target, [base]), true);
    assert.doesNotThrow(() => assertWritable(target, [base]));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("(g) realpath failure (no existing ancestor) falls back gracefully, no throw", () => {
  // Root and target share a fully non-existent prefix: realpathSync throws
  // ENOENT on every ancestor up to "/", so resolution must fall back to
  // path.resolve and never throw from the resolution step.
  const root = path.join(os.tmpdir(), `omk-nonexistent-${Date.now()}-${process.pid}`);
  const target = path.join(root, "x", "y", "z.txt");
  let writable;
  assert.doesNotThrow(() => {
    writable = isPathWritable(target, [root]);
  });
  assert.equal(writable, true); // same non-existent prefix => allowed
  assert.doesNotThrow(() => assertWritable(target, [root]));
});
