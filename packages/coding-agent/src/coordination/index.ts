/**
 * Parallel-session coordination kernel.
 *
 * Pure, deterministic, bounded. Implements the P0 shared by the 2026-09-20
 * coordination design and the Jev audit: bind admission to actual claims, and
 * keep a possibly-live effect's claims held until termination is observed.
 * No IPC, no process control, no persistence.
 */
export * from "./awareness.ts";
export * from "./broker.ts";
export * from "./integration.ts";
export * from "./operation.ts";
export * from "./resource.ts";
export * from "./session.ts";
export * from "./types.ts";
