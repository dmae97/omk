import { native } from "../native";
import type { ChunkNode, ChunkTree, RenderChunkTreeParams } from "./types";

export type { ChunkNode, ChunkTree, RenderChunkTreeParams, VisibleLineRange } from "./types";

export function parseChunkTree(source: string, language: string): ChunkTree {
	return native.parseChunkTree(source, language);
}

export function resolveChunkPath(tree: ChunkTree, chunkPath: string): ChunkNode | undefined {
	return native.resolveChunkPath(tree, chunkPath);
}

export function lineToChunkPath(tree: ChunkTree, line: number): string | undefined {
	return native.lineToChunkPath(tree, line);
}

export function lineToContainingChunkPath(tree: ChunkTree, line: number): string | undefined {
	return native.lineToContainingChunkPath(tree, line);
}

export function renderChunkTree(params: RenderChunkTreeParams): string {
	return native.renderChunkTree(params);
}
