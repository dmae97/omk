import type { BashExecutionMessage } from "./messages.ts";

export interface PendingBashRecord {
	readonly id: string;
	readonly message: BashExecutionMessage;
	pushedToMemory: boolean;
	persisted: boolean;
}

const MAX_PERSISTED_IDS = 1024;

export class SessionBashResultQueue {
	private pending: PendingBashRecord[] = [];
	private readonly persistedIds = new Set<string>();
	private nextSeq = 0;

	get hasPending(): boolean {
		return this.pending.length > 0;
	}

	private allocateId(explicitId?: string): string {
		if (explicitId && explicitId.trim().length > 0) return explicitId;
		this.nextSeq += 1;
		return `bash-result-${this.nextSeq}`;
	}

	private markPersisted(record: PendingBashRecord): void {
		record.persisted = true;
		this.persistedIds.add(record.id);
		if (this.persistedIds.size > MAX_PERSISTED_IDS) {
			const oldest = this.persistedIds.values().next().value;
			if (oldest !== undefined) this.persistedIds.delete(oldest);
		}
	}

	private isKnown(id: string): boolean {
		return this.persistedIds.has(id) || this.pending.some((entry) => entry.id === id);
	}

	private persistOne(
		record: PendingBashRecord,
		pushMessage: (message: BashExecutionMessage) => void,
		appendMessage: (message: BashExecutionMessage) => void,
	): void {
		if (record.persisted || this.persistedIds.has(record.id)) {
			record.persisted = true;
			return;
		}
		if (!record.pushedToMemory) {
			pushMessage(record.message);
			record.pushedToMemory = true;
		}
		appendMessage(record.message);
		this.markPersisted(record);
	}

	record(
		message: BashExecutionMessage,
		isStreaming: boolean,
		pushMessage: (message: BashExecutionMessage) => void,
		appendMessage: (message: BashExecutionMessage) => void,
		explicitId?: string,
	): void {
		const id = this.allocateId(explicitId);
		if (this.isKnown(id)) return;
		const entry: PendingBashRecord = { id, message, pushedToMemory: false, persisted: false };
		if (isStreaming) {
			this.pending.push(entry);
			return;
		}
		try {
			this.persistOne(entry, pushMessage, appendMessage);
		} catch (error) {
			if (!entry.persisted) this.pending.push(entry);
			throw error;
		}
	}

	flush(
		pushMessage: (message: BashExecutionMessage) => void,
		appendMessage: (message: BashExecutionMessage) => void,
	): void {
		if (this.pending.length === 0) return;
		let firstError: unknown;
		let hasError = false;
		for (const entry of this.pending) {
			try {
				this.persistOne(entry, pushMessage, appendMessage);
			} catch (error) {
				firstError = error;
				hasError = true;
				break;
			}
		}
		this.pending = this.pending.filter((entry) => !entry.persisted);
		if (hasError) throw firstError;
	}
}
