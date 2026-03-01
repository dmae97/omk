/**
 * Native AST structural search and rewrite wrappers.
 */

import { native } from "../native";
import type { AstFindOptions, AstFindResult, AstReplaceOptions, AstReplaceResult } from "./types";

export type {
	AstFindMatch,
	AstFindOptions,
	AstFindResult,
	AstReplaceChange,
	AstReplaceFileChange,
	AstReplaceOptions,
	AstReplaceResult,
	AstStrictness,
} from "./types";

export async function astGrep(options: AstFindOptions): Promise<AstFindResult> {
	return native.astGrep(options);
}

export async function astEdit(options: AstReplaceOptions): Promise<AstReplaceResult> {
	return native.astEdit(options);
}
