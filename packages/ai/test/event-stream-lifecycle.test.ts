import { describe, expect, it } from "vitest";
import { EventStream } from "../src/utils/event-stream.ts";

type Event = { value: number; terminal?: boolean };
const createStream = () =>
	new EventStream<Event, number>(
		(event) => event.terminal === true,
		(event) => event.value,
	);

// Observe settlement without a timeout or leaving a blocked iterator in the test.
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
	let settled = false;
	void promise.then(() => {
		settled = true;
	});
	await Promise.resolve();
	await Promise.resolve();
	return settled;
}
it("preserves the async-iterable iterator API and explicit return value", async () => {
	const stream = createStream();
	const iterator = stream[Symbol.asyncIterator]();
	expect(Reflect.get(iterator, Symbol.asyncIterator).call(iterator)).toBe(iterator);
	stream.push({ value: 1 });
	expect(await iterator.return?.({ value: 99 })).toEqual({ value: { value: 99 }, done: true });
	expect(await iterator.next()).toEqual({ value: undefined, done: true });
	stream.end(2);
	const remaining: number[] = [];
	for await (const event of stream) remaining.push(event.value);
	expect(remaining).toEqual([1]);
	expect(await stream.result()).toBe(2);
});

describe("event stream ownership and FIFO", () => {
	it("settles pending and late result readers when a producer ends without a result", async () => {
		const stream = createStream();
		const iterator = stream[Symbol.asyncIterator]();
		const next = iterator.next();
		const result = stream.result().catch((error: unknown) => error);
		stream.end();
		expect(await next).toEqual({ value: undefined, done: true });
		expect(await isSettled(result)).toBe(true);
		await expect(stream.result()).rejects.toThrow("Stream ended without a final result");
	});

	it("permits iteration alone when a producer ends without a result", async () => {
		const stream = createStream();
		stream.push({ value: 1 });
		stream.end();
		const values: number[] = [];
		for await (const event of stream) values.push(event.value);
		expect(values).toEqual([1]);
	});
	it("throw() releases pending reads and leaves other consumers active", async () => {
		const stream = createStream();
		const abandoned = stream[Symbol.asyncIterator]();
		const pending = abandoned.next();
		const fault = new Error("consumer stopped");
		await expect(abandoned.throw?.(fault)).rejects.toBe(fault);
		expect(await pending).toEqual({ value: undefined, done: true });
		const active = stream[Symbol.asyncIterator]();
		const next = active.next();
		stream.push({ value: 10, terminal: true });
		expect(await next).toEqual({ value: { value: 10, terminal: true }, done: false });
		expect(await stream.result()).toBe(10);
	});

	it("distinguishes queued undefined payloads from the consumed-slot marker", async () => {
		const stream = new EventStream<number | undefined>(
			() => false,
			(event) => event,
		);
		stream.push(undefined);
		stream.push(1);
		stream.end(2);
		const values: (number | undefined)[] = [];
		for await (const event of stream) values.push(event);
		expect(values).toEqual([undefined, 1]);
		expect(await stream.result()).toBe(2);
	});

	it("settles every waiting consumer when a terminal event is pushed without end()", async () => {
		const stream = createStream();
		const first = stream[Symbol.asyncIterator]();
		const second = stream[Symbol.asyncIterator]();
		const firstNext = first.next();
		const secondNext = second.next();
		stream.push({ value: 7, terminal: true });
		const settled = await isSettled(secondNext);
		stream.end();
		expect(await firstNext).toEqual({ value: { value: 7, terminal: true }, done: false });
		expect(await secondNext).toEqual({ value: undefined, done: true });
		expect(await stream.result()).toBe(7);
		expect(settled).toBe(true);
	});

	it("return() unregisters a pending consumer without swallowing the next consumer's event", async () => {
		const stream = createStream();
		const abandoned = stream[Symbol.asyncIterator]();
		const pending = abandoned.next();
		const returned = abandoned.return?.();
		const returnedBeforePush = await isSettled(Promise.resolve(returned));
		const cancelledBeforePush = await isSettled(pending);
		const active = stream[Symbol.asyncIterator]();
		const next = active.next();
		stream.push({ value: 9 });
		const delivered = await isSettled(next);
		stream.end(11);
		await returned;
		await pending;
		const received = await next;
		expect(returnedBeforePush).toBe(true);
		expect(cancelledBeforePush).toBe(true);
		expect(delivered).toBe(true);
		expect(received).toEqual({ value: { value: 9 }, done: false });
		expect(await stream.result()).toBe(11);
	});

	it("keeps queued events available after a consumer breaks and after result()", async () => {
		const stream = createStream();
		for (let value = 0; value < 3; value++) stream.push({ value });
		stream.push({ value: 3, terminal: true });
		for await (const event of stream) {
			expect(event.value).toBe(0);
			break;
		}
		expect(await stream.result()).toBe(3);
		const remaining: number[] = [];
		for await (const event of stream) remaining.push(event.value);
		expect(remaining).toEqual([1, 2, 3]);
	});

	it("drains a large backlog in order without repeatedly shifting the remaining array", async () => {
		const stream = createStream();
		const count = 20_000;
		for (let value = 0; value < count; value++) stream.push({ value });
		stream.end(count);
		const original = Array.prototype.shift;
		let moved = 0;
		Array.prototype.shift = function (this: unknown[]) {
			moved += Math.max(0, this.length - 1);
			return original.call(this);
		};
		let received = 0;
		let ordered = true;
		try {
			for await (const event of stream) ordered &&= event.value === received++;
		} finally {
			Array.prototype.shift = original;
		}
		expect(ordered).toBe(true);
		expect(received).toBe(count);
		expect(moved).toBeLessThanOrEqual(count * 2);
	});

	it("handles an empty end, repeated next() calls and ignored pushes after terminality", async () => {
		const stream = createStream();
		const iterator = stream[Symbol.asyncIterator]();
		const a = iterator.next();
		const b = iterator.next();
		stream.end(0);
		stream.push({ value: 1 });
		expect(await a).toEqual({ value: undefined, done: true });
		expect(await b).toEqual({ value: undefined, done: true });
		expect(await iterator.next()).toEqual({ value: undefined, done: true });
		expect(await stream.result()).toBe(0);
	});
});
