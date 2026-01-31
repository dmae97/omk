/**
 * Generic worker pool for WASM-based operations.
 *
 * Supports both single-worker (maxWorkers: 1) and multi-worker scenarios.
 * Workers are lazily created and auto-terminated after idle timeout.
 */

/** Base request type - workers must accept messages with this shape. */
export interface BaseRequest {
	type: string;
	id?: number;
}

/** Base response type - workers must respond with this shape. */
export interface BaseResponse {
	type: string;
	id: number;
	error?: string;
}

export interface WorkerPoolOptions {
	/** URL to the worker script (deprecated: use createWorker for compiled binaries). */
	workerUrl?: string | URL;
	/** Factory function to create workers. Required for compiled binaries where Bun needs static analysis. */
	createWorker?: () => Worker;
	/** Maximum number of workers (default: 4). */
	maxWorkers?: number;
	/** Idle timeout in ms before terminating unused workers (0 = never, default: 30000). */
	idleTimeoutMs?: number;
	/** Timeout for worker initialization in ms (default: 10000). */
	initTimeoutMs?: number;
	/** Grace period after request timeout before force-terminating stuck workers (default: 5000). */
	stuckGracePeriodMs?: number;
}

export interface RequestOptions {
	/** Timeout for this request in ms. After this, the promise rejects but worker gets a grace period. */
	timeoutMs?: number;
	/** Abort signal for this request. */
	signal?: AbortSignal;
	/** Transfer list for postMessage. */
	transfer?: ArrayBufferLike[];
}

interface PooledWorker {
	worker: Worker;
	busy: boolean;
	lastUsed: number;
	currentRequestId: number | null;
}

interface PendingRequest<T> {
	resolve: (result: T) => void;
	reject: (error: Error) => void;
	worker?: PooledWorker;
	dispose?: () => void;
}

/**
 * A pool of workers that process requests in parallel.
 *
 * @typeParam TReq - Request message type (must extend BaseRequest)
 * @typeParam TRes - Response message type (must extend BaseResponse)
 */
