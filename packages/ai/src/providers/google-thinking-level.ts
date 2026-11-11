/**
 * Thinking level for Gemini 3 models.
 * Mirrors Google's ThinkingLevel enum values.
 *
 * Kept free of `@google/genai` imports: the root entry re-exports this type, and
 * the SDK declarations reference its optional `@modelcontextprotocol/sdk` peer.
 */
export type GoogleThinkingLevel = "THINKING_LEVEL_UNSPECIFIED" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
