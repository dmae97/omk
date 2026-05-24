import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

const { shouldUseDirectKimiFallback } = await import("../dist/commands/chat/runtime.js");

test("shouldUseDirectKimiFallback: auto (no env) → false", () => {
  deepStrictEqual(shouldUseDirectKimiFallback("auto", {}), false);
});

test("shouldUseDirectKimiFallback: undefined → false", () => {
  deepStrictEqual(shouldUseDirectKimiFallback(undefined, {}), false);
});

test("shouldUseDirectKimiFallback: codex → false", () => {
  deepStrictEqual(shouldUseDirectKimiFallback("codex", {}), false);
});

test("shouldUseDirectKimiFallback: deepseek → false", () => {
  deepStrictEqual(shouldUseDirectKimiFallback("deepseek", {}), false);
});

test("shouldUseDirectKimiFallback: kimi → true", () => {
  deepStrictEqual(shouldUseDirectKimiFallback("kimi", {}), true);
});

test("shouldUseDirectKimiFallback: auto + legacy → true", () => {
  deepStrictEqual(shouldUseDirectKimiFallback("auto", { OMK_LEGACY_CHAT: "1" }), true);
});

test("shouldUseDirectKimiFallback: codex + legacy → true", () => {
  deepStrictEqual(shouldUseDirectKimiFallback("codex", { OMK_LEGACY_CHAT: "1" }), true);
});
