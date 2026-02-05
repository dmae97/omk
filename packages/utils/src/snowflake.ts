// 16-bit hex lookup table (65536 entries) for fast conversion
const HEX4 = Array.from({ length: 65536 }, (_, i) => i.toString(16).padStart(4, "0"));

function randu32() {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}

const EPOCH = 1420070400000;
const MAX_SEQ = 0x3fffff;

// Snowflake as a hex string (16 chars, zero-padded).
//
// Since this is not distributed (no machine ID needed), we use an extended
// 22-bit sequence instead of the standard 10-bit machine ID + 12-bit sequence.
//
type Snowflake = string & { readonly __brand: unique symbol };

namespace Snowflake {
	// Hex string validation pattern (16 lowercase hex chars).
	//
	export const PATTERN = /^[0-9a-f]{16}$/;

	// Epoch timestamp.
	//
	export const EPOCH_TIMESTAMP = EPOCH;

	// Maximum sequence number.
	//
	export const MAX_SEQUENCE = MAX_SEQ;

	// Parses a hex string or bigint to bigint.
	//
	function toBigInt(value: Snowflake): bigint {
		const hi = Number.parseInt(value.substring(0, 8), 16);
		const lo = Number.parseInt(value.substring(8, 16), 16);
		return (BigInt(hi) << 32n) | BigInt(lo);
	}

	// Formats a sequence and timestamp into a snowflake hex string.
	//
	export function formatParts(dt: number, seq: number): Snowflake {
		// Split 64-bit value into two 32-bit parts for number arithmetic
		// high32 = delta >> 10 (timestamp bits 41-10)
		// low32 = (delta & 0x3ff) << 22 | seq
		const hi = dt >>> 10;
		const lo = (dt << 22) | seq;

		const hi1 = (hi >>> 16) & 0xffff;
		const hi2 = hi & 0xffff;
		const lo1 = (lo >>> 16) & 0xffff;
		const lo2 = lo & 0xffff;
		return `${HEX4[hi1]}${HEX4[hi2]}${HEX4[lo1]}${HEX4[lo2]}` as Snowflake;
	}

	// Snowflake generator type.
	//
	export class Source {
		#seq = 0;
		constructor(sequence: number = randu32() & MAX_SEQ) {
			this.#seq = sequence & MAX_SEQ;
		}

		// Sequence number.
		//
		get sequence() {
			return this.#seq & MAX_SEQ;
		}
		set sequence(v: number) {
			this.#seq = v & MAX_SEQ;
		}
		reset() {
			this.#seq = 0;
		}

		// Generates the next value as a hex string.
		//
		generate(timestamp: number): Snowflake {
			const seq = (this.#seq + 1) & MAX_SEQ;
			const dt = timestamp - EPOCH;
			this.#seq = seq;
			return formatParts(dt, seq);
		}
	}

	// Gets the next snowflake given the timestamp.
	//
	const defaultSource = new Source();
	export function next(timestamp = Date.now()): Snowflake {
		return defaultSource.generate(timestamp);
	}

	// Validates a snowflake hex string.
	//
	export function valid(value: string): value is Snowflake {
		return value.length === 16 && PATTERN.test(value);
	}

	// Returns the upper/lower boundaries for the given timestamp.
	//
	export function lowerbound(timelike: Date | number | Snowflake): Snowflake {
		switch (typeof timelike) {
			// biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional fallthrough
			case "object": // Date
				timelike = timelike.getTime();
			case "number":
				return formatParts(timelike - EPOCH, 0);
			case "string": // Snowflake hex string
				return timelike;
		}
	}
	export function upperbound(timelike: Date | number | Snowflake): Snowflake {
		switch (typeof timelike) {
			// biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional fallthrough
			case "object": // Date
				timelike = timelike.getTime();
			case "number":
				return formatParts(timelike - EPOCH, 0x3fffff);
			case "string": // Snowflake hex string
				return timelike;
		}
	}

	// Returns the individual bits given the snowflake.
	//
	export function getSequence(value: Snowflake) {
		return Number.parseInt(value.substring(8, 16), 16) & MAX_SEQ;
	}
	export function getTimestamp(value: Snowflake) {
		const n = toBigInt(value) >> 22n;
		return Number(n + BigInt(EPOCH));
	}
	export function getDate(value: Snowflake) {
		return new Date(getTimestamp(value));
	}
}

export { Snowflake };
