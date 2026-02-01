# Porting to pi-natives (N-API) — Field Notes

This is a practical guide for moving hot paths into `crates/pi-natives` and wiring them through the JS bindings. It exists to avoid the same failures happening twice.

## When to port

Port when any of these are true:

- The hot path is called in render loops or large batches.
- JS allocates too much (string churn, regex backtracking, large arrays).
- You already have a JS implementation and can write a benchmark for it.

Do not port code that depends on JS-only state, dynamic imports, or anything async-first. N-API favors CPU-bound, synchronous work.

## Anatomy of a native export

**Rust side:**
- Implementation lives in `crates/pi-natives/src/<module>.rs`.
- Export lives either in that module **with** `#[napi]` or in `lib.rs` calling into the module.

**JS side:**
- `packages/natives/src/native.ts` declares the binding and validates it.
- `packages/natives/src/<module>/index.ts` wraps the binding.
- `packages/natives/src/index.ts` re-exports it.
- Call sites (often in `packages/tui/src/utils.ts`) use the wrapper.

## Porting checklist

1) **Add the Rust implementation**
- Put the core logic in a plain Rust function.
- Expose it with `#[napi(js_name = "...")]`.
- Keep signatures simple: `String`, `Vec<String>`, `Uint8Array`, numbers, bools.

2) **Wire JS bindings**
- Add the method to `NativeBindings` in `packages/natives/src/native.ts`.
- Add `checkFn("newExport")` in `validateNative`.
- Add a wrapper in `packages/natives/src/<module>/index.ts`.
- Re-export from `packages/natives/src/index.ts`.

3) **Add benchmarks**
- Put benchmarks in `packages/tui/bench/*.ts` (see `text-layout.ts`).
- Include a JS baseline and native version in the same run.
- Use `performance.now()` and a fixed iteration count.
- Keep the benchmark inputs small and realistic (actual data seen in the hot path).

4) **Build the native binary**
- `bun --cwd=packages/natives run build:native`

5) **Run the benchmark**
- `bun run packages/tui/bench/<bench>.ts`

6) **Decide on usage**
- If native is slower, **keep JS** and leave the native export unused.
- If native is faster, switch call sites to the native wrapper.

## Pain points and how to avoid them

### 1) Stale `pi_natives.node` prevents new exports
The build script prefers `target/release/pi_natives.node` if it exists. If it’s stale, the exported symbols won’t update even after a rebuild.

**Fix:** remove the stale file before rebuilding.

```bash
rm /work/pi/target/release/pi_natives.node
bun --cwd=packages/natives run build:native
```

Then verify the export exists in the binary:

```bash
bun -e "const mod = require('./packages/natives/native/pi_natives.linux-x64.node'); console.log(Object.keys(mod).includes('newExport'));"
```

### 2) “Missing exports” errors from `validateNative`
This is **good** — it prevents silent mismatches. When you see this:

```
Native addon missing exports ... Missing: applyLineResets
```

it means your binary is stale or the `#[napi]` export didn’t compile in. Fix the build, don’t weaken validation.

### 3) Rust signature mismatch
Keep it simple. `Vec<String>` works. Avoid references like `&str` in public exports. If you need complex types, wrap them in `#[napi(object)]` structs.

### 4) Benchmarking mistakes
- Don’t compare different inputs or allocations.
- Keep JS and native using identical input arrays.
- Run both in the same benchmark file to avoid skew.

## Benchmark template

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
	const start = performance.now();
	for (let i = 0; i < ITERATIONS; i++) fn();
	const elapsed = performance.now() - start;
	console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(4)}ms/op)`);
	return elapsed;
}

bench("feature/js", () => {
	jsImpl(sample);
});

bench("feature/native", () => {
	nativeImpl(sample);
});
```

## Verification checklist

- `validateNative` passes (no missing exports).
- `Object.keys(require(...))` includes your new export.
- Bench numbers recorded in the PR/notes.
- Call site updated **only if** native is faster or equal.

## Rule of thumb

- If native is slower, **do not switch**. Keep the export for future work, but the TUI should stay on the faster path.
- If native is faster, switch the call site and keep the benchmark in place to catch regressions.
