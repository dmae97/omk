// Codeium field numbers follow the public oh-my-pi snapshot; see DEVIN-NOTICE and the provider guide.
type WireValue = Uint8Array | bigint | number;

function varint(value: number): Buffer {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Devin protobuf integer");
	const bytes: number[] = [];
	let remaining = BigInt(value);
	do {
		const byte = Number(remaining & 127n);
		remaining >>= 7n;
		bytes.push(remaining ? byte | 128 : byte);
	} while (remaining);
	return Buffer.from(bytes);
}

export function field(no: number, value: string | number | boolean | Uint8Array): Buffer {
	if (typeof value === "number" || typeof value === "boolean") {
		return Buffer.concat([varint(no * 8), varint(Number(value))]);
	}
	const bytes = typeof value === "string" ? Buffer.from(value) : value;
	return Buffer.concat([varint(no * 8 + 2), varint(bytes.length), bytes]);
}

export function doubleField(no: number, value: number): Buffer {
	if (!Number.isFinite(value)) throw new Error("Invalid Devin protobuf double");
	const bytes = Buffer.alloc(8);
	bytes.writeDoubleLE(value);
	return Buffer.concat([varint(no * 8 + 1), bytes]);
}

/** Bounded protobuf reader for the small set of Cascade messages used by this adapter. */
export class ProtoMessage {
	private readonly fields = new Map<number, WireValue[]>();

	constructor(data: Uint8Array) {
		const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
		let offset = 0;
		const readVarint = (): bigint => {
			let value = 0n;
			for (let shift = 0; shift < 70; shift += 7) {
				if (offset >= bytes.length) throw new Error("Truncated Devin protobuf varint");
				const byte = bytes[offset++];
				if (shift === 63 && byte > 1) throw new Error("Invalid Devin protobuf varint");
				value |= BigInt(byte & 127) << BigInt(shift);
				if (!(byte & 128)) return value;
			}
			throw new Error("Invalid Devin protobuf varint");
		};
		while (offset < bytes.length) {
			const tag = Number(readVarint());
			if (!Number.isSafeInteger(tag) || tag < 8 || tag > 0xffffffff) throw new Error("Invalid Devin protobuf tag");
			const no = Math.floor(tag / 8);
			const wireType = tag & 7;
			let value: WireValue;
			if (wireType === 0) {
				value = readVarint();
			} else {
				const length = wireType === 2 ? Number(readVarint()) : wireType === 1 ? 8 : wireType === 5 ? 4 : -1;
				if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - offset) {
					throw new Error("Invalid or truncated Devin protobuf field");
				}
				value =
					wireType === 1
						? bytes.readDoubleLE(offset)
						: wireType === 5
							? bytes.readFloatLE(offset)
							: bytes.subarray(offset, offset + length);
				offset += length;
			}
			const values = this.fields.get(no) ?? [];
			values.push(value);
			this.fields.set(no, values);
		}
	}

	/** True when the field was present on the wire, even when it carried a zero value. */
	has(no: number): boolean {
		return this.fields.has(no);
	}

	string(no: number): string {
		const value = this.fields.get(no)?.at(-1);
		if (value === undefined) return "";
		if (!(value instanceof Uint8Array)) throw new Error("Invalid Devin protobuf string");
		return new TextDecoder("utf-8", { fatal: true }).decode(value);
	}

	/** Raw bytes for a length-delimited field; undefined when absent or not bytes. */
	bytes(no: number): Uint8Array | undefined {
		const value = this.fields.get(no)?.at(-1);
		return value instanceof Uint8Array ? value : undefined;
	}

	/** All raw bytes values for a repeated length-delimited field. */
	bytesList(no: number): Uint8Array[] {
		return (this.fields.get(no) ?? []).filter((value): value is Uint8Array => value instanceof Uint8Array);
	}

	number(no: number): number {
		const value = this.fields.get(no)?.at(-1);
		if (value === undefined) return 0;
		if (
			value instanceof Uint8Array ||
			!Number.isFinite(Number(value)) ||
			Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER
		) {
			throw new Error("Invalid Devin protobuf number");
		}
		return Number(value);
	}

	messages(no: number): ProtoMessage[] {
		return (this.fields.get(no) ?? []).map((value) => {
			if (!(value instanceof Uint8Array)) throw new Error("Invalid Devin protobuf message");
			return new ProtoMessage(value);
		});
	}
}
