/**
 * Types for native ast-grep operations.
 */

import type { Cancellable } from "../bindings";

export type AstStrictness = "cst" | "smart" | "ast" | "relaxed" | "signature";

export interface AstFindOptions extends Cancellable {
	patterns?: string[];
	lang?: string;
	path?: string;
	glob?: string;
	selector?: string;
	strictness?: AstStrictness;
	limit?: number;
	offset?: number;
	includeMeta?: boolean;
	context?: number;
}

export interface AstFindMatch {
	path: string;
	text: string;
	byteStart: number;
	byteEnd: number;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	metaVariables?: Record<string, string>;
}

export interface AstFindResult {
	matches: AstFindMatch[];
	totalMatches: number;
	filesWithMatches: number;
	filesSearched: number;
	limitReached: boolean;
	parseErrors?: string[];
}

export interface AstReplaceOptions extends Cancellable {
	rewrites?: Record<string, string>;
	lang?: string;
	path?: string;
	glob?: string;
	selector?: string;
	strictness?: AstStrictness;
	dryRun?: boolean;
	maxReplacements?: number;
	maxFiles?: number;
	failOnParseError?: boolean;
}

export interface AstReplaceChange {
	path: string;
	before: string;
	after: string;
	byteStart: number;
	byteEnd: number;
	deletedLength: number;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export interface AstReplaceFileChange {
	path: string;
	count: number;
}

export interface AstReplaceResult {
	changes: AstReplaceChange[];
	fileChanges: AstReplaceFileChange[];
	totalReplacements: number;
	filesTouched: number;
	filesSearched: number;
	applied: boolean;
	limitReached: boolean;
	parseErrors?: string[];
}

declare module "../bindings" {
	interface NativeBindings {
		astGrep(options: AstFindOptions): Promise<AstFindResult>;
		astEdit(options: AstReplaceOptions): Promise<AstReplaceResult>;
	}
}
