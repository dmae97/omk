function rand64() {
	return crypto.getRandomValues(new BigUint64Array(1))[0] ^ (BigInt(Date.now()) * 6364136223846793005n);
}

const MAX_MASK = BigInt(Number.MAX_SAFE_INTEGER);
function randint() {
	return Number(rand64() & MAX_MASK);
}

// Snowflake as a hex string (16 chars, zero-padded).
//
// Since this is not distributed (no machine ID needed), we use an extended
// 22-bit sequence instead of the standard 10-bit machine ID + 12-bit sequence.
//
type Snowflake = string & { readonly __brand: unique symbol };

namespace Snowflake {
	// Default epoch.
	//
	export const DEFAULT_EPOCH = 1420070400000n;

	// Hex string validation pattern (16 lowercase hex chars).
	//
	export const PATTERN = /^[0-9a-f]{16}$/;

	// Converts a bigint to a hex snowflake string.
	//
	function toHex(value: bigint): Snowflake {
		return value.toString(16).padStart(16, "0") as Snowflake;
	}

	// Parses a hex string or bigint to bigint.
	//
	function toBigInt(value: Snowflake | bigint): bigint {
		if (typeof value === "bigint") return value;
		const highBits = BigInt(Number.parseInt(value.substring(0, 8), 16));
		const lowBits = BigInt(Number.parseInt(value.substring(8, 16), 16));
		return (highBits << 32n) | lowBits;
	}

	// Snowflake generator type.
	//
	export class Source {
		static readonly DEFAULT = new Source();

		readonly epoch: bigint;
		#seq = 0;
		constructor(config: { epoch?: bigint | number | Date; sequence?: number } = {}) {
			const { epoch = DEFAULT_EPOCH, sequence = randint() } = config;
			if (typeof epoch === "object") {
				this.epoch = BigInt(epoch.getTime());
			} else {
				this.epoch = BigInt(epoch);
			}
			this.setSequence(sequence);
		}

		// Epoch.
		//
		getEpochTimestamp() {
			return Number(this.epoch);
		}
		getEpochDate() {
			return new Date(Number(this.epoch));
		}

		// Sequence number.
		//
		get sequence() {
			return this.#seq & 0x3fffff;
		}
		setSequence(v: number) {
			this.#seq = v & 0x3fffff;
			return this;
		}
		reset() {
			return this.setSequence(0);
		}

		// Generates the next value as a hex string.
		//
		next(timestamp = Date.now()): Snowflake {
			const seq = (this.#seq + 1) & 0x3fffff;
			this.#seq = seq;
			const value = BigInt(seq) | ((BigInt(timestamp) - this.epoch) << 22n);
			return toHex(value);
		}
	}

	// Gets the next snowflake given the timestamp.
	//
	export function next(timestamp = Date.now(), source: Source = Source.DEFAULT): Snowflake {
		return source.next(timestamp);
	}

	// Validates a snowflake hex string.
	//
	export function valid(value: string): value is Snowflake {
		return PATTERN.test(value);
	}

	// Returns the upper/lower boundaries for the given timestamp.
	//
	export function lowerbound(timelike: Date | number | Snowflake, source: Source = Source.DEFAULT): Snowflake {
		switch (typeof timelike) {
			// biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional fallthrough
			case "object": // Date
				timelike = timelike.getTime();
			case "number": // Milliseconds
				return toHex(0x000000n | ((BigInt(timelike) - source.epoch) << 22n));
			case "string": // Snowflake hex string
				return timelike;
		}
	}
	export function upperbound(timelike: Date | number | Snowflake, source: Source = Source.DEFAULT): Snowflake {
		switch (typeof timelike) {
			// biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional fallthrough
			case "object": // Date
				timelike = timelike.getTime();
			case "number": // Milliseconds
				return toHex(0x3fffffn | ((BigInt(timelike) - source.epoch) << 22n));
			case "string": // Snowflake hex string
				return timelike;
		}
	}

	// Returns the individual bits given the snowflake.
	//
	export function getSequence(value: Snowflake) {
		let n = toBigInt(value);
		n &= 0xfffn;
		return Number(n);
	}
	export function getMachineId(value: Snowflake) {
		let n = toBigInt(value);
		n &= 0x3ff000n;
		n >>= 12n;
		return Number(n);
	}
	export function getTimestamp(value: Snowflake, epoch: bigint = DEFAULT_EPOCH) {
		let n = toBigInt(value);
		n >>= 22n;
		return Number(n + epoch);
	}
	export function getDate(s: Snowflake, epoch: bigint = DEFAULT_EPOCH) {
		return new Date(getTimestamp(s, epoch));
	}
}

export { Snowflake };
