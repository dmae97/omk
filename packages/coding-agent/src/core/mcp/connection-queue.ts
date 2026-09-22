interface PendingConnection {
	start: () => Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
}

/** Per-manager FIFO admission. Active attempts retain slots until they settle. */
export class McpConnectionQueue {
	private readonly limit: number;
	private active = 0;
	private pending: PendingConnection[] = [];

	constructor(limit: number) {
		if (!Number.isSafeInteger(limit) || limit < 1)
			throw new RangeError("connectionConcurrency must be a positive integer");
		this.limit = limit;
	}

	run(start: () => Promise<void>): Promise<void> {
		return new Promise((resolve, reject) => {
			this.pending.push({ start, resolve, reject });
			this.pump();
		});
	}

	cancelQueued(): void {
		const pending = this.pending;
		this.pending = [];
		for (const job of pending) job.resolve();
	}

	private pump(): void {
		while (this.active < this.limit) {
			const job = this.pending.shift();
			if (!job) return;
			this.active++;
			void this.start(job);
		}
	}

	private async start(job: PendingConnection): Promise<void> {
		try {
			await job.start();
			job.resolve();
		} catch (error) {
			job.reject(error);
		} finally {
			this.active--;
			this.pump();
		}
	}
}
