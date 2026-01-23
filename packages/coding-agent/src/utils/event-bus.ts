export class EventBus {
	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

	public emit(channel: string, data: unknown): void {
		const handlers = this.listeners.get(channel);
		if (handlers) {
			for (const handler of handlers) {
				handler(data);
			}
		}
	}

	public on(channel: string, handler: (data: unknown) => void): () => void {
		if (!this.listeners.has(channel)) {
			this.listeners.set(channel, new Set());
		}
		const safeHandler = async (data: unknown) => {
			try {
				await handler(data);
			} catch (err) {
				console.error(`Event handler error (${channel}):`, err);
			}
		};
		this.listeners.get(channel)!.add(safeHandler);
		return () => this.listeners.get(channel)?.delete(safeHandler);
	}

	public clear(): void {
		this.listeners.clear();
	}
}
