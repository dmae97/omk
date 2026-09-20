/**
 * Observation kernel — U1/U2/U3 substrate of the upgraded SoL-Pi design.
 *
 * Pure, deterministic, bounded modules: raw-observation storage with byte-
 * scoped reads, deterministic views with a coverage gate, and a shadow
 * observation-mode recorder. No model calls, no I/O, no completion authority.
 */
export * from "./identity.ts";
export * from "./observe-mode.ts";
export * from "./store.ts";
export * from "./types.ts";
export * from "./view.ts";