export class WorkerPool<TReq extends BaseRequest, TRes extends BaseResponse> {
	readonly #options: {
		workerUrl?: string | URL;
		createWorker?: () => Worker;
		maxWorkers: number;
		idleTimeoutMs: number;
		initTimeoutMs: number;
		stuckGracePeriodMs: number;
	};
	readonly #pool: PooledWorker[] = [];
	readonly #waiters: Array<(worker: PooledWorker) => void> = [];
	readonly #pending = new Map<number, PendingRequest<TRes>>();
	#nextRequestId = 1;
	#idleCheckInterval: ReturnType<typeof setInterval> | null = null;

	constructor(options: WorkerPoolOptions) {
		if (!options.workerUrl && !options.createWorker) {
			throw new Error("WorkerPool requires either workerUrl or createWorker");
		}
		this.#options = {
			workerUrl: options.workerUrl,
			createWorker: options.createWorker,
			maxWorkers: options.maxWorkers ?? 4,
			idleTimeoutMs: options.idleTimeoutMs ?? 30_000,
			initTimeoutMs: options.initTimeoutMs ?? 10_000,
			stuckGracePeriodMs: options.stuckGracePeriodMs ?? 5_000,
		};
	}

	/**
	 * Send a request to a worker and wait for the response.
	 * Workers are acquired from the pool (or created if under limit).
	 *
	 * @param msg - Request message
	 * @param options - Request options (timeout, transfer)
	 */
	async request<T extends TRes = TRes>(
		msg: TReq | (Omit<TReq, "id"> & { id?: number }),
		options?: RequestOptions,
	): Promise<T> {
		const { timeoutMs, signal, transfer } = options ?? {};
		signal?.throwIfAborted();

		const worker = await this.#acquireWorker();
		const id = msg.id ?? this.#nextRequestId++;
		const fullMsg = { ...msg, id } as TReq;

		const { promise, resolve, reject } = Promise.withResolvers<T>();
		const pending: PendingRequest<T> = {
			resolve: resolve as (result: TRes) => void,
			reject,
			worker,
		};
		this.#pending.set(id, pending as PendingRequest<TRes>);

		const onAbort = () => {
			this.#handleRequestAbort(id, worker);
		};

		if (timeoutMs && timeoutMs > 0 && signal) {
			const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
			combined.addEventListener("abort", onAbort, { once: true });
			pending.dispose = () => combined.removeEventListener("abort", onAbort);
		} else if (timeoutMs && timeoutMs > 0) {
			const timer = setTimeout(onAbort, timeoutMs);
			pending.dispose = () => clearTimeout(timer);
		} else if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
			pending.dispose = () => signal.removeEventListener("abort", onAbort);
		}

		worker.currentRequestId = id;
		if (transfer) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			worker.worker.postMessage(fullMsg, transfer as any);
		} else {
			worker.worker.postMessage(fullMsg);
		}

		return promise;
	}

	/** Terminate all workers and clear pending requests. */
	terminate(): void {
		if (this.#idleCheckInterval) {
			clearInterval(this.#idleCheckInterval);
			this.#idleCheckInterval = null;
		}

		for (const w of [...this.#pool]) {
			this.#removeWorker(w);
		}

		this.#waiters.length = 0;

		for (const pending of this.#pending.values()) {
			pending.reject(new Error("Worker pool terminated"));
			void pending.dispose?.();
		}
		this.#pending.clear();
	}

	#createWorker(): PooledWorker {
		const worker = this.#options.createWorker ? this.#options.createWorker() : new Worker(this.#options.workerUrl!);

		const pooledWorker: PooledWorker = {
			worker,
			busy: false,
			lastUsed: Date.now(),
			currentRequestId: null,
		};

		worker.onmessage = (e: MessageEvent<TRes>) => {
			this.#handleMessage(pooledWorker, e.data);
		};

		worker.onerror = (e: ErrorEvent) => {
			const requestId = pooledWorker.currentRequestId;
			if (requestId !== null) {
				this.#rejectRequest(requestId, new Error(`Worker error: ${e.message}`));
			}
			this.#removeWorker(pooledWorker);
		};

		return pooledWorker;
	}

	#handleMessage(pooledWorker: PooledWorker, msg: TRes): void {
		const pending = this.#pending.get(msg.id);
		if (!pending) return;

		this.#pending.delete(msg.id);
		void pending.dispose?.();

		if (msg.type === "error" && "error" in msg) {
			pending.reject(new Error(msg.error ?? "Unknown error"));
		} else {
			pending.resolve(msg);
		}

		// Release worker back to pool (unless it was the init request)
		if (msg.type !== "ready") {
			pooledWorker.currentRequestId = null;
			this.#releaseWorker(pooledWorker);
		}
	}

	#rejectRequest(id: number, error: Error): void {
		const pending = this.#pending.get(id);
		if (pending) {
			this.#pending.delete(id);
			void pending.dispose?.();
			pending.reject(error);
		}
	}

	#handleRequestAbort(id: number, worker: PooledWorker): void {
		const pending = this.#pending.get(id);
		if (!pending) return;

		pending.dispose = undefined;
		pending.reject(new Error("Request timeout"));

		if (this.#options.stuckGracePeriodMs > 0) {
			const timer = setTimeout(() => {
				this.#terminateStuckWorker(id, worker);
			}, this.#options.stuckGracePeriodMs);

			pending.dispose = () => {
				clearTimeout(timer);
			};
		}
	}

	#terminateStuckWorker(id: number, worker: PooledWorker): void {
		const pending = this.#pending.get(id);
		if (pending) {
			this.#pending.delete(id);
			void pending.dispose?.();
		}

		if (worker.currentRequestId !== id) return;
		if (!this.#pool.includes(worker)) return;

		this.#removeWorker(worker);

		if (this.#pool.length === 0 && this.#waiters.length > 0) {
			this.#replenishPool();
		}
	}

	async #replenishPool(): Promise<void> {
		const worker = this.#createWorker();
		worker.busy = true;
		this.#pool.push(worker);
		try {
			await this.#initializeWorker(worker);
			this.#releaseWorker(worker);
		} catch {
			this.#removeWorker(worker);
		}
	}

	#removeWorker(pooledWorker: PooledWorker): void {
		const idx = this.#pool.indexOf(pooledWorker);
		if (idx !== -1) {
			this.#pool.splice(idx, 1);
		}
		pooledWorker.worker.postMessage({ type: "destroy" } satisfies BaseRequest);
		pooledWorker.worker.terminate();
	}

	#releaseWorker(pooledWorker: PooledWorker): void {
		pooledWorker.busy = false;
		pooledWorker.lastUsed = Date.now();

		if (this.#waiters.length) {
			const waiter = this.#waiters.shift()!;
			pooledWorker.busy = true;
			waiter(pooledWorker);
		}
	}

	#checkIdleWorkers(): void {
		if (this.#options.idleTimeoutMs === 0) return;

		const now = Date.now();
		const toRemove: PooledWorker[] = [];

		for (const w of this.#pool) {
			if (!w.busy && now - w.lastUsed > this.#options.idleTimeoutMs && !this.#waiters.length) {
				toRemove.push(w);
			}
		}

		for (const w of toRemove) {
			this.#removeWorker(w);
		}

		if (this.#pool.length === 0 && this.#idleCheckInterval) {
			clearInterval(this.#idleCheckInterval);
			this.#idleCheckInterval = null;
		}
	}

	#ensureIdleCheck(): void {
		if (this.#options.idleTimeoutMs > 0 && !this.#idleCheckInterval) {
			this.#idleCheckInterval = setInterval(() => this.#checkIdleWorkers(), 10_000);
		}
	}

	async #initializeWorker(pooledWorker: PooledWorker): Promise<void> {
		const id = this.#nextRequestId++;
		const { promise, resolve, reject } = Promise.withResolvers<void>();

		const timeout = setTimeout(() => {
			this.#rejectRequest(id, new Error("Worker initialization timeout"));
		}, this.#options.initTimeoutMs);

		this.#pending.set(id, {
			resolve: () => resolve(),
			reject,
			dispose: () => clearTimeout(timeout),
		} as PendingRequest<TRes>);

		pooledWorker.currentRequestId = id;
		pooledWorker.worker.postMessage({ type: "init", id } satisfies BaseRequest);
		return promise;
	}

	async #acquireWorker(): Promise<PooledWorker> {
		// Try to find an idle worker
		for (const w of this.#pool) {
			if (!w.busy) {
				w.busy = true;
				return w;
			}
		}

		// Create new worker if under limit
		if (this.#pool.length < this.#options.maxWorkers) {
			const worker = this.#createWorker();
			worker.busy = true;
			this.#pool.push(worker);
			this.#ensureIdleCheck();
			await this.#initializeWorker(worker);
			return worker;
		}

		// Wait for a worker to become available
		const { promise, resolve } = Promise.withResolvers<PooledWorker>();
		this.#waiters.push(w => {
			w.busy = true;
			resolve(w);
		});
		return promise;
	}
}
