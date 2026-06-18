/**
 * Backward-compatible re-export shim.
 *
 * The original positional-args ThinkingSelectorComponent in this module was
 * dead code (never instantiated). The actual implementation now lives in
 * `settings-selector.ts` and uses a config+callbacks API. We re-export it
 * here so external SDK consumers that import from this path keep working.
 */
export { ThinkingSelectorComponent } from "./settings-selector.ts";
