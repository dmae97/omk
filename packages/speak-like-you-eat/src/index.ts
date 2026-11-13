// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.

export type { ModelReference, SlyeConfig } from "./config.ts";
export { loadEffectiveConfig, parseConfig, readConfig, writeConfigAtomically } from "./config.ts";
export type { SlyeExtensionOptions } from "./extension.ts";
export { default } from "./extension.ts";
export type { CompleteRewrite, RewriteOutcome } from "./rewrite.ts";
export { buildRewriteContext, completeRewrite, ELI5_SYSTEM_PROMPT, REWRITE_TIMEOUT_MS } from "./rewrite.ts";
export type { PreparedRewriteRequest, RewriteRequest } from "./target.ts";
export { prepareManualRewriteRequest, prepareRewriteRequest, stripFencedCodeBlocks } from "./target.ts";
