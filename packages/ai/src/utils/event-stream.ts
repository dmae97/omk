import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";

// Generic event stream class for async iteration
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue: (T | undefined)[] = [];
	private queueHead = 0;
	private waiting = new Set<(value: IteratorResult<T>) => void>();
	private done = false;
	private finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;
	private rejectFinalResult!: (error: Error) => void;
	private isComplete: (event: T) => boolean;
	private extractResult: (event: T) => R;

	constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResultPromise = new Promise((resolve, reject) => {
			this.resolveFinalResult = resolve;
			this.rejectFinalResult = reject;
		});
	}

	push(event: T): void {
		if (this.done) return;
		const complete = this.isComplete(event);
		if (complete) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}

		const waiter = this.waiting.values().next().value;
		if (waiter) waiter({ value: event, done: false });
		else this.queue.push(event);
		// Terminal delivery must also release other consumers, even without end().
		if (complete) this.end();
	}

	end(result?: R): void {
		if (!this.done) {
			this.done = true;
			if (result !== undefined) this.resolveFinalResult(result);
			else {
				// Iterator-only consumers never observe the result promise.
				void this.finalResultPromise.catch(() => {});
				this.rejectFinalResult(new Error("Stream ended without a final result"));
			}
		}
		for (const waiter of this.waiting) waiter({ value: undefined, done: true });
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		let closed = false;
		const pending = new Set<(value: IteratorResult<T>) => void>();
		const close = (): IteratorResult<T> => {
			closed = true;
			for (const waiter of pending) waiter({ value: undefined, done: true });
			return { value: undefined, done: true };
		};
		const iterator: AsyncIterableIterator<T> = {
			[Symbol.asyncIterator]: () => iterator,
			next: (): Promise<IteratorResult<T>> => {
				if (closed) return Promise.resolve({ value: undefined, done: true });
				if (this.queueHead < this.queue.length) {
					const value = this.queue[this.queueHead] as T;
					// Release consumed payloads immediately, not at the next compaction.
					this.queue[this.queueHead++] = undefined;
					if (this.queueHead === this.queue.length) {
						this.queue = [];
						this.queueHead = 0;
					} else if (this.queueHead >= 1024 && this.queueHead * 2 >= this.queue.length) {
						this.queue = this.queue.slice(this.queueHead);
						this.queueHead = 0;
					}
					return Promise.resolve({ value, done: false });
				}
				if (this.done) return Promise.resolve(close());
				return new Promise((resolve) => {
					const waiter = (value: IteratorResult<T>) => {
						this.waiting.delete(waiter);
						pending.delete(waiter);
						resolve(value);
					};
					pending.add(waiter);
					this.waiting.add(waiter);
				});
			},
			return: (value?: T) => {
				close();
				return Promise.resolve({ value, done: true });
			},
			throw: (error: unknown) => {
				close();
				return Promise.reject(error);
			},
		};
		return iterator;
	}

	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") {
					return event.message;
				} else if (event.type === "error") {
					return event.error;
				}
				throw new Error("Unexpected event type for final result");
			},
		);
	}
}

/** Factory function for AssistantMessageEventStream (for use in extensions) */
export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}
