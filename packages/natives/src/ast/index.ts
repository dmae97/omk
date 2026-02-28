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

export async function astFind(options: AstFindOptions): Promise<AstFindResult> {
	return native.astFind(options);
}

export async function astReplace(options: AstReplaceOptions): Promise<AstReplaceResult> {
	return native.astReplace(options);
}
