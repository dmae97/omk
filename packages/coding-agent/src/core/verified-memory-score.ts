/** Lexical retrieval signal, not an instruction priority or truth probability. */
export interface MemoryScoreRecord {
	readonly path: string;
	readonly quote: string;
	readonly contentHash: string;
	readonly startLine: number;
	readonly endLine: number;
}
const STOP = new Set([
	"the",
	"and",
	"for",
	"with",
	"from",
	"this",
	"that",
	"into",
	"please",
	"what",
	"how",
	"then",
	"are",
	"was",
	"have",
	"will",
	"would",
	"should",
	"could",
	"너무",
	"그리고",
]);
function termsForMemory(query: string, maximum: number): readonly string[] {
	const split = query
		.slice(0, 4096)
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.normalize("NFKC")
		.toLowerCase();
	const result = new Set<string>();
	for (const term of split.match(/[\p{L}\p{N}]+/gu) ?? []) {
		if (term.length < 2 || STOP.has(term)) continue;
		result.add(term);
		if (result.size >= maximum) break;
	}
	return [...result];
}
export function memoryQueryTerms(query: string): readonly string[] {
	return termsForMemory(query, 64);
}
export function memoryMatches(record: MemoryScoreRecord, query: readonly string[]): ReadonlySet<string> {
	const quote = new Set(termsForMemory(record.quote, 1024));
	const path = new Set(termsForMemory(record.path.replace(/[/._-]/g, " "), 1024));
	return new Set(query.filter((term) => quote.has(term) || path.has(term)));
}
export function memoryMarginalUtility(
	matches: ReadonlySet<string>,
	seen: ReadonlyMap<string, number>,
	querySize: number,
): number {
	if (querySize === 0) return 0;
	let value = 0;
	for (const term of matches) value += 1 / (1 + (seen.get(term) ?? 0));
	return value / querySize;
}
/** Fully covered source spans have no new evidence. Partial overlap is retained. */
export function memorySpanCovered(record: MemoryScoreRecord, selected: readonly MemoryScoreRecord[]): boolean {
	const spans = selected
		.filter((r) => r.path === record.path && r.contentHash === record.contentHash)
		.map((r) => [r.startLine, r.endLine] as const)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let next = record.startLine;
	for (const [start, end] of spans) {
		if (start > next) break;
		if (end >= next) next = end + 1;
		if (next > record.endLine) return true;
	}
	return false;
}
