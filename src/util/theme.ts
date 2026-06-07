/**
 * Backward-compatible theme bridge.
 *
 * The canonical OMK UI/UX surface lives in src/theme/*. New code should import
 * from `../theme/index.js` (or focused submodules) directly. This bridge keeps
 * existing `util/theme.js` consumers on the same single source of truth without
 * preserving a duplicate theme implementation.
 */
export * from "../theme/index.js";
