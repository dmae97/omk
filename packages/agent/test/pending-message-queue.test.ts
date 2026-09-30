import { describe, expect, it, vi } from "vitest";
import { PendingMessageQueue } from "../src/pending-message-queue.ts";
import type { AgentMessage } from "../src/types.ts";

const message = (index: number): AgentMessage => ({ role: "user", content: String(index), timestamp: index });

describe("pending message queue", () => {
	it("preserves FIFO and switches modes after individual draining", () => {
		const queue = new PendingMessageQueue("one-at-a-time");
		const messages = Array.from({ length: 5 }, (_, index) => message(index));
		for (const entry of messages) queue.enqueue(entry);
		expect(queue.drain()).toEqual([messages[0]]);
		expect(queue.drain()).toEqual([messages[1]]);
		queue.mode = "all";
		expect(queue.drain()).toEqual(messages.slice(2));
		expect(queue.hasItems()).toBe(false);
		expect(queue.drain()).toEqual([]);
		queue.enqueue(messages[0]);
		expect(queue.hasItems()).toBe(true);
		expect(queue.drain()).toEqual([messages[0]]);
	});

	it("does not retain a dequeued payload and clears partially drained storage", () => {
		const queue = new PendingMessageQueue("one-at-a-time");
		const first = message(0);
		queue.enqueue(first);
		queue.enqueue(message(1));
		expect(queue.drain()).toEqual([first]);
		expect(Reflect.get(queue, "messages")).not.toContain(first);
		queue.clear();
		expect(queue.hasItems()).toBe(false);
		expect(queue.drain()).toEqual([]);
		queue.enqueue(first);
		expect(queue.drain()).toEqual([first]);
	});

	it("copies only a linear number of elements when individually draining a burst", () => {
		const count = 4096;
		const queue = new PendingMessageQueue("one-at-a-time");
		for (let index = 0; index < count; index++) queue.enqueue(message(index));
		let copiedElements = 0;
		const originalSlice = Array.prototype.slice;
		const slice = vi.spyOn(Array.prototype, "slice").mockImplementation(function (
			this: unknown[],
			start?: number,
			end?: number,
		) {
			copiedElements += Math.max(0, (end ?? this.length) - (start ?? 0));
			return originalSlice.call(this, start, end);
		});
		try {
			for (let index = 0; index < count; index++) queue.drain();
		} finally {
			slice.mockRestore();
		}
		expect(copiedElements).toBeLessThanOrEqual(count);
		expect(queue.hasItems()).toBe(false);
	});

	it("bounds dead storage under continuous enqueue/drain and retains correct live messages", () => {
		const queue = new PendingMessageQueue("one-at-a-time");
		const backlog = 8;
		for (let index = 0; index < backlog; index++) queue.enqueue(message(index));
		for (let index = 0; index < 8192; index++) {
			expect(queue.drain()).toEqual([message(index)]);
			queue.enqueue(message(index + backlog));
			expect(Reflect.get(queue, "messages").length).toBeLessThanOrEqual(1024 + 2 * backlog);
		}
		queue.mode = "all";
		expect(queue.drain()).toEqual(Array.from({ length: backlog }, (_, index) => message(index + 8192)));
		expect(Reflect.get(queue, "messages")).toHaveLength(0);
	});
});
