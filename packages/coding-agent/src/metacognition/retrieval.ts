/**
 * Bounded local BM25 retrieval and the acquisition pool that owns every
 * started promise until actual settlement.
 *
 * Ported from docs/OMK_skill_knowledge_control_2026-09-19.zip
 * (src/retrieval.ts). Search hits are `candidate-only`, never auto-promoted
 * to observations.
 */
import { ensure, integer, lexical, text, unique } from "./validation.ts";

export interface CorpusDocument {
	readonly id: string;
	readonly uri: string;
	readonly body: string;
}
export interface SearchHit extends CorpusDocument {
	readonly score: number;
	readonly trust: "candidate-only";
}
/** Retrieval tokens, not a semantic-knowledge detector. Short language names survive. */
export function retrievalTokens(value: string): string[] {
	return (
		value
			.normalize("NFKC")
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.toLowerCase()
			.match(/[\p{L}\p{N}]+(?:\+\+|#)?/gu) ?? []
	);
}
/** BM25 with positive IDF; bounded local corpus, no I/O or model call. */
export function searchCorpus(query: string, corpus: readonly CorpusDocument[], limit = 8): SearchHit[] {
	text(query, "query", 4096);
	integer(limit, "limit", 64);
	ensure(corpus.length <= 5000, "corpus too large");
	unique(
		corpus.map((d) => d.id),
		"document ids",
		5000,
	);
	let totalChars = 0;
	const documents = corpus.map((d) => {
		text(d.uri, "uri");
		ensure(typeof d.body === "string" && d.body.length <= 100_000, "document too large");
		totalChars += d.body.length;
		ensure(totalChars <= 10_000_000, "corpus byte/character policy exceeded");
		const tokens = retrievalTokens(d.body);
		const frequencies = new Map<string, number>();
		for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
		return { d, length: tokens.length, frequencies };
	});
	const terms = [...new Set(retrievalTokens(query))];
	if (!terms.length || !documents.length || limit === 0) return [];
	const avgLength = Math.max(1, documents.reduce((s, d) => s + d.length, 0) / documents.length);
	const idf = new Map(
		terms.map((term) => {
			const frequency = documents.filter((d) => d.frequencies.has(term)).length;
			return [term, Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5))] as const;
		}),
	);
	return documents
		.map(({ d, length, frequencies }): SearchHit => {
			let score = 0;
			for (const term of terms) {
				const tf = frequencies.get(term) ?? 0;
				score += (idf.get(term)! * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * length) / avgLength));
			}
			return { ...d, score, trust: "candidate-only" };
		})
		.filter((d) => d.score > 0)
		.sort((a, b) => b.score - a.score || lexical(a.id, b.id))
		.slice(0, limit);
}

export type AcquisitionResult<T> =
	| { readonly status: "ok"; readonly value: T }
	| { readonly status: "budget-exhausted" | "busy" | "timeout" | "aborted" | "stale" | "error" };
export interface AcquisitionOptions {
	readonly maxRequests: number;
	readonly maxInFlight: number;
	readonly durationMs: number;
	readonly perRequestMs: number;
	readonly monotonicNow?: () => number;
}
/**
 * Owns every started promise until actual settlement, including noncooperative requests.
 * The scope is per host-approved run. It is not a billing or process-isolation boundary.
 */
export class AcquisitionPool {
	private readonly now: () => number;
	private readonly deadline: number;
	private readonly maxRequests: number;
	private readonly maxInFlight: number;
	private readonly perRequestMs: number;
	private nextId = 0;
	private epoch = 0;
	private requests = 0;
	private readonly active = new Map<number, { controller: AbortController; quarantined: boolean }>();
	constructor(options: AcquisitionOptions) {
		integer(options.maxRequests, "maxRequests", 100_000);
		integer(options.maxInFlight, "maxInFlight", 64);
		integer(options.durationMs, "durationMs", 86_400_000);
		integer(options.perRequestMs, "perRequestMs", 86_400_000);
		this.now = options.monotonicNow ?? (() => performance.now());
		const start = this.now();
		ensure(Number.isFinite(start) && start >= 0, "invalid monotonic clock");
		this.deadline = start + options.durationMs;
		this.maxRequests = options.maxRequests;
		this.maxInFlight = options.maxInFlight;
		this.perRequestMs = options.perRequestMs;
	}
	snapshot(): { requests: number; active: number; quarantined: number; remainingMs: number; epoch: number } {
		return {
			requests: this.requests,
			active: this.active.size,
			quarantined: [...this.active.values()].filter((e) => e.quarantined).length,
			remainingMs: Math.max(0, Math.floor(this.deadline - this.now())),
			epoch: this.epoch,
		};
	}
	/** Invalidation requests cancellation but never resets outstanding ownership or budget. */
	invalidate(): void {
		this.epoch++;
		for (const entry of this.active.values()) {
			entry.quarantined = true;
			entry.controller.abort();
		}
	}
	async run<T>(operation: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<AcquisitionResult<T>> {
		if (parent?.aborted) return { status: "aborted" };
		const remaining = this.deadline - this.now();
		if (this.requests >= this.maxRequests || remaining <= 0 || this.perRequestMs === 0) {
			return { status: "budget-exhausted" };
		}
		if (this.active.size >= this.maxInFlight) return { status: "busy" };
		const id = ++this.nextId,
			epoch = this.epoch,
			controller = new AbortController();
		const entry = { controller, quarantined: false };
		this.active.set(id, entry);
		this.requests++;
		const expires = this.now() + Math.min(remaining, this.perRequestMs);
		let resolveStop!: (result: AcquisitionResult<T>) => void;
		const stopped = new Promise<AcquisitionResult<T>>((resolve) => {
			resolveStop = resolve;
		});
		const stop = (status: "aborted" | "timeout" | "stale"): void => {
			if (this.active.has(id)) entry.quarantined = true;
			resolveStop({ status });
			controller.abort();
		};
		const onParent = (): void => stop("aborted");
		const onInternal = (): void => {
			if (epoch !== this.epoch) resolveStop({ status: "stale" });
		};
		parent?.addEventListener("abort", onParent, { once: true });
		controller.signal.addEventListener("abort", onInternal, { once: true });
		const timer = setTimeout(() => stop("timeout"), Math.max(1, Math.ceil(expires - this.now())));
		// Both fulfillment and rejection are owned. Late results are never promoted.
		const task = Promise.resolve()
			.then(() => {
				if (controller.signal.aborted || parent?.aborted) throw new Error("cancelled-before-dispatch");
				return operation(controller.signal);
			})
			.then(
				(value): AcquisitionResult<T> => {
					if (epoch !== this.epoch) return { status: "stale" };
					if (parent?.aborted) return { status: "aborted" };
					if (controller.signal.aborted || this.now() >= expires) return { status: "timeout" };
					return { status: "ok", value };
				},
				(): AcquisitionResult<T> => ({
					status:
						epoch !== this.epoch
							? "stale"
							: parent?.aborted
								? "aborted"
								: controller.signal.aborted
									? "timeout"
									: "error",
				}),
			)
			.finally(() => {
				this.active.delete(id);
			});
		try {
			return await Promise.race([task, stopped]);
		} finally {
			clearTimeout(timer);
			parent?.removeEventListener("abort", onParent);
			controller.signal.removeEventListener("abort", onInternal);
		}
	}
}
