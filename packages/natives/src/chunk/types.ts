export interface ChunkNode {
	path: string;
	name: string;
	kind: "branch" | "leaf";
	parentPath?: string;
	children: string[];
	signature?: string;
	startLine: number;
	endLine: number;
	lineCount: number;
	startByte: number;
	endByte: number;
	checksum: string;
	error: boolean;
	indent: number;
	indentChar: string;
}

export interface ChunkTree {
	language: string;
	checksum: string;
	lineCount: number;
	parseErrors: number;
	fallback: boolean;
	rootPath: string;
	rootChildren: string[];
	chunks: ChunkNode[];
}

export interface VisibleLineRange {
	startLine: number;
	endLine: number;
}

export type ChunkAnchorStyle = "full" | "kind" | "bare";

export interface RenderChunkTreeParams {
	tree: ChunkTree;
	chunkPath?: string;
	source: string;
	title: string;
	languageTag?: string;
	checksum: string;
	visibleRange?: VisibleLineRange;
	renderChildrenOnly: boolean;
	omitChecksum: boolean;
	anchorStyle?: ChunkAnchorStyle;
	showLeafPreview: boolean;
	tabReplacement?: string;
}

declare module "../bindings" {
	interface NativeBindings {
		parseChunkTree(source: string, language: string): ChunkTree;
		resolveChunkPath(tree: ChunkTree, chunkPath: string): ChunkNode | undefined;
		lineToChunkPath(tree: ChunkTree, line: number): string | undefined;
		lineToContainingChunkPath(tree: ChunkTree, line: number): string | undefined;
		renderChunkTree(params: RenderChunkTreeParams): string;
	}
}
