export interface RequestOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
	transfer?: ArrayBufferLike[];
}
