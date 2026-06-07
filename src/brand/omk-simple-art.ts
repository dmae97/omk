/**
 * Canonical compact OMK control-plane banner.
 *
 * This intentionally stays <= 5 lines and narrow-terminal friendly for logs,
 * smoke tests, fallback provider paths, and Rust/native safety surfaces.
 */
export const OMK_SIMPLE_ASCII_ART = [
  "  ╔═ OMK//CONTROL ═══════╗",
  "  ║ ROUTE  │ VERIFY      ║",
  "  ║ TOKENS │ AGENTS      ║",
  "  ║ MCP    │ HOOKS       ║",
  "  ╚═ METRICS // LIVE ════╝",
].join("\n");
